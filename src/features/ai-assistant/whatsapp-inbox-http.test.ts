import assert from "node:assert/strict";
import test from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {handleWhatsAppInbox} from "./whatsapp-inbox-http";

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
