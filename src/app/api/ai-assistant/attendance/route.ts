import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleAttendanceRequest } from "@/features/ai-assistant/attendance-http";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return handleAttendanceRequest(request, { createClient, admin: createAdminClient, configured: Boolean(process.env.OPENAI_API_KEY) });
}
