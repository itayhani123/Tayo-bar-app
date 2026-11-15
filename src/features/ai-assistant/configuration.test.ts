import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiApiKey, aiModel, missingAiEnvironment, AiConfigurationError } from "./configuration";
import { aiFailure } from "./errors";
import { handleAssistantRequest } from "./http";
import { handleAttendanceRequest } from "./attendance-http";

test("AI environment uses exact server-side names, trims whitespace and defaults only the optional model", () => {
  assert.throws(() => aiApiKey({}), AiConfigurationError);
  assert.throws(() => aiApiKey({OPENAI_API_KEY:" \n "}), AiConfigurationError);
  assert.throws(() => aiApiKey({NEXT_PUBLIC_OPENAI_API_KEY:"wrong-name",OPENAI_KEY:"wrong-name"}), AiConfigurationError);
  assert.equal(aiApiKey({OPENAI_API_KEY:"  synthetic-key  "}),"synthetic-key");
  assert.equal(aiModel({}),"gpt-4.1-mini");assert.equal(aiModel({OPENAI_MODEL:"  "}),"gpt-4.1-mini");
  assert.equal(aiModel({OPENAI_MODEL:" model-id "}),"model-id");
  assert.deepEqual(missingAiEnvironment({OPENAI_API_KEY:"exists",NEXT_PUBLIC_SUPABASE_URL:"url",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"key",SUPABASE_SERVICE_ROLE_KEY:"key"}),[]);
});

const providerError=(status:number,code?:string,type?:string)=>OpenAI.APIError.generate(status,{error:{message:"SENSITIVE_PROVIDER_CONTENT",code,type}},undefined,new Headers());
test("OpenAI failures have distinct safe codes; provider text and secrets never reach responses", () => {
  const cases: [unknown,string][] = [
    [new AiConfigurationError(["OPENAI_API_KEY"]),"AI_CONFIGURATION_MISSING"],
    [providerError(401),"AI_PROVIDER_AUTH_FAILED"],[providerError(403),"AI_PROVIDER_ACCESS_DENIED"],
    [providerError(404,"model_not_found"),"AI_MODEL_UNAVAILABLE"],[providerError(400),"AI_REQUEST_REJECTED"],
    [providerError(429,"rate_limit_exceeded"),"AI_PROVIDER_RATE_LIMIT"],
    [providerError(429,"credit_balance_exhausted"),"AI_BILLING_LIMIT"],
    [providerError(429,undefined,"insufficient_quota"),"AI_BILLING_LIMIT"],
    [providerError(503),"AI_PROVIDER_UNAVAILABLE"],
    [new OpenAI.APIConnectionError({message:"SENSITIVE_PROVIDER_CONTENT"}),"AI_CONNECTION_FAILED"],
    [new OpenAI.APIConnectionTimeoutError(),"AI_TIMEOUT"],
    [new Error("INCOMPLETE_RESPONSE"),"AI_RESPONSE_INCOMPLETE"],
  ];
  for(const [error,code] of cases){const result=aiFailure(error)!;assert.equal(result.code,code);assert.doesNotMatch(JSON.stringify(result),/SENSITIVE_PROVIDER_CONTENT/);if(code!=="AI_CONFIGURATION_MISSING")assert.equal(result.missing,undefined);}
  assert.equal(aiFailure(providerError(429,"credit_balance_exhausted"))?.retryAfter,undefined);
  assert.equal(aiFailure(new Error("private DB details")),null);
});

function dependencies() {
  let calls=0;
  const db={auth:{getUser:async()=>({data:{user:{id:"verified-actor"}},error:null})},from:()=>{const q={select:()=>q,eq:()=>q,abortSignal:()=>q,single:async()=>({data:{role:"manager"},error:null})};return q;},rpc:()=>({abortSignal:async()=>{calls++;return{data:true,error:null};}})} as unknown as SupabaseClient;
  return{db,calls:()=>calls};
}
const request=(attendance=false)=>new Request(`https://tayo.test/api/ai-assistant${attendance?"/attendance":""}`,{method:"POST",headers:{Origin:"https://tayo.test","Content-Type":"application/json"},body:JSON.stringify(attendance?{action:"extract",text:"הגעה\nנדב 19:00"}:{messages:[{role:"user",content:"שלום"}]})});
test("missing key blocks before quota/model, while OpenAI API failures never masquerade as missing configuration",async()=>{
  const {db,calls}=dependencies();
  const missing=await handleAssistantRequest(request(),{createClient:async()=>db,configured:false,answer:async()=>{throw new Error("must not call");}});
  assert.equal(missing.status,503);assert.equal((await missing.json()).code,"AI_CONFIGURATION_MISSING");assert.equal(calls(),0);
  const turnRequest=new Request("https://tayo.test/api/ai-assistant",{method:"POST",headers:{Origin:"https://tayo.test","Content-Type":"application/json"},body:JSON.stringify({conversationId:"11111111-1111-4111-8111-111111111111",requestId:"22222222-2222-4222-8222-222222222222",message:"שלום"})});
  const adminMissing=await handleAssistantRequest(turnRequest,{createClient:async()=>db,configured:true,missingConfiguration:["SUPABASE_SERVICE_ROLE_KEY"],answer:async()=>"unused",converse:async()=>{throw new Error("must not call");}});
  assert.equal(adminMissing.status,503);assert.deepEqual((await adminMissing.json()).missing,["SUPABASE_SERVICE_ROLE_KEY"]);assert.equal(calls(),0);
  for(const [status,code] of [[401,"AI_PROVIDER_AUTH_FAILED"],[403,"AI_PROVIDER_ACCESS_DENIED"],[429,"AI_PROVIDER_RATE_LIMIT"],[500,"AI_PROVIDER_UNAVAILABLE"]] as const){
    const response=await handleAssistantRequest(request(),{createClient:async()=>db,configured:true,answer:async()=>{throw providerError(status);}});
    const body=await response.json();assert.equal(body.code,code);assert.equal(body.missing,undefined);assert.doesNotMatch(body.error,/לא הוגדר|SENSITIVE_PROVIDER_CONTENT/);
  }
});
test("attendance extraction uses the same safe provider errors; WhatsApp additions do not change normal chat success",async()=>{
 const {db}=dependencies();
 const response=await handleAttendanceRequest(request(true),{createClient:async()=>db,admin:()=>db,configured:true,extract:async()=>{throw providerError(429,"insufficient_quota");}});
 assert.equal((await response.json()).code,"AI_BILLING_LIMIT");
 const correlated=request();const correlationId="33333333-3333-4333-8333-333333333333";correlated.headers.set("X-Tayo-AI-Request-Id",correlationId);
 const normal=await handleAssistantRequest(correlated,{createClient:async()=>db,configured:true,answer:async()=>"תשובה תקינה"});
 assert.equal(normal.status,200);assert.equal((await normal.json()).answer,"תשובה תקינה");
 assert.equal(normal.headers.get("X-Tayo-AI-Request-Id"),correlationId);assert.equal(normal.headers.get("X-Tayo-AI-Version"),"chat-transport-v2");
});
