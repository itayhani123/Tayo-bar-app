import assert from "node:assert/strict";
import test from "node:test";
import {createHmac} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {handleMetaWebhook,validMetaSignature} from "./webhook";

test("Meta webhook authenticates exact raw bytes, fails closed, scopes phone, preserves status handling and awaits durable intake",async()=>{
 const secret="test-secret";let received=0,statuses=0,failure=false;
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{assert.equal(name,"receive_whatsapp_attendance");assert.equal(args.p_message_id,"wamid.test");received++;return{data:true,error:failure?new Error("database unavailable"):null};},from:()=>({update:()=>({eq:async()=>{statuses++;return{error:null};}})})} as unknown as SupabaseClient;
 const envelope={object:"whatsapp_business_account",entry:[{changes:[{value:{metadata:{phone_number_id:"phone-id"},messages:[{id:"wamid.test",from:"972501234567",timestamp:String(Math.floor(Date.now()/1000)),type:"text",text:{body:"הגעה\nנדב 16:15"}}],statuses:[{id:"outgoing",status:"delivered"}]}}]}]};
 const raw=JSON.stringify(envelope);
 const request=(text=raw,sign=true)=>new Request("https://tayo.test/api/webhooks/whatsapp",{method:"POST",headers:sign?{"x-hub-signature-256":"sha256="+createHmac("sha256",secret).update(text).digest("hex")}:undefined,body:text});
 assert.equal(validMetaSignature(Buffer.from(raw),null,secret),false);
 assert.equal((await handleMetaWebhook(request(),()=>db,{secret:undefined,phoneId:"phone-id"})).status,503);
 assert.equal((await handleMetaWebhook(request(raw,false),()=>db,{secret,phoneId:"phone-id"})).status,401);
 assert.equal((await handleMetaWebhook(request(),()=>db,{secret,phoneId:"other"})).status,200);assert.equal(received,0);
 assert.equal((await handleMetaWebhook(request("{bad"),()=>db,{secret,phoneId:"phone-id"})).status,400);
 assert.equal((await handleMetaWebhook(request(),()=>db,{secret,phoneId:"phone-id"})).status,200);assert.equal(received,1);assert.equal(statuses,2);
 failure=true;assert.equal((await handleMetaWebhook(request(),()=>db,{secret,phoneId:"phone-id"})).status,503);
 const tampered=new Request("https://tayo.test/api/webhooks/whatsapp",{method:"POST",headers:{"x-hub-signature-256":"sha256="+createHmac("sha256",secret).update(raw).digest("hex")},body:raw+" "});
 assert.equal((await handleMetaWebhook(tampered,()=>db,{secret,phoneId:"phone-id"})).status,401);
});
