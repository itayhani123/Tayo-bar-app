import { handleMetaWebhook } from "@/lib/whatsapp/webhook";
import { createAdminClient } from "@/lib/supabase/admin";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const valid = url.searchParams.get("hub.mode") === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
  return valid ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) { return handleMetaWebhook(request, createAdminClient); }
