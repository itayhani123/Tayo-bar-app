import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleAttendanceRequest } from "@/features/ai-assistant/attendance-http";
import { missingAiEnvironment } from "@/features/ai-assistant/configuration";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const missingConfiguration = missingAiEnvironment();
  return handleAttendanceRequest(request, { createClient, admin: createAdminClient, configured: !missingConfiguration.includes("OPENAI_API_KEY"), missingConfiguration });
}
