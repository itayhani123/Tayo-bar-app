import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { ChatResult } from "./action-types";
import { ConversationError, turnSchema, type UserTurn } from "./conversations";
import type { ConversationReply } from "./conversation-types";

import { chatSchema } from "@/features/ai-assistant/policy";
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store, private", ...extra } });

export async function handleAssistantRequest(request: Request, deps: { createClient: () => Promise<SupabaseClient>; answer: (db: SupabaseClient, role: string, messages: { role: "user" | "assistant"; content: string }[], signal: AbortSignal, actorId: string, requestId: string) => Promise<string | ChatResult>; converse?: (db: SupabaseClient, role: string, actorId: string, turn: UserTurn, signal: AbortSignal) => Promise<ConversationReply>; configured: boolean }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "מקור הבקשה אינו מורשה" }, 403);
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(50000)]);
  try {
    const db = await deps.createClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return json({ error: "יש להתחבר מחדש" }, 401);
    const { data: profile, error: profileError } = await db.from("profiles").select("role").eq("id", auth.user.id).abortSignal(deadline).single();
    if (profileError || !profile || !["owner", "manager"].includes(profile.role)) return json({ error: "אין הרשאה לשימוש בעוזר" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "פורמט בקשה לא תקין" }, 415);
    // Bound the actual streamed body, including chunked requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "בקשה ריקה" }, 400);
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    deadline.addEventListener("abort", cancel, { once: true });
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        deadline.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 48000) { await reader.cancel(); return json({ error: "השיחה ארוכה מדי. יש להתחיל שיחה חדשה" }, 413); }
        chunks.push(value);
      }
      deadline.throwIfAborted();
    } finally {
      deadline.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json({ error: "בקשה לא תקינה" }, 400); }
    const turn = turnSchema.safeParse(body);
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success && !turn.success) return json({ error: "השיחה ארוכה מדי או שהשאלה אינה תקינה" }, 400);
    if (!deps.configured) return json({ error: "Tayo AI עדיין לא הוגדר בשרת. יש לפנות לבעלים" }, 503);
    const quota = await db.rpc("consume_ai_assistant_usage").abortSignal(deadline);
    if (quota.error) return json({ error: "בקרת השימוש אינה זמינה. יש לפנות לבעלים" }, 503);
    if (quota.data !== true) return json({ error: "הגעת למכסת השימוש. נסו שוב מאוחר יותר" }, 429, { "Retry-After": "60" });
    if (turn.success && deps.converse) return json(await deps.converse(db, profile.role, auth.user.id, turn.data, deadline));
    if (!parsed.success) return json({ error: "מנגנון השיחה אינו מוגדר" }, 503);
    const answer = await deps.answer(db, profile.role, parsed.data.messages, deadline, auth.user.id, parsed.data.requestId ?? randomUUID());
    return json(typeof answer === "string" ? { answer, proposals: [] } : answer);
  } catch (error) {
    if (error instanceof ConversationError) return json({ error: error.message }, error.status);
    // Never log chat text, database rows, SDK errors, API keys or credentials.
    if (typeof error === "object" && error !== null && "status" in error && error.status === 429) return json({ error: "שירות ה־AI הגיע למגבלת שימוש. נסו מאוחר יותר; אם הבעיה נמשכת, יש לבדוק מכסה וחיוב בחשבון OpenAI" }, 503, { "Retry-After": "60" });
    return json({ error: deadline.aborted ? "הבקשה ארכה יותר מדי זמן. נסו שאלה ממוקדת יותר" : "לא ניתן לקבל תשובה כרגע. נסו שוב מאוחר יותר" }, deadline.aborted ? 504 : 502);
  }
}
