import assert from "node:assert/strict";
import test from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {processAttendanceInbox,processAttendanceReceipt,canAutoSave} from "./attendance-worker";
import {buildAttendanceRows,type AttendancePreview} from "@/features/ai-assistant/attendance";
import {employees,extracted} from "@/features/ai-assistant/attendance-fixture";

const actor="11111111-1111-4111-8111-111111111111";
const preview:AttendancePreview={extracted,employees,events:[{id:"event",event_date:"2026-11-12",venue_id:"v",venueName:"קסנאדו",client_name:"לקוח"}],eventId:"event",rows:buildAttendanceRows(extracted,employees,[],"2026-11-12").map(r=>({...r,operation:"update"})),issues:[],proposalId:"proposal"};
function mock(options:{revoked?:boolean;auto?:boolean;old?:boolean;attempts?:number;kind?:string;partIndex?:number;reportStatus?:string}={}) {
 const updates:{table:string;values:Record<string,unknown>;filters:string[]}[]=[];let approvals=0;
 const db={
  rpc(name:string,args:Record<string,unknown>){const result=()=>{if(name==="whatsapp_attendance_service_window")return{data:new Date(Date.now()-(options.old?25:1)*3600000).toISOString(),error:null};if(name==="claim_whatsapp_attendance")return{data:{id:"job",inbox_id:"inbox",actor_id:actor,phone:"972501234567",message_text:"input",lease_token:"lease",attempts:options.attempts??1,kind:options.kind,part_index:options.partIndex??0,message_payload:options.kind==="summary"?{parts:["summary text","confirmation text"],buttons:[{id:"bound-command",title:"אשר דיווח"}]}:undefined},error:null};if(name==="complete_whatsapp_attendance_analysis"){updates.push({table:"whatsapp_attendance_inbox",values:{status:"review"},filters:["lease_token"]});return{data:true,error:null};}if(name==="queue_whatsapp_attendance_failure")return{data:true,error:null};assert.equal(name,"approve_whatsapp_attendance");assert.equal(args.p_automatic,true);approvals++;return{data:{status:"succeeded"},error:null};};return{abortSignal:async()=>result(),then:(resolve:(value:unknown)=>void)=>resolve(result())};},
  from(table:string){let values:Record<string,unknown>={};const filters:string[]=[];const q={
   select:()=>q,update:(v:Record<string,unknown>)=>{values=v;return q;},eq:(field:string)=>{filters.push(field);return q;},order:()=>q,limit:()=>q,
   single:async()=>({data:table==="profiles"?{role:options.revoked?"employee":"manager"}:table==="whatsapp_attendance_senders"?{enabled:true,user_id:actor,auto_save:options.auto??false}:{actor_id:actor,status:options.reportStatus??"review",message_at:new Date(Date.now()-(options.old?25:1)*3600000).toISOString()},error:null}),
   maybeSingle:async()=>{updates.push({table,values,filters});return{data:{id:"job"},error:null};},
   then:(resolve:(v:unknown)=>void)=>{updates.push({table,values,filters});resolve({data:null,error:null});},
  };return q;},
 }as unknown as SupabaseClient;
 return{db,updates,approvals:()=>approvals};
}
test("inbound worker uses existing parser, persists review by default, fences leases and requires both auto-save opt-ins",async()=>{
 const signal=new AbortController().signal;
 const deps={extract:async()=>extracted,preview:async()=>preview};
 const normal=mock({auto:true});await processAttendanceInbox(normal.db,signal,deps);
 assert.equal(normal.approvals(),0);assert.equal(normal.updates[0].values.status,"review");assert.ok(normal.updates[0].filters.includes("lease_token"));
 const automatic=mock({auto:true});await processAttendanceInbox(automatic.db,signal,{...deps,autoEnabled:true});assert.equal(automatic.approvals(),1);
 const noOptIn=mock();await processAttendanceInbox(noOptIn.db,signal,{...deps,autoEnabled:true});assert.equal(noOptIn.approvals(),0);
 const revoked=mock({revoked:true});await processAttendanceInbox(revoked.db,signal,{...deps,extract:async()=>{throw new Error("must not call AI");}});assert.equal(revoked.updates[0].values.status,"rejected");
 const failed=mock({attempts:5});await processAttendanceInbox(failed.db,signal,{...deps,extract:async()=>{throw new Error("timeout");}});assert.equal(failed.updates[0].values.status,"failed");
 assert.equal(canAutoSave({...preview,rows:[{...preview.rows[0],previousStart:"existing"}]}),false);
 assert.equal(canAutoSave({...preview,rows:[{...preview.rows[0],operation:"create"}]}),false);
});
test("summary chunks are durable, buttons appear only on final chunk, revoked/superseded delivery stops and non-success uses update templates",async()=>{
 const signal=new AbortController().signal;
 const first=mock({kind:"summary"});
 await processAttendanceReceipt(first.db,async(_phone,text,template,buttons)=>{assert.equal(text,"summary text");assert.equal(template,false);assert.equal(buttons,undefined);return"part-id";},signal,false);
 assert.equal(first.updates[0].values.status,"pending");assert.equal(first.updates[0].values.part_index,1);assert.equal(first.updates[0].values.provider_message_id,null);
 const last=mock({kind:"summary",partIndex:1});
 await processAttendanceReceipt(last.db,async(_phone,text,_template,buttons)=>{assert.equal(text,"confirmation text");assert.equal(buttons?.[0].title,"אשר דיווח");return"final-id";},signal,false);
 assert.equal(last.updates[0].values.status,"sent");
 for(const options of[{kind:"summary",reportStatus:"approved"},{kind:"summary",revoked:true}]){
  const blocked=mock(options);await processAttendanceReceipt(blocked.db,async()=>{throw new Error("must not send");},signal,false);assert.equal(blocked.updates[0].values.status,"expired");
 }
 const outside=mock({kind:"feedback",old:true});await processAttendanceReceipt(outside.db,async()=>{throw new Error("must not send success template");},signal,true,false);assert.equal(outside.updates[0].values.status,"expired");
 const update=mock({kind:"feedback",old:true});await processAttendanceReceipt(update.db,async(_p,_t,template,_b,kind)=>{assert.equal(template,true);assert.equal(kind,"feedback");return"update-id";},signal,false,true);assert.equal(update.updates[0].values.status,"sent");
});
test("receipt worker respects Meta service window, requires approved template after expiry, and retries independently of attendance",async()=>{
 const signal=new AbortController().signal;let sends=0;
 const expired=mock({old:true});await processAttendanceReceipt(expired.db,async()=>{sends++;return"id";},signal,false);assert.equal(sends,0);assert.equal(expired.updates[0].values.status,"expired");
 const late=mock({old:true});await processAttendanceReceipt(late.db,async(_phone,text,template)=>{sends++;assert.equal(template,true);assert.ok(text.includes("נשמרו"));return"provider-id";},signal,true);assert.equal(late.updates[0].values.status,"sent");
 const recent=mock();await processAttendanceReceipt(recent.db,async(_phone,_text,template)=>{assert.equal(template,false);return"id";},signal,false);assert.equal(recent.updates[0].values.status,"sent");
 const retry=mock();await processAttendanceReceipt(retry.db,async()=>{throw new Error("network");},signal,false);assert.equal(retry.updates[0].values.status,"pending");assert.equal(retry.updates[0].table,"whatsapp_attendance_receipts");
});
