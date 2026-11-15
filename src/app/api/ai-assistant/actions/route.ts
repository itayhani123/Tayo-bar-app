import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleActionDecision } from "@/features/ai-assistant/action-http";
import { afterConfirmedAction } from "@/features/ai-assistant/action-effects";

export const runtime = "nodejs";
export const maxDuration = 60;
export function POST(request: Request) {
  return handleActionDecision(request, { createClient, admin: createAdminClient, afterSuccess: afterConfirmedAction });
}
