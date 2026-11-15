import type { SupabaseClient } from "@supabase/supabase-js";
import { extractAttendance, previewAttendance, previewWhatsAppAttendance, WHATSAPP_ATTENDANCE_POLICY, AttendanceDatabaseError } from "@/features/ai-assistant/attendance-service";
import { AttendanceDeliveryError } from "./attendance-delivery";
import {AttendanceInputError} from "@/features/ai-assistant/attendance-input";
import { attendanceSummary, splitAttendanceMessage, type AttendanceReplyButton } from "./attendance-messages";
import {classifyAttendanceFailure,type AttendanceProcessingStage} from "./attendance-failures";

export type InboxJob = { id: string; provider_message_id?:string; actor_id: string; phone: string; message_text: string; message_at: string; lease_token: string; attempts: number };
type ReceiptJob = { id: string; inbox_id: string; phone: string; message_at: string; lease_token: string; attempts: number; kind?: string; body?: string; part_index?: number; message_payload?: {policy?:string;parts?:string[];buttons?:AttendanceReplyButton[]} };
export const receiptText = "דיווח הנוכחות שלך אושר, וכל שעות העבודה נשמרו באירוע בהצלחה. ניתן לראות את הפרטים באפליקציית Tayo Bar.";
export async function processAttendanceInbox(db: SupabaseClient, signal: AbortSignal, deps: { extract?: typeof extractAttendance; preview?: typeof previewAttendance } = {}) {
  const claimed = await db.rpc("claim_whatsapp_attendance", { p_receipt: false }).abortSignal(signal);
  if (claimed.error) throw new Error("INBOX_CLAIM_FAILED");
  const job = claimed.data as InboxJob | null; if (!job) return 0;
  console.info("WhatsApp attendance worker",{stage:"claimed",reportId:job.id,messageId:job.provider_message_id,attempt:job.attempts,policy:WHATSAPP_ATTENDANCE_POLICY});
  let stage:AttendanceProcessingStage="sender_lookup";
  try {
    const [sender, profile] = await Promise.all([
      db.from("whatsapp_attendance_senders").select("user_id,enabled,auto_save").eq("phone",job.phone).single(),
      db.from("profiles").select("role").eq("id",job.actor_id).single(),
    ]);
    if (sender.error || profile.error) throw new AttendanceDatabaseError(sender.error?"whatsapp_attendance_senders":"profiles",(sender.error??profile.error)?.code);
    if (!sender.data?.enabled || sender.data.user_id!==job.actor_id || !["owner","manager"].includes(profile.data?.role)) {
      await db.from("whatsapp_attendance_inbox").update({ status: "rejected", error_code: "SENDER_REVOKED", lease_until: null }).eq("id",job.id).eq("lease_token",job.lease_token); return 1;
    }
    stage="extraction";
    const extracted = await (deps.extract ?? extractAttendance)(job.message_text,signal);
    // This only prepares existing employees for assignment. The signed, actor-bound
    // WhatsApp confirmation is still mandatory before the atomic write.
    stage="preview";
    const preview = await previewWhatsAppAttendance(db,job.actor_id,profile.data.role,extracted,undefined,signal,deps.preview,job.id);
    stage="pending_approval";
    const result = await db.rpc("complete_whatsapp_attendance_analysis", { p_inbox:job.id,p_lease:job.lease_token,p_extracted:extracted,p_preview:preview,p_parts:attendanceSummary(preview) }).abortSignal(signal);
    if(result.error){
      const failure=new AttendanceDatabaseError("complete_whatsapp_attendance_analysis",result.error.code);
      if(result.error.code==="22023"&&result.error.message==="WHATSAPP_WORKER_VERSION_MISMATCH")failure.message="WHATSAPP_WORKER_VERSION_MISMATCH";
      throw failure;
    }
    console.info("WhatsApp attendance worker",{stage:"prepared",reportId:job.id,messageId:job.provider_message_id,committed:result.data===true,rows:preview.rows.length,issues:preview.issues.length});
    return 1;
  } catch(error) {
    let failureError=error;
    if(error instanceof AttendanceInputError){
      stage="correction";
      const corrected=await db.rpc("request_whatsapp_attendance_correction",{p_inbox:job.id,p_lease:job.lease_token,p_message:error.message}).abortSignal(signal);
      if(corrected.error)failureError=new AttendanceDatabaseError("request_whatsapp_attendance_correction",corrected.error.code);
      else{console.info("WhatsApp attendance worker",{stage:"correction_queued",reportId:job.id,messageId:job.provider_message_id});return 1;}
    }
    const failure=classifyAttendanceFailure(failureError,stage),terminal=!failure.retryable||job.attempts>=5;
    console.error("WhatsApp attendance processing failed",{...failure,reportId:job.id,messageId:job.provider_message_id,attempt:job.attempts,terminal,policy:WHATSAPP_ATTENDANCE_POLICY});
    const result = await db.from("whatsapp_attendance_inbox").update({ status: terminal ? "failed" : "pending", error_code: failure.code, available_at: new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString(), lease_until: null }).eq("id",job.id).eq("status","processing").eq("lease_token",job.lease_token).select("id").maybeSingle();
    if (result.error) {console.error("WhatsApp attendance failure persistence failed",{...classifyAttendanceFailure(new AttendanceDatabaseError("persist_failure",result.error.code),stage),reportId:job.id,attempt:job.attempts});throw new Error("INBOX_RETRY_FAILED");}
    if(!result.data){console.info("WhatsApp attendance lease superseded",{reportId:job.id,attempt:job.attempts});return 1;}
    if(terminal){
      const queued=await db.rpc("queue_whatsapp_attendance_failure",{p_inbox:job.id,p_lease:job.lease_token});
      if(queued.error){console.error("WhatsApp attendance failure notification failed",{...classifyAttendanceFailure(new AttendanceDatabaseError("queue_whatsapp_attendance_failure",queued.error.code),stage),reportId:job.id,attempt:job.attempts});throw new Error("FAILURE_FEEDBACK_FAILED");}
    }
    return 1;
  }
}
export async function processAttendanceReceipt(db: SupabaseClient, send: (phone: string, text: string, useTemplate: boolean, buttons?: AttendanceReplyButton[], kind?:string) => Promise<string>, signal: AbortSignal, hasTemplate: boolean, hasUpdateTemplate = false) {
  const claimed = await db.rpc("claim_whatsapp_attendance", { p_receipt: true }).abortSignal(signal);
  if (claimed.error) throw new Error("RECEIPT_CLAIM_FAILED");
  const job = claimed.data as ReceiptJob | null; if (!job) return 0;
  try {
    if(job.kind==="summary"&&job.message_payload?.policy!==WHATSAPP_ATTENDANCE_POLICY)throw new AttendanceDeliveryError("SUMMARY_POLICY_OUTDATED",false);
    if(job.kind==="summary"&&!job.message_payload?.buttons?.length)throw new AttendanceDeliveryError("INTERACTIVE_REQUIRED",false);
    if(job.kind){
      const report=await db.from("whatsapp_attendance_inbox").select("actor_id,status").eq("id",job.inbox_id).single();
      if(report.error)throw report.error;
      const sender=await db.from("whatsapp_attendance_senders").select("user_id,enabled").eq("phone",job.phone).single();
      const profile=await db.from("profiles").select("role").eq("id",report.data.actor_id).single();
      if(sender.error||profile.error)throw new Error("DELIVERY_AUTH_UNAVAILABLE");
      if(!sender.data.enabled||sender.data.user_id!==report.data.actor_id||!["owner","manager"].includes(profile.data.role)||(job.kind==="summary"&&report.data.status!=="review")){
        const expired=await db.from("whatsapp_attendance_receipts").update({status:"expired",error_code:"DELIVERY_SUPERSEDED_OR_UNAUTHORIZED",lease_until:null}).eq("id",job.id).eq("lease_token",job.lease_token);if(expired.error)throw expired.error;return 1;
      }
    }
    const latest = await db.rpc("whatsapp_attendance_service_window",{p_phone:job.phone}).abortSignal(signal);
    if (latest.error) throw new Error("WINDOW_LOOKUP_FAILED");
    const lastAt=Date.parse(latest.data as string);
    const outsideWindow = !Number.isFinite(lastAt)||Date.now()-lastAt>23.9*3600000;
    if(job.kind==="summary"&&outsideWindow)throw new AttendanceDeliveryError("INTERACTIVE_WINDOW_CLOSED",false);
    const templateAvailable=job.kind&&job.kind!=="result"?hasUpdateTemplate:hasTemplate;
    if (outsideWindow && !templateAvailable) {
      const expired = await db.from("whatsapp_attendance_receipts").update({ status: "expired", error_code: "APPROVED_TEMPLATE_REQUIRED", lease_until: null }).eq("id",job.id).eq("lease_token",job.lease_token);
      if (expired.error) throw new Error("RECEIPT_SAVE_FAILED"); return 1;
    }
    const parts=job.message_payload?.parts??splitAttendanceMessage(job.body||receiptText);
    const index=job.part_index??0;
    const final=outsideWindow||index>=parts.length-1;
    const providerId = await send(job.phone,parts[index]||receiptText,outsideWindow,final&&!outsideWindow?job.message_payload?.buttons:undefined,job.kind);
    const updated = await db.rpc("ack_whatsapp_attendance_receipt",{p_receipt:job.id,p_lease:job.lease_token,p_provider:providerId,p_final:final,p_next_index:final?parts.length:index+1}).abortSignal(signal);
    if (updated.error) throw new Error("RECEIPT_SAVE_FAILED");
    if(updated.data!==true)throw new AttendanceDeliveryError("DELIVERY_ACK_NOT_COMMITTED",true);
    console.info("WhatsApp attendance delivery",{stage:"acknowledged",reportId:job.inbox_id,receiptId:job.id,messageId:providerId,final,committed:updated.data===true});
  } catch(error) {
    const delivery=error instanceof AttendanceDeliveryError?error:null;
    const code=delivery?.code??"RECEIPT_SEND_FAILED";
    const result = await db.from("whatsapp_attendance_receipts").update({ status: job.attempts>=5 || delivery?.retryable===false ? "failed" : "pending", error_code: code, available_at: new Date(Date.now()+60*2**job.attempts*1000).toISOString(), lease_until: null }).eq("id",job.id).eq("lease_token",job.lease_token);
    if (result.error) throw new Error("RECEIPT_RETRY_FAILED");
    console.error("WhatsApp attendance delivery failed",{code,reportId:job.inbox_id,receiptId:job.id,attempt:job.attempts,...(delivery?.httpStatus?{httpStatus:delivery.httpStatus}:{}),...(delivery?.metaCode?{metaCode:delivery.metaCode}:{})});
  }
  return 1;
}

export async function processAttendanceDecision(db:SupabaseClient,signal:AbortSignal){
 const claimed=await db.rpc("claim_whatsapp_attendance_decision").abortSignal(signal);
 if(claimed.error)throw new Error("DECISION_CLAIM_FAILED");
 const job=claimed.data as {id:string;lease_token:string}|null;if(!job)return 0;
 const result=await db.rpc("execute_whatsapp_attendance_decision",{p_id:job.id,p_lease:job.lease_token}).abortSignal(signal);
 if(result.error){console.error("WhatsApp attendance decision outcome unverified",{code:"DECISION_RECHECK_REQUIRED"});throw new Error("DECISION_RECHECK_REQUIRED");}
 console.info("WhatsApp attendance decision",{decisionId:job.id,status:(result.data as {status?:string})?.status});
 return 1;
}
