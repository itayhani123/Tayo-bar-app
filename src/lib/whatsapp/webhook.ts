import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseAttendanceDecision } from "./attendance-messages";

export function validMetaSignature(raw: Uint8Array, signature: string | null, secret: string | undefined) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(createHmac("sha256", secret).update(raw).digest(), Buffer.from(signature.slice(7), "hex"));
}
const messageBase = { id: z.string().min(1).max(500), from: z.string().regex(/^[1-9]\d{7,14}$/), timestamp: z.string().regex(/^\d{1,12}$/),context:z.object({id:z.string().max(500).optional()}).optional() };
const messageSchema = z.discriminatedUnion("type",[
 z.object({...messageBase,type:z.literal("text"),text:z.object({body:z.string().min(1).max(12000)})}),
 z.object({...messageBase,type:z.literal("interactive"),interactive:z.object({type:z.literal("button_reply"),button_reply:z.object({id:z.string().max(256)})})}),
]);
const envelopeSchema = z.object({ object: z.literal("whatsapp_business_account"), entry: z.array(z.object({ changes: z.array(z.object({ value: z.object({ metadata: z.object({ phone_number_id: z.string() }).optional(), messages: z.array(z.unknown()).optional(), statuses: z.array(z.object({ id: z.string(), status: z.string(), errors: z.array(z.object({ title: z.string().optional() })).optional() })).optional() }) })) })) });
export async function handleMetaWebhook(request: Request, db: () => SupabaseClient, config = { secret: process.env.WHATSAPP_APP_SECRET, phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID }) {
  if (!config.secret) return new Response("Webhook signature configuration missing", { status: 503 });
  const reader = request.body?.getReader(); if (!reader) return new Response("Empty body", { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size>3*1048576) { await reader.cancel(); return new Response("Too large", { status: 413 }); } chunks.push(chunk.value); }
  } finally { reader.releaseLock(); }
  const raw = Buffer.concat(chunks);
  if (!validMetaSignature(raw, request.headers.get("x-hub-signature-256"), config.secret)) return new Response("Unauthorized", { status: 401 });
  let body: z.infer<typeof envelopeSchema>;
  try { body = envelopeSchema.parse(JSON.parse(raw.toString("utf8"))); } catch { return new Response("Invalid webhook", { status: 400 }); }
  try {
    const admin = db();
    for (const entry of body.entry) for (const change of entry.changes) {
      const value = change.value;
      if (!config.phoneId || value.metadata?.phone_number_id !== config.phoneId) continue;
      for (const update of value.statuses ?? []) {
        if (!["sent","delivered","read","failed"].includes(update.status)) continue;
        const errors = update.errors?.map(e => e.title).filter(Boolean).join("; ").slice(0,1000) || null;
        const result = await admin.from("whatsapp_notifications").update({ status: update.status, error_message: errors }).eq("provider_message_id",update.id);
        if (result.error) throw result.error;
        const receipt = await admin.from("whatsapp_attendance_receipts").update({ status: update.status, error_code: update.status==='failed' ? "PROVIDER_DELIVERY_FAILED" : null }).eq("provider_message_id",update.id);
        if (receipt.error && !["42P01","PGRST205"].includes(receipt.error.code)) throw receipt.error;
      }
      for (const rawMessage of value.messages ?? []) {
        const parsed = messageSchema.safeParse(rawMessage); if (!parsed.success) continue;
        const message = parsed.data;
        const at = new Date(Number(message.timestamp)*1000); if (!Number.isFinite(+at) || +at>Date.now()+300000) continue;
        const decision=message.type==="interactive"?parseAttendanceDecision(message.interactive.button_reply.id):null;
        if(decision){
          const stored=await admin.rpc("receive_whatsapp_attendance_button",{p_message_id:message.id,p_phone:message.from,p_phone_id:config.phoneId,p_inbox:decision.inboxId,p_token:decision.token,p_decision:decision.decision,p_at:at.toISOString(),p_reply_to:message.context?.id??null});
          console.info("WhatsApp attendance intake",{stage:"button",messageId:message.id,reportId:decision.inboxId,accepted:stored.data===true,databaseCode:stored.error?.code});
          if(stored.error)throw stored.error;
          continue;
        }
        if(message.type!=="text")continue;
        const stored = await admin.rpc("receive_whatsapp_attendance", { p_message_id: message.id, p_phone: message.from, p_phone_id: config.phoneId, p_text: message.text.body, p_at: at.toISOString() });
        console.info("WhatsApp attendance intake",{stage:"inbound",messageId:message.id,accepted:stored.data===true,databaseCode:stored.error?.code});
        if (stored.error) throw stored.error;
      }
    }
    return Response.json({ received: true });
  } catch { console.error("WhatsApp webhook durable intake failed",{code:"DURABLE_INTAKE_FAILED"});return new Response("Durable intake unavailable; retry", { status: 503 }); }
}
