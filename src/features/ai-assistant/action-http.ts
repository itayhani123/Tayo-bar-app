import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "./action-types";

export const decisionSchema = z.object({ proposalId: z.uuid(), decision: z.enum(["confirm", "cancel"]) }).strict();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
type Dependencies = { createClient: () => Promise<SupabaseClient>; admin: () => SupabaseClient; afterSuccess?: (db: SupabaseClient, proposalId: string, actorId: string, role: "owner" | "manager", result: ActionResult) => Promise<void> };

export async function handleActionDecision(request: Request, deps: Dependencies) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "מקור הבקשה אינו מורשה" }, 403);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)]);
  try {
    const db = await deps.createClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return json({ error: "יש להתחבר מחדש" }, 401);
    const { data: profile, error: profileError } = await db.from("profiles").select("role").eq("id", auth.user.id).abortSignal(signal).single();
    if (profileError || !profile || !["owner", "manager"].includes(profile.role)) return json({ error: "אין הרשאה" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "פורמט בקשה לא תקין" }, 415);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "בקשה ריקה" }, 400);
    const parts: Uint8Array[] = []; let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4096) { await reader.cancel(); return json({ error: "בקשה גדולה מדי" }, 413); }
        parts.push(chunk.value);
      }
      signal.throwIfAborted();
    } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { return json({ error: "בקשה לא תקינה" }, 400); }
    const parsed = decisionSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "יש לאשר או לבטל הצעה מסוימת בלבד" }, 400);
    const admin = deps.admin();
    // Actor comes only from auth.getUser(), never the body. RPC rechecks live role and state.
    const { data, error } = await admin.rpc("decide_ai_action", { p_actor: auth.user.id, p_proposal: parsed.data.proposalId, p_decision: parsed.data.decision }).abortSignal(signal);
    if (error || !data) return json({ error: "לא התקבלה תוצאת ביצוע. ניתן לנסות שוב את אותו אישור ללא יצירת פעולה כפולה" }, 503);
    const result = data as ActionResult;
    if (result.status === "succeeded") {
      let warning: string | undefined;
      if (!result.replayed && deps.afterSuccess) {
        try { await deps.afterSuccess(admin, parsed.data.proposalId, auth.user.id, profile.role, result); }
        catch { warning = "הפעולה נשמרה, אך לא ניתן לאמת שיצירת התראות WhatsApp הושלמה. אין לבצע שוב את הפעולה העסקית"; }
      }
      return json({ ...result, message: "הפעולה בוצעה ונשמרה בהצלחה", warning });
    }
    const messages = { cancelled: "ההצעה בוטלה. לא בוצע שינוי בנתוני העסק", expired: "תוקף ההצעה פג. יש לבקש הצעה חדשה", stale: "הנתונים השתנו מאז הכנת ההצעה. יש לבקש תצוגה מקדימה חדשה", failed: "הפעולה לא בוצעה. יש לבדוק את הפרטים ולבקש הצעה חדשה", forbidden: "אין הרשאה לאישור הצעה זו" };
    return json({ ...result, error: result.status === "cancelled" ? undefined : messages[result.status], message: messages[result.status] }, result.status === "cancelled" ? 200 : result.status === "forbidden" ? 403 : result.status === "expired" ? 410 : 409);
  } catch {
    // Do not log input, payment data or credentials. A retry recovers committed results safely.
    return json({ error: "לא ניתן לאמת את תוצאת הבקשה כרגע. ניתן לנסות שוב את אותו אישור" }, signal.aborted ? 504 : 503);
  }
}
