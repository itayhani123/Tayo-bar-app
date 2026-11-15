import { z } from "zod";
import { eventInstant } from "@/lib/whatsapp/scheduling";
import { getWorkedMinutes } from "@/features/event-staffing/calculations";

// Extraction has no identifiers, pay fields, or executable tools.
export const attendanceExtractionSchema = z.object({
  venue: z.string().nullable(), day: z.number().int().min(1).max(31).nullable(),
  month: z.number().int().min(1).max(12).nullable(), year: z.number().int().min(1900).max(2200).nullable(),
  weekday: z.number().int().min(0).max(6).nullable(),
  entries: z.array(z.object({ name: z.string().min(1).max(120), direction: z.enum(["in", "out"]), time: z.string().nullable(), note: z.string().nullable() }).strict()).max(200),
}).strict();
export type AttendanceExtraction = z.infer<typeof attendanceExtractionSchema>;
export type AttendanceEmployee = { id: string; full_name: string };
export type AttendanceEvent = { id: string; event_date: string; venue_id: string | null; client_name: string };
export type AttendanceAssignment = { id: string; event_id: string; employee_id: string; work_start: string | null; work_end: string | null; updated_at: string; notes: string | null };
export type AttendanceRow = { key: string; name: string; employeeId: string | null; candidates: AttendanceEmployee[]; start: string; end: string; note: string; issues: string[]; minutes: number | null; operation: "create" | "update"; previousStart: string | null; previousEnd: string | null; needs_auto_assignment?: boolean };
export type AttendancePreview = { extracted: AttendanceExtraction; events: (AttendanceEvent & { venueName: string })[]; eventId: string | null; employees: AttendanceEmployee[]; rows: AttendanceRow[]; issues: string[]; proposalId?: string; expiresAt?: string; confirmationPolicy?: string };
export const attendanceCorrectionSchema = z.object({ eventId: z.uuid().nullable(), rows: z.array(z.object({ key: z.string(), employeeId: z.uuid().nullable(), start: z.string().max(5), end: z.string().max(5), note: z.string().max(500) }).strict()).max(200) }).strict();
export type AttendanceCorrection = z.infer<typeof attendanceCorrectionSchema>;
export const normalizeAttendanceName = (v: string) => v.normalize("NFKC").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/[״׳"'.,()\-*]/g, "").replace(/\s+/g, " ").trim();
export function cleanAttendanceName(name: string) {
  const notes: string[] = [];
  const cleaned = name.replace(/פתיחה|סגירה|אחמ[״"׳']?ש/g, word => { notes.push(word); return " "; });
  return { name: normalizeAttendanceName(cleaned), note: notes.join(", ") };
}
export function attendanceClock(value: string | null): string {
  if (value === null || value === "") return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error("שעה לא תקינה");
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}
// Check local-time round trips and repeated DST instants; require a correction for ambiguous clocks.
function checkedInstant(date: string, time: string) {
  const value = eventInstant(date, time);
  const local = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).replace(" ", "T");
  const expected = `${date}T${time}`;
  if (local(value) !== expected || [-3600000, 3600000].some(offset => local(new Date(+value + offset)) === expected)) throw new Error("שעה לא קיימת או דו־משמעית במעבר שעון בישראל");
  return value.toISOString();
}
export function attendanceTimes(date: string, start: string, end: string) {
  const a = attendanceClock(start), b = attendanceClock(end);
  if (!a || !b) throw new Error("חסרה שעת כניסה או יציאה; יש להשלים לפני שמירה");
  if (a === b) throw new Error("שעות זהות אינן משמרת תקינה");
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  // Only an early-morning departure can be interpreted as crossing midnight.
  if (b < a && b >= "12:00") throw new Error("יציאה לפני כניסה; יש לתקן את השעות");
  const work_start = checkedInstant(date, a);
  const work_end = checkedInstant(b < a ? next.toISOString().slice(0, 10) : date, b);
  const minutes = getWorkedMinutes(work_start, work_end);
  if (minutes === null || minutes <= 0 || minutes > 16 * 60) throw new Error("משך משמרת לא סביר (מעל 16 שעות או ללא משך חיובי)");
  return { work_start, work_end, minutes };
}
export function matchAttendanceEvents(extracted: AttendanceExtraction, events: AttendanceEvent[], venues: { id: string; name: string }[]) {
  if (!extracted.day || !extracted.month || !extracted.venue) return [];
  const ids = new Set(venues.filter(v => normalizeAttendanceName(v.name) === normalizeAttendanceName(extracted.venue!)).map(v => v.id));
  return events.filter(e => {
    const [year, month, day] = e.event_date.split("-").map(Number);
    return ids.has(e.venue_id ?? "") && day === extracted.day && month === extracted.month && (extracted.year === null || year === extracted.year) && (extracted.weekday === null || new Date(`${e.event_date}T12:00:00Z`).getUTCDay() === extracted.weekday);
  }).map(e => ({ ...e, venueName: venues.find(v => v.id === e.venue_id)!.name }));
}
export function buildAttendanceRows(extracted: AttendanceExtraction, employees: AttendanceEmployee[], assignments: AttendanceAssignment[], date?: string, correction?: AttendanceCorrection): AttendanceRow[] {
  const grouped = new Map<string, AttendanceRow>();
  const directions = new Set<string>();
  for (const entry of extracted.entries) {
    const clean = cleanAttendanceName(entry.name);
    const name = clean.name;
    let matches = employees.filter(e => normalizeAttendanceName(e.full_name) === name);
    if (!name.includes(" ")) {
      matches = employees.filter(e => normalizeAttendanceName(e.full_name).split(" ")[0] === name);
      const assigned = matches.filter(e => assignments.some(a => a.employee_id === e.id));
      if (assigned.length === 1) matches = assigned;
    }
    const key = matches.length === 1 ? matches[0].id : name;
    const row = grouped.get(key) ?? { key, name, employeeId: matches.length === 1 ? matches[0].id : null, candidates: matches, start: "", end: "", note: "", issues: [], minutes: null, operation: "create", previousStart: null, previousEnd: null };
    const field = entry.direction === "in" ? "start" : "end";
    if (directions.has(`${key}:${field}`)) row.issues.push(`כפילות בשעת ${field === "start" ? "כניסה" : "יציאה"}`);
    directions.add(`${key}:${field}`);
    try { row[field] = attendanceClock(entry.time); } catch { row[field] = entry.time ?? ""; }
    row.note = [...new Set([row.note, clean.note, entry.note ?? ""].filter(Boolean))].join("; ");
    grouped.set(key, row);
  }
  const resolved = new Map<string, AttendanceRow>();
  for (const row of grouped.values()) {
    const edit = correction?.rows.find(r => r.key.split("|").includes(row.key));
    if (edit) { row.employeeId = edit.employeeId; row.start = edit.start; row.end = edit.end; row.note = edit.note; }
    const identity = row.employeeId ?? row.key;
    const previous = resolved.get(identity);
    if (!previous) resolved.set(identity, row);
    else {
      // Only explicit employee choices or unique server matches can merge identities.
      // Conflicting clocks remain blocking; complementary arrival/departure rows combine.
      for (const field of ["start", "end"] as const) {
        if (previous[field] && row[field] && previous[field] !== row[field]) previous.issues.push("שעות סותרות לאותו עובד; יש לתקן את הודעת המקור");
        else previous[field] ||= row[field];
      }
      previous.key = [...new Set([...previous.key.split("|"), ...row.key.split("|")])].sort().join("|");
      previous.note = [...new Set([previous.note, row.note].filter(Boolean))].join("; ");
      previous.issues.push(...row.issues);
    }
  }
  return [...resolved.values()].map(row => {
    const employee = employees.find(e => e.id === row.employeeId);
    if (!employee) row.issues.push("יש לבחור עובד קיים; לא תיווצר רשומת עובד");
    else row.name = employee.full_name;
    const existing = assignments.filter(a => a.employee_id === row.employeeId);
    if (existing.length > 1) row.issues.push("קיימים שיבוצים כפולים באירוע; יש להסדירם במסך האירוע");
    row.operation = existing.length ? "update" : "create";
    row.previousStart = existing[0]?.work_start ?? null;
    row.previousEnd = existing[0]?.work_end ?? null;
    if (date) try { row.minutes = attendanceTimes(date, row.start, row.end).minutes; } catch (error) { row.issues.push((error as Error).message); }
    return row;
  });
}

export function looksLikeAttendance(text: string) {
  return text.includes("\n") && /(?:הגעה|כניסה|יציאה|סיום)/.test(text) && /\d{1,2}:\d{2}/.test(text);
}
