import assert from "node:assert/strict";
import test from "node:test";
import { AiClientError, newAiRequestId, requestAiJson, type SendDiagnostic } from "./client-transport";

test("secure UUID fallback works without crypto.randomUUID; missing crypto fails before a request",()=>{
  const api={getRandomValues:(bytes:Uint8Array)=>{bytes.fill(7);return bytes;}} as unknown as Crypto;
  assert.match(newAiRequestId(api),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(()=>newAiRequestId({} as Crypto),AiClientError);
});
test("transport sends the actual chat URL and correlated POST without AbortSignal.any/timeout",async()=>{
  const events:SendDiagnostic[]=[];const body={message:"synthetic",requestId:newAiRequestId()};
  const fetcher:typeof fetch=async(url,options)=>{
    assert.equal(url,"/api/ai-assistant");assert.equal(options?.method,"POST");assert.equal(options?.credentials,"same-origin");
    assert.equal(new Headers(options?.headers).get("X-Tayo-AI-Request-Id"),body.requestId);
    assert.deepEqual(JSON.parse(options?.body as string),body);assert.ok(options?.signal);
    return Response.json({answer:"ok"},{headers:{"X-Tayo-AI-Version":"chat-transport-v2"}});
  };
  assert.deepEqual(await requestAiJson("/api/ai-assistant",{body,requestId:body.requestId,diagnostic:value=>events.push(value)},fetcher),{answer:"ok"});
  assert.deepEqual(events.map(e=>e.stage),["sending","received"]);assert.equal(events[1].status,200);
  assert.doesNotMatch(JSON.stringify(events),/synthetic|message/);
});
test("server errors preserve their source, while HTML, redirects and network errors are distinct",async()=>{
  for(const [response,code] of [[Response.json({error:"Tayo AI עדיין לא הוגדר בשרת"},{status:503}),"HTTP_503"],[new Response("<html>proxy error</html>",{status:502}),"NON_JSON_RESPONSE"],[Response.json({error:"יש להתחבר מחדש"},{status:401}),"HTTP_401"]] as const){
    const events:SendDiagnostic[]=[];
    await assert.rejects(requestAiJson("/api/ai-assistant",{body:{},diagnostic:value=>events.push(value)},async()=>response),(error:unknown)=>error instanceof AiClientError&&error.code===code);
    assert.equal(events.at(-1)?.status,response.status);assert.equal(events.at(-1)?.serverVersion,"unknown-or-older");
  }
  const redirected=Response.json({});Object.defineProperty(redirected,"redirected",{value:true});
  await assert.rejects(requestAiJson("/api/ai-assistant",{},async()=>redirected),(error:unknown)=>error instanceof AiClientError&&error.code==="AUTH_REDIRECT");
  await assert.rejects(requestAiJson("/api/ai-assistant",{},async()=>{throw new TypeError("private network details");}),(error:unknown)=>error instanceof AiClientError&&error.code==="CLIENT_NETWORK_FAILED"&&!error.message.includes("private"));
});
test("restore and send have bounded timeouts and caller cancellation",async()=>{
  const hanging:typeof fetch=async(_url,options)=>new Promise((_resolve,reject)=>{options?.signal?.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});});
  await assert.rejects(requestAiJson("/api/ai-assistant?conversationId=test",{timeoutMs:10},hanging),(error:unknown)=>error instanceof AiClientError&&error.code==="CLIENT_TIMEOUT");
  const controller=new AbortController();const result=requestAiJson("/api/ai-assistant",{signal:controller.signal},hanging);controller.abort();
  await assert.rejects(result,(error:unknown)=>error instanceof AiClientError&&error.code==="CLIENT_ABORTED");
});
