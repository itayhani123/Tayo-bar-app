import "server-only";
import { createClient } from "@/lib/supabase/server";
import { answerQuestion } from "@/features/ai-assistant/service";
import { handleAssistantRequest } from "@/features/ai-assistant/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConversationError, loadConversation, runConversation } from "@/features/ai-assistant/conversations";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleAssistantRequest(request, { createClient, configured: Boolean(process.env.OPENAI_API_KEY),
    // Legacy callers remain read-only; client-provided assistant history cannot create proposals.
    answer: (db, role, messages, signal) => answerQuestion(db, role, messages, signal),
    converse: (db, role, actorId, turn, signal) => runConversation(db, createAdminClient(), role, actorId, turn, signal),
  });
}

export async function GET(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
  try {
    const db = await createClient();
    const { data: auth, error } = await db.auth.getUser();
    if (error || !auth.user) return json({ error: "יש להתחבר מחדש" }, 401);
    const profile = await db.from("profiles").select("role").eq("id", auth.user.id).single();
    if (!profile.data || !["owner", "manager"].includes(profile.data.role)) return json({ error: "אין הרשאה" }, 403);
    const id = new URL(request.url).searchParams.get("conversationId");
    if (!id) return json({ error: "חסר מזהה שיחה" }, 400);
    return json(await loadConversation(createAdminClient(), auth.user.id, profile.data.role, id));
  } catch (error) { return json({ error: error instanceof ConversationError ? error.message : "לא ניתן לטעון את השיחה" }, error instanceof ConversationError ? error.status : 400); }
}
