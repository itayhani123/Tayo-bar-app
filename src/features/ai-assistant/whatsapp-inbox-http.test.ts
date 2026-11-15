import assert from "node:assert/strict";
import test from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {handleWhatsAppInbox} from "./whatsapp-inbox-http";
import type {InboxDiagnostic} from "./whatsapp-inbox-errors";

test("WhatsApp inbox API binds reviewer identity, requires click confirmation and reserves sender configuration for owners",async()=>{
 const actor="11111111-1111-4111-8111-111111111111";let role="manager",authenticated=true,calls=0;
 const db={auth:{getUser:async()=>({data:{user:authenticated?{id:actor}:null},error:null})},from:()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{role},error:null})};return q;},rpc:(_name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{calls++;assert.equal(args.p_actor,actor);return{data:{status:"succeeded"},error:null};}})}as unknown as SupabaseClient;
 const deps={createClient:async()=>db,admin:()=>db};
 const request=(body:unknown,origin="https://tayo.test")=>new Request("https://tayo.test/api/whatsapp/attendance",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
 const confirm={action:"confirm",id:actor,proposalId:actor,confirmed:true};
 assert.equal((await handleWhatsAppInbox(request(confirm,"https://evil.test"),deps)).status,403);
 authenticated=false;assert.equal((await handleWhatsAppInbox(request(confirm),deps)).status,401);
 authenticated=true;role="employee";assert.equal((await handleWhatsAppInbox(request(confirm),deps)).status,403);role="manager";
 assert.equal((await handleWhatsAppInbox(request({action:"confirm",id:actor,proposalId:actor}),deps)).status,400);
 assert.equal((await handleWhatsAppInbox(request({...confirm,actorId:actor}),deps)).status,400);
 assert.equal((await handleWhatsAppInbox(request({action:"configure",phone:"0501234567",userId:actor,enabled:true,autoSave:false}),deps)).status,403);
 assert.equal(calls,0);assert.equal((await handleWhatsAppInbox(request(confirm),deps)).status,200);assert.equal(calls,1);
});
test("sender save returns actual schema, permission, validation and connection failures without leaking input or raw SQL errors",async()=>{
 const actor="11111111-1111-4111-8111-111111111111",user="22222222-2222-4222-8222-222222222222";
 let role="owner",failure:unknown=null,calls=0;const logs:InboxDiagnostic[]=[];
 const db={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from:()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{role},error:null})};return q;},rpc:(name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{calls++;assert.equal(name,"configure_whatsapp_attendance_sender");assert.deepEqual(args,{p_actor:actor,p_phone:"972501234567",p_user:user,p_enabled:true,p_auto:false});return{data:null,error:failure};}})}as unknown as SupabaseClient;
 const request=()=>new Request("https://tayo.test/api/whatsapp/attendance",{method:"POST",headers:{origin:"https://tayo.test","Content-Type":"application/json"},body:JSON.stringify({action:"configure",phone:"0501234567",userId:user,enabled:true,autoSave:false})});
 const deps={createClient:async()=>db,admin:()=>db,log:(entry:InboxDiagnostic)=>logs.push(entry)};
 assert.equal((await handleWhatsAppInbox(request(),deps)).status,200);
 for(const[databaseCode,status,code]of[["PGRST202",500,"WHATSAPP_RPC_MISSING"],["42P01",500,"WHATSAPP_TABLE_MISSING"],["42703",500,"WHATSAPP_COLUMN_MISSING"],["42501",403,"WHATSAPP_PERMISSION_DENIED"],["22023",422,"WHATSAPP_INVALID_CONFIGURATION"],["23503",409,"WHATSAPP_ACCOUNT_CHANGED"],["PGRST000",503,"WHATSAPP_DATABASE_UNAVAILABLE"],["57014",504,"WHATSAPP_DATABASE_TIMEOUT"],["XX000",500,"WHATSAPP_INTERNAL_ERROR"]]as const){
  failure={code:databaseCode,message:"private raw SQL 0501234567 972501234567 sk-secret",details:user,hint:actor};
  const response=await handleWhatsAppInbox(request(),deps);const body=await response.json();assert.equal(response.status,status);assert.equal(body.code,code);assert.equal(body.databaseCode,databaseCode);assert.equal(body.requestId,response.headers.get("X-Tayo-WhatsApp-Request-Id"));
  assert.doesNotMatch(JSON.stringify(body),/0501234567|972501234567|private raw|sk-secret/);
 }
 assert.ok(logs.every(log=>log.operation==="configure_sender"));assert.doesNotMatch(JSON.stringify(logs),/0501234567|972501234567|sk-secret|11111111|22222222/);
 role="manager";const before=calls;assert.equal((await handleWhatsAppInbox(request(),deps)).status,403);assert.equal(calls,before);
 role="owner";assert.equal((await handleWhatsAppInbox(request(),{...deps,missingServerConfiguration:["SUPABASE_SERVICE_ROLE_KEY"]})).status,500);assert.equal(calls,before);
});
