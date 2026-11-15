// Diagnosis only: reads a queued report, calls OpenAI and STABLE catalog/snapshot
// RPCs, and stops before registration/binding or any business/queue write.
// node --env-file=.env.local --import ./scripts/test-register.mjs scripts/reproduce-whatsapp-processing.mjs
import {createClient} from "@supabase/supabase-js";
import {extractAttendance,previewAttendance} from "../src/features/ai-assistant/attendance-service.ts";
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const output=value=>console.log(JSON.stringify(value));
let stage="read_report";
try{
 const read=await db.from("whatsapp_attendance_inbox").select("id,actor_id,message_text,status,attempts,error_code").in("status",["pending","failed"]).order("received_at",{ascending:false}).limit(1).single();
 if(read.error)throw read.error;const report=read.data;
 output({stage,reportId:report.id,status:report.status,attempt:report.attempts,errorCode:report.error_code});
 stage="sender_role";const profile=await db.from("profiles").select("role").eq("id",report.actor_id).single();if(profile.error)throw profile.error;
 stage="openai_extract";const extraction=await extractAttendance(report.message_text,AbortSignal.timeout(40000));output({stage,entries:extraction.entries.length,day:extraction.day,month:extraction.month,year:extraction.year,weekday:extraction.weekday});
 const safeDb={rpc(name,args){return{abortSignal:async()=>{
  stage=name;
  if(name==="register_ai_attendance"){output({stage,stoppedBeforeWrite:true});return{data:{id:"00000000-0000-4000-8000-000000000000",expires_at:new Date(Date.now()+600000).toISOString()},error:null};}
  if(!["ai_attendance_catalog","ai_attendance_snapshot"].includes(name))throw new Error("UNSAFE_DIAGNOSTIC_OPERATION");
  const result=await db.rpc(name,args).abortSignal(AbortSignal.timeout(15000));output({stage,databaseCode:result.error?.code||null,success:!result.error});
  return result;
 }};}};
 const preview=await previewAttendance(safeDb,report.actor_id,profile.data.role,extraction,undefined,true,AbortSignal.timeout(40000));
 output({stage:"preview_complete",events:preview.events.length,eventSelected:Boolean(preview.eventId),rows:preview.rows.length,issues:preview.issues.length,rowIssues:preview.rows.map(row=>row.issues.length),prepared:Boolean(preview.proposalId),noWrites:true});
 // Synthetic version probes only: no attendance payload, names or snapshot in
 // URLs. The zero report/lease IDs cannot identify or update a live report.
 for(const policy of [null,"buttons_auto_assignment_v1","buttons_attendance_v2"]){
  const endpoint=new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/complete_whatsapp_attendance_analysis`);
  for(const[k,v]of Object.entries({p_inbox:"00000000-0000-0000-0000-000000000000",p_lease:"00000000-0000-0000-0000-000000000000",p_extracted:"{}",p_preview:JSON.stringify({confirmationPolicy:policy}),p_parts:"[]"}))endpoint.searchParams.set(k,v);
  const response=await fetch(endpoint,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(15000)});
  const data=await response.json();output({stage:"synthetic_policy_probe",policy:policy||"legacy_unversioned",databaseCode:data?.code||null,workerVersionMismatch:data?.message==="WHATSAPP_WORKER_VERSION_MISMATCH",passedPolicyGuard:response.ok||data?.code==="25006"});
 }
}catch(error){
 const code=typeof error?.code==="string"&&/^[a-zA-Z0-9_]{1,60}$/.test(error.code)?error.code:undefined;
 output({stage,failed:true,code,status:typeof error?.status==="number"?error.status:undefined,invalidSchema:code==="invalid_json_schema",databaseCode:error?.databaseCode,operation:error?.operation});
 process.exitCode=1;
}
