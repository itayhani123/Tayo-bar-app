import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleWhatsAppInbox } from "@/features/ai-assistant/whatsapp-inbox-http";
export const runtime="nodejs";
export const maxDuration=60;
function dependencies(){return {createClient,admin:createAdminClient,missingServerConfiguration:(["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"] as const).filter(name=>!process.env[name]?.trim())};}
export function GET(request:Request){return handleWhatsAppInbox(request,dependencies());}
export function POST(request:Request){return handleWhatsAppInbox(request,dependencies());}
