import type { SupabaseClient } from "@supabase/supabase-js";
import { extractAttendance, previewAttendance } from "@/features/ai-assistant/attendance-service";
import type { AttendancePreview } from "@/features/ai-assistant/attendance";

export type InboxJob = { id: string; actor_id: string; phone: string; message_text: string; message_at: string; lease_token: string; attempts: number };
type ReceiptJob = { id: string; inbox_id: string; phone: string; message_at: string; lease_token: string; attempts: number };
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
    const result = await db.from("whatsapp_attendance_inbox").update({ status: "review", extracted, preview, proposal_id: preview.proposalId ?? null, error_code: null, lease_until: null }).eq("id",job.id).eq("status","processing").eq("lease_token",job.lease_token).select("id").maybeSingle();
    if (result.error) throw new Error("INBOX_SAVE_FAILED");
    if (result.data && deps.autoEnabled && sender.data.auto_save && canAutoSave(preview)) {
      const saved = await db.rpc("approve_whatsapp_attendance", { p_actor: job.actor_id, p_inbox: job.id, p_proposal: preview.proposalId, p_automatic: true }).abortSignal(signal);
      if (saved.error) throw new Error("AUTO_APPROVAL_FAILED");
    }
    return 1;
  } catch {
    const result = await db.from("whatsapp_attendance_inbox").update({ status: job.attempts>=5 ? "failed" : "pending", error_code: "PROCESSING_FAILED", available_at: new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString(), lease_until: null }).eq("id",job.id).eq("status","processing").eq("lease_token",job.lease_token);
    if (result.error) throw new Error("INBOX_RETRY_FAILED");
    return 1;
  }
}
export async function processAttendanceReceipt(db: SupabaseClient, send: (phone: string, text: string, useTemplate: boolean) => Promise<string>, signal: AbortSignal, hasTemplate: boolean) {
  const claimed = await db.rpc("claim_whatsapp_attendance", { p_receipt: true }).abortSignal(signal);
  if (claimed.error) throw new Error("RECEIPT_CLAIM_FAILED");
  const job = claimed.data as ReceiptJob | null; if (!job) return 0;
  try {
    const latest = await db.from("whatsapp_attendance_inbox").select("message_at").eq("phone",job.phone).order("message_at",{ ascending: false }).limit(1).single();
    if (latest.error) throw new Error("WINDOW_LOOKUP_FAILED");
    const outsideWindow = Date.now()-Date.parse(latest.data.message_at)>23.9*3600000;
    if (outsideWindow && !hasTemplate) {
      const expired = await db.from("whatsapp_attendance_receipts").update({ status: "expired", error_code: "APPROVED_TEMPLATE_REQUIRED", lease_until: null }).eq("id",job.id).eq("lease_token",job.lease_token);
      if (expired.error) throw new Error("RECEIPT_SAVE_FAILED"); return 1;
    }
    const providerId = await send(job.phone,receiptText,outsideWindow);
    const updated = await db.from("whatsapp_attendance_receipts").update({ status: "sent", provider_message_id: providerId, sent_at: new Date().toISOString(), error_code: null, lease_until: null }).eq("id",job.id).eq("lease_token",job.lease_token);
    if (updated.error) throw new Error("RECEIPT_SAVE_FAILED");
  } catch {
    const result = await db.from("whatsapp_attendance_receipts").update({ status: job.attempts>=5 ? "failed" : "pending", error_code: "RECEIPT_SEND_FAILED", available_at: new Date(Date.now()+60*2**job.attempts*1000).toISOString(), lease_until: null }).eq("id",job.id).eq("lease_token",job.lease_token);
    if (result.error) throw new Error("RECEIPT_RETRY_FAILED");
  }
  return 1;
}
