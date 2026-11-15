import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleWhatsAppInbox } from "@/features/ai-assistant/whatsapp-inbox-http";
export const runtime="nodejs";
export const maxDuration=60;
export function GET(request:Request){return handleWhatsAppInbox(request,{createClient,admin:createAdminClient});}
export function POST(request:Request){return handleWhatsAppInbox(request,{createClient,admin:createAdminClient});}
