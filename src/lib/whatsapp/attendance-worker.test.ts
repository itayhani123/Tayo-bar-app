import assert from "node:assert/strict";
import test from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {processAttendanceInbox,processAttendanceReceipt} from "./attendance-worker";
import {buildAttendanceRows,type AttendancePreview} from "@/features/ai-assistant/attendance";
import {employees,extracted} from "@/features/ai-assistant/attendance-fixture";
import {WHATSAPP_ATTENDANCE_POLICY} from "@/features/ai-assistant/attendance-service";
import {AttendanceDeliveryError} from "./attendance-delivery";
import {AttendanceInputError} from "@/features/ai-assistant/attendance-input";

const actor="11111111-1111-4111-8111-111111111111";
const attendanceText="יום ראשון 15/11\nאפטאון\nיונתן לולו 12:30-17:35";
const preview:AttendancePreview={extracted,employees,events:[{id:"event",event_date:"2026-11-12",venue_id:"v",venueName:"קסנאדו",client_name:"לקוח"}],eventId:"event",rows:buildAttendanceRows(extracted,employees,[],"2026-11-12").map(r=>({...r,operation:"update"})),issues:[],proposalId:"proposal"};
function mock(options:{text?:string;reportType?:string;revoked?:boolean;auto?:boolean;old?:boolean;attempts?:number;kind?:string;partIndex?:number;reportStatus?:string;legacy?:boolean;commitError?:{code:string;message:string}}={}) {
 const updates:{table:string;values:Record<string,unknown>;filters:string[]}[]=[];let approvals=0;
 const db={
  rpc(name:string,args:Record<string,unknown>){const result=()=>{if(name==="bind_whatsapp_attendance_proposal")return{data:{id:"proposal",expires_at:"2026-11-12T20:00:00Z"},error:null};if(name==="ack_whatsapp_attendance_receipt"){updates.push({table:"whatsapp_attendance_receipts",values:{status:args.p_final?"sent":"pending",part_index:args.p_next_index,provider_message_id:args.p_final?args.p_provider:null},filters:["lease_token"]});return{data:true,error:null};}if(name==="request_whatsapp_attendance_correction"){updates.push({table:"whatsapp_attendance_inbox",values:{status:"review",error_code:"INPUT_CORRECTION_REQUIRED",body:args.p_message},filters:["lease_token"]});return{data:true,error:null};}if(name==="whatsapp_attendance_service_window")return{data:new Date(Date.now()-(options.old?25:1)*3600000).toISOString(),error:null};if(name==="claim_whatsapp_attendance")return{data:{id:"job",inbox_id:"inbox",actor_id:actor,phone:"972501234567",message_text:options.text??attendanceText,report_type:options.reportType,lease_token:"lease",attempts:options.attempts??1,kind:options.kind,part_index:options.partIndex??0,message_payload:options.kind==="summary"?{policy:options.legacy?undefined:WHATSAPP_ATTENDANCE_POLICY,parts:["summary text","confirmation text"],buttons:[{id:"bound-command",title:"אשר דיווח"}]}:undefined},error:null};if(name==="complete_whatsapp_attendance_analysis"){assert.equal((args.p_preview as AttendancePreview).confirmationPolicy,WHATSAPP_ATTENDANCE_POLICY);if(options.commitError)return{data:null,error:options.commitError};updates.push({table:"whatsapp_attendance_inbox",values:{status:"review"},filters:["lease_token"]});return{data:true,error:null};}if(name==="queue_whatsapp_attendance_failure")return{data:true,error:null};assert.equal(name,"approve_whatsapp_attendance");assert.equal(args.p_automatic,true);approvals++;return{data:{status:"succeeded"},error:null};};return{abortSignal:async()=>result(),then:(resolve:(value:unknown)=>void)=>resolve(result())};},
  from(table:string){let values:Record<string,unknown>={};const filters:string[]=[];const q={
   select:()=>q,update:(v:Record<string,unknown>)=>{values=v;return q;},eq:(field:string)=>{filters.push(field);return q;},order:()=>q,limit:()=>q,
   single:async()=>({data:table==="profiles"?{role:options.revoked?"employee":"manager"}:table==="whatsapp_attendance_senders"?{enabled:true,user_id:actor,auto_save:options.auto??false}:{actor_id:actor,status:options.reportStatus??"review",message_at:new Date(Date.now()-(options.old?25:1)*3600000).toISOString()},error:null}),
   maybeSingle:async()=>{updates.push({table,values,filters});return{data:{id:"job"},error:null};},
   then:(resolve:(v:unknown)=>void)=>{updates.push({table,values,filters});resolve({data:null,error:null});},
  };return q;},
 }as unknown as SupabaseClient;
 return{db,updates,approvals:()=>approvals};
}
test("inbound worker prepares existing employee assignments, fences leases and always requires explicit approval",async()=>{
 const signal=new AbortController().signal;
 const deps={extract:async()=>extracted,preview:async(...args:Parameters<typeof import("@/features/ai-assistant/attendance-service").previewAttendance>)=>{assert.equal(args[5],true);return preview;}};
 const normal=mock({auto:true});await processAttendanceInbox(normal.db,signal,deps);
 assert.equal(normal.approvals(),0);assert.equal(normal.updates[0].values.status,"review");assert.ok(normal.updates[0].filters.includes("lease_token"));
 const legacySetting=process.env.WHATSAPP_ATTENDANCE_AUTO_SAVE_ENABLED;
 try{process.env.WHATSAPP_ATTENDANCE_AUTO_SAVE_ENABLED="true";const automatic=mock({auto:true});await processAttendanceInbox(automatic.db,signal,deps);assert.equal(automatic.approvals(),0);}finally{if(legacySetting===undefined)delete process.env.WHATSAPP_ATTENDANCE_AUTO_SAVE_ENABLED;else process.env.WHATSAPP_ATTENDANCE_AUTO_SAVE_ENABLED=legacySetting;}
 const revoked=mock({revoked:true});await processAttendanceInbox(revoked.db,signal,{...deps,extract:async()=>{throw new Error("must not call AI");}});assert.equal(revoked.updates[0].values.status,"rejected");
 const failed=mock({attempts:5});await processAttendanceInbox(failed.db,signal,{...deps,extract:async()=>{throw new Error("timeout");}});assert.equal(failed.updates[0].values.status,"failed");
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

test("button delivery failure, old summary and closed window never publish an available confirmation",async()=>{
 const signal=new AbortController().signal;
 const failed=mock({kind:"summary",partIndex:1});let sends=0;
 await processAttendanceReceipt(failed.db,async()=>{sends++;throw new AttendanceDeliveryError("META_BUTTONS_NOT_ACCEPTED",false,400,131009);},signal,false);
 assert.equal(sends,1);assert.equal(failed.updates[0].values.status,"failed");assert.equal(failed.updates[0].values.error_code,"META_BUTTONS_NOT_ACCEPTED");assert.equal(failed.updates[0].values.provider_message_id,undefined);
 for(const options of [{kind:"summary",legacy:true},{kind:"summary",old:true}]){
  const blocked=mock(options);await processAttendanceReceipt(blocked.db,async()=>{throw new Error("must not send text/template approval");},signal,true,true);
  assert.equal(blocked.updates[0].values.status,"failed");assert.equal(blocked.updates[0].values.error_code,options.legacy?"SUMMARY_POLICY_OUTDATED":"INTERACTIVE_WINDOW_CLOSED");
 }
});

test("ambiguous 17:3 is a durable correction reply, not a silent retry or partial attendance save",async()=>{
 const state=mock();await processAttendanceInbox(state.db,new AbortController().signal,{extract:async()=>{throw new AttendanceInputError('⚠️ השעה "17:3" אינה תקינה. שלחו שעה מלאה.');}});
 assert.equal(state.updates.length,1);assert.equal(state.updates[0].values.error_code,"INPUT_CORRECTION_REQUIRED");assert.match(String(state.updates[0].values.body),/17:3/);assert.equal(state.approvals(),0);
});

test("worker reclassifies old attendance queue inventory rows before parsing; ambiguous messages get durable clarification",async()=>{
 for(const text of["נצרכו באפטאון 4 בקבוקים", "קליטת מלאי 12 גרייגוס"]){
  const state=mock({text,reportType:"attendance"});let processed=0;
  await processAttendanceInbox(state.db,new AbortController().signal,{extract:async()=>{throw new Error("inventory reached attendance parser");},inventory:async()=>{processed++;return true;}});
  assert.equal(processed,1);assert.equal(state.updates[0].values.report_type,"inventory");assert.ok(state.updates[0].filters.includes("lease_token"));
 }
 const ambiguous=mock({text:"4 גרייגוס"});
 await processAttendanceInbox(ambiguous.db,new AbortController().signal,{extract:async()=>{throw new Error("ambiguous reached attendance parser");},inventory:async()=>{throw new Error("ambiguous reached inventory parser");}});
 assert.equal(ambiguous.updates.length,1);assert.equal(ambiguous.updates[0].values.error_code,"INPUT_CORRECTION_REQUIRED");assert.match(String(ambiguous.updates[0].values.body),/מה תרצו לדווח/);assert.equal(ambiguous.approvals(),0);
 const attendance=mock({reportType:"inventory"});let extractedCount=0;
 await processAttendanceInbox(attendance.db,new AbortController().signal,{extract:async()=>{extractedCount++;return extracted;},preview:async()=>preview,inventory:async()=>{throw new Error("attendance reached inventory parser");}});
 assert.equal(extractedCount,1);assert.equal(attendance.updates[0].values.report_type,"attendance");
});

test("real 22023 policy mismatch is preserved at pending approval and stops retrying; schema/RLS failures retain safe causes",async()=>{
 const errors:unknown[]=[];const original=console.error;console.error=(...args:unknown[])=>{errors.push(args[1]);};
 try{
  for(const [code,message,expected]of [["22023","WHATSAPP_WORKER_VERSION_MISMATCH","WHATSAPP_WORKER_VERSION_MISMATCH"],["42703","private SQL phone 0501234567 key sk-secret","WHATSAPP_SCHEMA_MISSING"],["42501","private permission error","WHATSAPP_DATABASE_PERMISSION_DENIED"]]){
   const state=mock({commitError:{code,message}});await processAttendanceInbox(state.db,new AbortController().signal,{extract:async()=>extracted,preview:async()=>preview});
   assert.equal(state.updates.length,1);assert.equal(state.updates[0].values.status,"failed");assert.equal(state.updates[0].values.error_code,expected);assert.equal(state.approvals(),0);
   const diagnostic=errors.at(-1) as {stage:string;originalCode:string;terminal:boolean;safeMessage:string};
   assert.equal(diagnostic.stage,"pending_approval");assert.equal(diagnostic.originalCode,code);assert.equal(diagnostic.terminal,true);assert.ok(diagnostic.safeMessage);
  }
  assert.doesNotMatch(JSON.stringify(errors),/0501234567|sk-secret|private SQL|private permission/);
 }finally{console.error=original;}
});

test("OpenAI rate limiting retries at most five attempts and a permanent API rejection stops immediately",async()=>{
 for(const [status,attempts,expected]of [[429,1,"pending"],[429,5,"failed"],[400,1,"failed"],[401,1,"failed"]] as const){
  const state=mock({attempts});await processAttendanceInbox(state.db,new AbortController().signal,{extract:async()=>{throw{status,code:status===429?"rate_limit_exceeded":"invalid_json_schema",message:"private response sk-secret"};}});
  assert.equal(state.updates[0].values.status,expected);assert.notEqual(state.updates[0].values.error_code,"PROCESSING_FAILED");assert.equal(state.approvals(),0);
 }
});
