import assert from "node:assert/strict";
import test from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {handleWhatsAppInbox} from "./whatsapp-inbox-http";
import type {InboxDiagnostic} from "./whatsapp-inbox-errors";
import {buildAttendanceRows} from "./attendance";
import {extracted,employees} from "./attendance-fixture";

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
 for(const[databaseCode,status,code]of[["PGRST202",500,"WHATSAPP_RPC_MISSING"],["42P01",500,"WHATSAPP_TABLE_MISSING"],["42703",500,"WHATSAPP_COLUMN_MISSING"],["PGRST204",500,"WHATSAPP_COLUMN_MISSING"],["42501",403,"WHATSAPP_PERMISSION_DENIED"],["22023",422,"WHATSAPP_INVALID_CONFIGURATION"],["23503",409,"WHATSAPP_ACCOUNT_CHANGED"],["PGRST000",503,"WHATSAPP_DATABASE_UNAVAILABLE"],["PGRST301",500,"WHATSAPP_SERVER_CREDENTIAL_REJECTED"],["57014",504,"WHATSAPP_DATABASE_TIMEOUT"],["XX000",500,"WHATSAPP_INTERNAL_ERROR"]]as const){
  failure={code:databaseCode,message:"private raw SQL 0501234567 972501234567 sk-secret",details:user,hint:actor};
  const response=await handleWhatsAppInbox(request(),deps);const body=await response.json();assert.equal(response.status,status);assert.equal(body.code,code);assert.equal(body.databaseCode,databaseCode);assert.equal(body.requestId,response.headers.get("X-Tayo-WhatsApp-Request-Id"));
  assert.doesNotMatch(JSON.stringify(body),/0501234567|972501234567|private raw|sk-secret/);
 }
 assert.ok(logs.every(log=>log.operation==="configure_sender"));assert.doesNotMatch(JSON.stringify(logs),/0501234567|972501234567|sk-secret|11111111|22222222/);
 role="manager";const before=calls;assert.equal((await handleWhatsAppInbox(request(),deps)).status,403);assert.equal(calls,before);
 role="owner";assert.equal((await handleWhatsAppInbox(request(),{...deps,missingServerConfiguration:["SUPABASE_SERVICE_ROLE_KEY"]})).status,500);assert.equal(calls,before);
});

test("receipt listing logs the exact safe query context and original code with its request ID",async()=>{
 const logs:InboxDiagnostic[]=[];
 let failure:unknown={code:"42703",message:"column whatsapp_attendance_receipts.created_at does not exist private 0501234567"};
 let selected="",ordered="";
 const db={auth:{getUser:async()=>({data:{user:{id:"11111111-1111-4111-8111-111111111111"}},error:null})},from:(table:string)=>{
  const q={select:(columns:string)=>{if(table==="whatsapp_attendance_receipts")selected=columns;return q;},eq:()=>q,in:()=>q,order:(column:string)=>{if(table==="whatsapp_attendance_receipts"){ordered=column;return Promise.resolve({data:null,error:failure});}return q;},limit:async()=>({data:[{id:"report"}],error:null}),single:async()=>({data:{role:"owner"},error:null})};return q;
 }} as unknown as SupabaseClient;
 const deps={createClient:async()=>db,admin:()=>db,log:(entry:InboxDiagnostic)=>logs.push(entry)};
 for(const code of ["42703","PGRST204","42501","PGRST000"]){
  failure={code,message:code==="PGRST204"?"Could not find the 'created_at' column of 'whatsapp_attendance_receipts' in the schema cache": "column whatsapp_attendance_receipts.created_at does not exist private 0501234567"};
  const response=await handleWhatsAppInbox(new Request("https://tayo.test/api/whatsapp/attendance"),deps);
  const body=await response.json(),log=logs.at(-1)!;
  assert.equal(log.requestId,body.requestId);assert.equal(log.operation,"read_receipts");assert.equal(log.databaseCode,code);
  assert.equal(log.databaseTable,"whatsapp_attendance_receipts");
  assert.equal(log.missingColumn,["42703","PGRST204"].includes(code)?"created_at":undefined);
  assert.equal(body.code==="WHATSAPP_COLUMN_MISSING",["42703","PGRST204"].includes(code));
 }
 assert.equal(selected,"inbox_id,status,error_code,kind,created_at");assert.equal(ordered,"created_at");
 assert.doesNotMatch(JSON.stringify(logs),/0501234567|private|11111111/);
});

test("opening a WhatsApp report cannot restore the ordinary chat's separate assignment guard",async()=>{
 const actor="11111111-1111-4111-8111-111111111111";let stored:Record<string,unknown>={};
 const db={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:()=>({abortSignal:async()=>({data:{id:actor,expires_at:"2026-11-12T20:00:00Z"},error:null})}),from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,update:(values:Record<string,unknown>)=>{stored=values;return q;},single:async()=>({data:table==="profiles"?{role:"manager"}:{id:actor,phone:"972501234567",actor_id:actor,status:"review",extracted},error:null}),maybeSingle:async()=>({data:{id:actor},error:null})};return q;
 }} as unknown as SupabaseClient;
 const response=await handleWhatsAppInbox(new Request("https://tayo.test/api/whatsapp/attendance",{method:"POST",headers:{origin:"https://tayo.test","Content-Type":"application/json"},body:JSON.stringify({action:"preview",id:actor,allowNew:false})}),{createClient:async()=>db,admin:()=>db,preview:async(...args)=>{
  assert.equal(args[5],true);
  return{extracted,employees,events:[{id:"event",venueName:"קסנאדו",venue_id:"venue",event_date:"2026-11-12",client_name:"בדיקה"}],eventId:"event",rows:buildAttendanceRows(extracted,employees,[],"2026-11-12"),issues:[],proposalId:actor};
 }});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.confirmationPolicy,"buttons_attendance_v2");assert.ok(body.rows.every((row:{needs_auto_assignment:boolean})=>row.needs_auto_assignment));assert.equal(body.proposalId,actor);assert.deepEqual(stored.preview,body);
});
