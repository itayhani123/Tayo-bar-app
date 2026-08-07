import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WhatsAppNotificationStatus } from "@/lib/whatsapp/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const valid = url.searchParams.get("hub.mode") === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
  return valid ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) return new Response("Unauthorized", { status: 401 });
  const body = JSON.parse(raw) as { entry?: { changes?: { value?: { statuses?: { id?: string; status?: string; errors?: { title?: string }[] }[] } }[] }[] };
  const statuses = body.entry?.flatMap((entry) => entry.changes?.flatMap((change) => change.value?.statuses ?? []) ?? []) ?? [];
  const admin = createAdminClient();
  for (const update of statuses) {
    if (!update.id || !isStatus(update.status)) continue;
    await admin.from("whatsapp_notifications").update({ status: update.status, error_message: update.errors?.map((item) => item.title).filter(Boolean).join("; ") || null }).eq("provider_message_id", update.id);
  }
  return Response.json({ received: true });
}

function validSignature(raw: string, signature: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const received = Buffer.from(signature.slice(7));
  return expected.length === received.length && timingSafeEqual(expected, received);
}
function isStatus(value: string | undefined): value is WhatsAppNotificationStatus { return value === "sent" || value === "delivered" || value === "read" || value === "failed"; }
