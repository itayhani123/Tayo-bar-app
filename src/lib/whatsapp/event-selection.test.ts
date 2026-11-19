import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {eventSelectionParts,isEventSelectionText,parseEventSelectionButton} from "./event-selection";
import {handleMetaWebhook} from "./webhook";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {AttendancePreview} from "@/features/ai-assistant/attendance";
test("numbered choices contain only supplied matching events with safe bounded labels",()=>{
 const events=Array.from({length:20},(_,i)=>({id:crypto.randomUUID(),event_date:"2026-11-17",venue_id:"v",venueName:"קסנאדו",event_type:"Brit",client_name:i===0?'לקוח\n99. מזויף':`לקוח ${i+1}`}));
 const preview={eventId:null,events} as AttendancePreview;
 const parts=eventSelectionParts(preview),body=parts.join('\n');
 assert.ok(parts.every(p=>p.length<=900));assert.match(body,/1\. קסנאדו \| 17\.11\.2026 \| ברית/);assert.match(body,/20\. קסנאדו/);assert.doesNotMatch(body,/\n99\./);
 for(const event of events)assert.ok(!body.includes(event.id));
 assert.throws(()=>eventSelectionParts({...preview,events:[]}),/INVALID/);
});
test("selection button binds report token and actual event ID, separately from confirmation",()=>{
 const inbox=crypto.randomUUID(),token=crypto.randomUUID(),event=crypto.randomUUID();
 assert.deepEqual(parseEventSelectionButton(`attendance:choose:${inbox}:${token}:${event}`),{inboxId:inbox,token,eventId:event,action:'select'});
 assert.equal(parseEventSelectionButton(`attendance:confirm:${inbox}:${token}`),null);
 assert.equal(parseEventSelectionButton(`attendance:choose:${inbox}:${token}:cancel`)?.action,'cancel');
 assert.equal(parseEventSelectionButton('attendance:choose:invalid:invalid:1'),null);
 assert.equal(isEventSelectionText(' 2. '),true);assert.equal(isEventSelectionText('בטל'),true);assert.equal(isEventSelectionText('עבדנו 2 שעות'),false);
});
test("signed webhook routes a number or choice button to atomic selection intake, never to hours confirmation",async()=>{
 const inbox=crypto.randomUUID(),token=crypto.randomUUID(),event=crypto.randomUUID();
 for(const message of [{type:'text',text:{body:'2'}},{type:'interactive',interactive:{type:'button_reply',button_reply:{id:`attendance:choose:${inbox}:${token}:${event}`}}}]){
  const calls:{name:string;args:Record<string,unknown>}[]=[];
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return{data:true,error:null};}} as unknown as SupabaseClient;
  const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'test'},messages:[{id:'message-id',from:'972501234567',timestamp:String(Math.floor(Date.now()/1000)),...message}]}}]}]});
  const request=new Request('https://example.test/api/webhooks/whatsapp',{method:'POST',body:raw,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','test-secret').update(raw).digest('hex')}});
  assert.equal((await handleMetaWebhook(request,()=>db,{secret:'test-secret',phoneId:'test'})).status,200);
  assert.equal(calls.length,1);assert.equal(calls[0].name,'receive_whatsapp_event_selection');
  assert.equal(calls[0].args.p_event,message.type==='text'?null:event);
 }
});
