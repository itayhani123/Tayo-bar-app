import type { SupabaseClient } from "@supabase/supabase-js";
import { extractAttendance, previewAttendance } from "@/features/ai-assistant/attendance-service";
import type { AttendancePreview } from "@/features/ai-assistant/attendance";
import { attendanceSummary, splitAttendanceMessage, type AttendanceReplyButton } from "./attendance-messages";

export type InboxJob = { id: string; actor_id: string; phone: string; message_text: string; message_at: string; lease_token: string; attempts: number };
type ReceiptJob = { id: string; inbox_id: string; phone: string; message_at: string; lease_token: string; attempts: number; kind?: string; body?: string; part_index?: number; message_payload?: {parts?:string[];buttons?:AttendanceReplyButton[]} };
export const receiptText = "דיווח הנוכחות שלך אושר, וכל שעות העבודה נשמרו באירוע בהצלחה. ניתן לראות את הפרטים באפליקציית Tayo Bar.";
export function canAutoSave(preview: AttendancePreview) {
  return Boolean(preview.proposalId && preview.events.length===1 && !preview.issues.length && preview.rows.length && preview.rows.every(row => row.employeeId && !row.issues.length && row.operation==='update' && !row.previousStart && !row.previousEnd));
}
export async function processAttendanceInbox(db: SupabaseClient, signal: AbortSignal, deps: { extract?: typeof extractAttendance; preview?: typeof previewAttendance; autoEnabled?: boolean } = {}) {
  const claimed = await db.rpc("claim_whatsapp_attendance", { p_receipt: false }).abortSignal(signal);
  if (claimed.error) throw new Error("INBOX_CLAIM_FAILED");
  const job = claimed.data as InboxJob | null; if (!job) return 0;
  try {
    const [sender, profile] = await Promise.all([
      db.from("whatsapp_attendance_senders").select("user_id,enabled,auto_save").eq("phone",job.phone).single(),
      db.from("profiles").select("role").eq("id",job.actor_id).single(),
    ]);
    if (sender.error || profile.error) throw new Error("AUTH_LOOKUP_FAILED");
    if (!sender.data?.enabled || sender.data.user_id!==job.actor_id || !["owner","manager"].includes(profile.data?.role)) {
      await db.from("whatsapp_attendance_inbox").update({ status: "rejected", error_code: "SENDER_REVOKED", lease_until: null }).eq("id",job.id).eq("lease_token",job.lease_token); return 1;
    }
    const extracted = await (deps.extract ?? extractAttendance)(job.message_text,signal);
    const preview = await (deps.preview ?? previewAttendance)(db,job.actor_id,profile.data.role,extracted,undefined,false,signal);
    const result = await db.rpc("complete_whatsapp_attendance_analysis", { p_inbox:job.id,p_lease:job.lease_token,p_extracted:extracted,p_preview:preview,p_parts:attendanceSummary(preview) }).abortSignal(signal);
    if (result.error) throw new Error("INBOX_SAVE_FAILED");
    if (result.data === true && deps.autoEnabled && sender.data.auto_save && canAutoSave(preview)) {
      const saved = await db.rpc("approve_whatsapp_attendance", { p_actor: job.actor_id, p_inbox: job.id, p_proposal: preview.proposalId, p_automatic: true }).abortSignal(signal);
      if (saved.error) throw new Error("AUTO_APPROVAL_FAILED");
    }
    return 1;
  } catch {
    const result = await db.from("whatsapp_attendance_inbox").update({ status: job.attempts>=5 ? "failed" : "pending", error_code: "PROCESSING_FAILED", available_at: new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString(), lease_until: null }).eq("id",job.id).eq("status","processing").eq("lease_token",job.lease_token);
    if (result.error) throw new Error("INBOX_RETRY_FAILED");
    if(job.attempts>=5){
      const queued=await db.rpc("queue_whatsapp_attendance_failure",{p_inbox:job.id,p_lease:job.lease_token});
      if(queued.error)throw new Error("FAILURE_FEEDBACK_FAILED");
    }
    console.error("WhatsApp attendance processing failed",{code:"PROCESSING_FAILED",attempt:job.attempts});
    return 1;
  }
}
export async function processAttendanceReceipt(db: SupabaseClient, send: (phone: string, text: string, useTemplate: boolean, buttons?: AttendanceReplyButton[], kind?:string) => Promise<string>, signal: AbortSignal, hasTemplate: boolean, hasUpdateTemplate = false) {
  const claimed = await db.rpc("claim_whatsapp_attendance", { p_receipt: true }).abortSignal(signal);
  if (claimed.error) throw new Error("RECEIPT_CLAIM_FAILED");
  const job = claimed.data as ReceiptJob | null; if (!job) return 0;
  try {
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
    const templateAvailable=job.kind&&job.kind!=="result"?hasUpdateTemplate:hasTemplate;
    if (outsideWindow && !templateAvailable) {
      const expired = await db.from("whatsapp_attendance_receipts").update({ status: "expired", error_code: "APPROVED_TEMPLATE_REQUIRED", lease_until: null }).eq("id",job.id).eq("lease_token",job.lease_token);
      if (expired.error) throw new Error("RECEIPT_SAVE_FAILED"); return 1;
    }
    const parts=job.message_payload?.parts??splitAttendanceMessage(job.body||receiptText);
    const index=job.part_index??0;
    const final=outsideWindow||index>=parts.length-1;
    const providerId = await send(job.phone,parts[index]||receiptText,outsideWindow,final&&!outsideWindow?job.message_payload?.buttons:undefined,job.kind);
    const updated = await db.from("whatsapp_attendance_receipts").update({ status: final?"sent":"pending",part_index:final?parts.length:index+1,attempts:final?job.attempts:0,provider_message_id:final?providerId:null, sent_at: final?new Date().toISOString():null, error_code: null, lease_until: null,available_at:new Date().toISOString() }).eq("id",job.id).eq("lease_token",job.lease_token);
    if (updated.error) throw new Error("RECEIPT_SAVE_FAILED");
  } catch {
    const result = await db.from("whatsapp_attendance_receipts").update({ status: job.attempts>=5 ? "failed" : "pending", error_code: "RECEIPT_SEND_FAILED", available_at: new Date(Date.now()+60*2**job.attempts*1000).toISOString(), lease_until: null }).eq("id",job.id).eq("lease_token",job.lease_token);
    if (result.error) throw new Error("RECEIPT_RETRY_FAILED");
    console.error("WhatsApp attendance delivery failed",{code:"RECEIPT_SEND_FAILED",attempt:job.attempts});
  }
  return 1;
}

export async function processAttendanceDecision(db:SupabaseClient,signal:AbortSignal){
 const claimed=await db.rpc("claim_whatsapp_attendance_decision").abortSignal(signal);
 if(claimed.error)throw new Error("DECISION_CLAIM_FAILED");
 const job=claimed.data as {id:string;lease_token:string}|null;if(!job)return 0;
 const result=await db.rpc("execute_whatsapp_attendance_decision",{p_id:job.id,p_lease:job.lease_token}).abortSignal(signal);
 if(result.error){console.error("WhatsApp attendance decision outcome unverified",{code:"DECISION_RECHECK_REQUIRED"});throw new Error("DECISION_RECHECK_REQUIRED");}
 return 1;
}
