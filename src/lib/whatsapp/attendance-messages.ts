import type { AttendancePreview } from "@/features/ai-assistant/attendance";

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
  const valid = Boolean(event && preview.rows.length && !preview.issues.length && preview.rows.every(row => row.employeeId && !row.issues.length));
  const lines = [valid ? "📋 דיווח נוכחות לאישור" : "⚠️ לא ניתן לשמור את הדיווח."];
  if(event) lines.push(`📍 ${event.venueName} — ${event.client_name}`,`📅 ${event.event_date.split("-").reverse().join(".")}`);
  else lines.push(preview.events.length>1 ? "נמצאו כמה אירועים מתאימים. ציינו אולם, סוג אירוע, תאריך ושם לקוח. אם עדיין יש כמה אפשרויות, בחרו אירוע באפליקציה לפני אישור השעות." : `לא מצאתי אירוע מתאים ב${preview.extracted.venue || "אולם שצוין"}. בדקו את האולם, סוג האירוע, התאריך ושם הלקוח.`);
  if(preview.rows.length>1)lines.push(`👥 ${preview.rows.filter(row=>row.employeeId).length} עובדים זוהו`);
  for (const row of preview.rows) {
    lines.push("",`👤 ${row.name}`);
    if(!row.employeeId){lines.push(row.candidates.length>1?`השם "${row.name}" מתאים לכמה עובדים. שלחו שם מלא.`:`לא מצאתי במערכת עובד בשם "${row.name}".`);continue;}
    lines.push(`🕒 ${row.start || "כניסה חסרה"}–${row.end || "יציאה חסרה"}${row.start && row.end && row.end<row.start ? " למחרת" : ""}`);
    if(row.minutes!==null)lines.push(`⏱️ ${durationText(row.minutes)}`);
    if (row.note) lines.push(`הערה: ${row.note}`);
    lines.push(...row.issues.map(issue=>`⚠️ ${issue}`));
    if (row.operation === "create") lines.push("ℹ️ העובד יתווסף לשיבוץ האירוע בעת האישור.");
    else if(row.previousStart||row.previousEnd)lines.push("ℹ️ השעות הקיימות יעודכנו לאחר האישור.");
  }
  if(!valid){
    if(event)lines.push(...preview.issues.map(issue=>`⚠️ ${issue}`));
    lines.push("", "בדקו את הפרטים ושלחו דיווח מתוקן. לא נשמרו שעות.");
  }
  return splitAttendanceMessage(lines.join("\n"));
}
function durationText(minutes:number){
 const hours=Math.floor(minutes/60),remainder=minutes%60;
 const h=hours===1?"שעה":`${hours} שעות`,m=remainder===1?"דקה":`${remainder} דקות`;
 return hours&&remainder?`${h} ו־${m}`:hours?h:m;
}
export function parseAttendanceDecision(value: string): { inboxId: string; token: string; decision: "confirm"|"cancel" } | null {
  const uuid = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
  const button = new RegExp(`^attendance:(confirm|cancel):${uuid}:${uuid}$`,"i").exec(value.trim());
  if (button) return { decision:button[1].toLowerCase() as "confirm"|"cancel",inboxId:button[2],token:button[3] };
  return null;
}
