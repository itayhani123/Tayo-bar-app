import type { AttendancePreview } from "@/features/ai-assistant/attendance";
import { formatDuration } from "@/features/event-staffing/calculations";

export type AttendanceReplyButton = { id: string; title: string };
export function splitAttendanceMessage(text: string, limit = 3500): string[] {
  const parts: string[] = []; let part = "";
  for (const line of text.split("\n")) {
    if (part && part.length + line.length + 1 > limit) { parts.push(part); part = ""; }
    let rest = line;
    while (rest.length > limit) { let cut = limit; if (/[\uD800-\uDBFF]/.test(rest[cut-1])) cut--; parts.push(rest.slice(0,cut)); rest = rest.slice(cut); }
    part += (part ? "\n" : "") + rest;
  }
  if (part) parts.push(part);
  return parts;
}
export function attendanceSummary(preview: AttendancePreview): string[] {
  const event = preview.events.find(e => e.id === preview.eventId);
  const lines = ["סיכום דיווח נוכחות — טרם נשמר", event ? `${event.venueName} · ${event.client_name} · ${event.event_date}` : "האירוע או התאריך אינם מזוהים בוודאות", `עובדים שזוהו: ${preview.rows.filter(r=>r.employeeId).length}`, "שעות לפי שעון ישראל:"];
  for (const row of preview.rows) {
    lines.push(`${row.name}: ${row.start || "כניסה חסרה"}–${row.end || "יציאה חסרה"}${row.start && row.end && row.end<row.start ? " למחרת" : ""}${row.minutes===null?"":` · ${formatDuration(row.minutes)}`}${row.employeeId?"":" · עובד לא מזוהה"}`);
    if (row.note) lines.push(`הערה: ${row.note}`);
    lines.push(...row.issues.map(issue=>`⚠ ${issue}`));
    if (row.operation === "create") lines.push("⚠ העובד אינו משובץ — נדרש אישור נפרד באפליקציה");
  }
  lines.push(...preview.issues.map(issue=>`⚠ ${issue}`));
  lines.push("אין שמירה חלקית. עובד או אירוע חסר לא ייווצרו אוטומטית. יש לתקן באפליקציה או לשלוח דיווח מתוקן.");
  return splitAttendanceMessage(lines.join("\n"));
}
export function parseAttendanceDecision(value: string): { inboxId: string; token: string; decision: "confirm"|"cancel" } | null {
  const uuid = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
  const button = new RegExp(`^attendance:(confirm|cancel):${uuid}:${uuid}$`,"i").exec(value.trim());
  if (button) return { decision:button[1].toLowerCase() as "confirm"|"cancel",inboxId:button[2],token:button[3] };
  const text = new RegExp(`^(אשר|בטל)\\s+${uuid}\\s+${uuid}$`,"i").exec(value.trim());
  return text ? { decision:text[1]==="אשר"?"confirm":"cancel",inboxId:text[2],token:text[3] } : null;
}
