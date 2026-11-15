import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attendanceCorrectionSchema, attendanceExtractionSchema } from "./attendance";
import { confirmAttendance, extractAttendance, previewAttendance } from "./attendance-service";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extract"), text: z.string().min(1).max(12000) }).strict(),
  z.object({ action: z.literal("preview"), extracted: attendanceExtractionSchema, correction: attendanceCorrectionSchema, allowNew: z.boolean() }).strict(),
  z.object({ action: z.literal("confirm"), proposalId: z.uuid(), confirmed: z.literal(true) }).strict(),
]);
type Dependencies = { createClient: () => Promise<SupabaseClient>; admin: () => SupabaseClient; extract?: typeof extractAttendance; preview?: typeof previewAttendance; confirm?: typeof confirmAttendance; configured: boolean };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
export async function handleAttendanceRequest(request: Request, deps: Dependencies) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "מקור בקשה אינו מורשה" }, 403);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50000)]);
  try {
    const db = await deps.createClient();
    const auth = await db.auth.getUser();
    if (auth.error || !auth.data.user) return json({ error: "יש להתחבר מחדש" }, 401);
    const profile = await db.from("profiles").select("role").eq("id", auth.data.user.id).abortSignal(signal).single();
    if (profile.error || !profile.data || !["owner", "manager"].includes(profile.data.role)) return json({ error: "אין הרשאה" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "פורמט לא תקין" }, 415);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "בקשה ריקה" }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        signal.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 120000) { await reader.cancel(); return json({ error: "הרשימה גדולה מדי" }, 413); }
        chunks.push(chunk.value);
      }
    } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json({ error: "בקשה לא תקינה" }, 400); }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "נתוני בקשה לא תקינים או שחסר אישור מפורש" }, 400);
    const body = parsed.data;
    const actor = auth.data.user.id, role = profile.data.role;
    if (body.action === "confirm") {
      const result = await (deps.confirm ?? confirmAttendance)(deps.admin(), actor, body.proposalId, signal);
      const messages: Record<string, string> = { succeeded: "כל שעות הנוכחות נשמרו באירוע בהצלחה", stale: "הנתונים השתנו. יש לבדוק שוב את התצוגה ולאשר מחדש", expired: "תוקף האישור פג. יש להכין תצוגה חדשה", forbidden: "אין הרשאה לאישור זה" };
      return json({ ...result, message: messages[result.status] ?? "השמירה לא הושלמה" }, result.status === "succeeded" ? 200 : result.status === "forbidden" ? 403 : 409);
    }
    if (body.action === "preview") return json(await (deps.preview ?? previewAttendance)(deps.admin(), actor, role, body.extracted, body.correction, body.allowNew, signal));
    if (!deps.configured) return json({ error: "Tayo AI עדיין לא הוגדר בשרת" }, 503);
    const quota = await db.rpc("consume_ai_assistant_usage").abortSignal(signal);
    if (quota.error || quota.data !== true) return json({ error: "בקרת השימוש אינה זמינה או שהמכסה נוצלה. נסו מאוחר יותר" }, 429);
    const extracted = await (deps.extract ?? extractAttendance)(body.text, signal);
    return json(await (deps.preview ?? previewAttendance)(deps.admin(), actor, role, extracted, undefined, false, signal));
  } catch {
    return json({ error: signal.aborted ? "לא התקבלה תוצאה בזמן. לאחר ניסיון שמירה יש לנסות שוב את אותו אישור" : "לא התקבלה תוצאה. לאחר ניסיון שמירה יש לנסות שוב את אותו אישור בבטחה; אם הבעיה נמשכת יש לפנות לבעלים" }, signal.aborted ? 504 : 503);
  }
}
