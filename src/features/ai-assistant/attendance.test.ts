import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { attendanceExtractionSchema, attendanceTimes, buildAttendanceRows, cleanAttendanceName, looksLikeAttendance, matchAttendanceEvents } from "./attendance";
import { extractAttendance } from "./attendance-service";
import { getAssignmentSalary } from "@/features/event-staffing/calculations";
import type { EventAssignment } from "@/features/event-staffing/types";

import { attendanceExample, employees, extracted } from "./attendance-fixture";
test("complete real Hebrew list: eight identities, annotations, shuffled departures, Jerusalem midnight and payroll", () => {
  assert.ok(looksLikeAttendance(attendanceExample));
  const rows = buildAttendanceRows(attendanceExtractionSchema.parse(extracted), employees, [], "2026-11-12");
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map(r => r.issues), Array.from({ length: 8 }, () => []));
  assert.equal(rows[0].name, "נדב"); assert.equal(rows[0].note, "פתיחה");
  assert.equal(rows[4].name, "רועי לוי"); assert.equal(rows[4].end, "02:05");
  assert.deepEqual(rows.map(r => r.minutes), [595, 430, 410, 410, 410, 410, 410, 355]);
  for (const row of rows) {
    const times = attendanceTimes("2026-11-12", row.start, row.end);
    assert.equal(times.work_start.slice(0, 10), "2026-11-12");
    assert.equal(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem" }).format(new Date(times.work_end)), "2026-11-13");
    assert.equal(getAssignmentSalary({ payType: "hourly", hourlyRate: 60, workStart: times.work_start, workEnd: times.work_end } as EventAssignment), row.minutes);
  }
});
test("first name ambiguity never assigns the wrong Roei; explicit full name remains resolved", () => {
  const all = [...employees, { id: "another-roei", full_name: "רועי כהן" }];
  const rows = buildAttendanceRows(extracted, all, [], "2026-11-12");
  const roei = rows.find(r => r.key === "רועי")!;
  assert.equal(roei.employeeId, null); assert.equal(roei.candidates.length, 2);
  assert.equal(buildAttendanceRows(extracted, [...employees, { id: "single-name-roei", full_name: "רועי" }], [], "2026-11-12").find(r => r.key === "רועי")?.employeeId, null);
  assert.ok(roei.issues.length); assert.equal(rows.find(r => r.name === "רועי לוי")?.employeeId, employees[4].id);
  const correction = { eventId: null, rows: [{ key: roei.key, employeeId: employees[4].id, start: "19:15", end: "", note: "" }] };
  const selected = buildAttendanceRows(extracted, all, [], "2026-11-12", correction);
  assert.equal(selected.length, 8);
  const full = selected.find(r => r.employeeId === employees[4].id)!;
  assert.deepEqual(full.issues, []); assert.equal(full.minutes, 410);
  const again = buildAttendanceRows(extracted, all, [], "2026-11-12", { eventId: null, rows: selected.map(({ key, employeeId, start, end, note }) => ({ key, employeeId, start, end, note })) });
  assert.equal(again.length, 8); assert.deepEqual(again.find(r => r.employeeId === employees[4].id)?.issues, []);
});
test("missing, malformed, duplicate, reversed and implausible hours block confirmation", () => {
  for (const [start, end] of [["19:00", ""], ["25:00", "02:00"], ["19:00", "18:00"], ["10:00", "10:00"], ["06:00", "23:00"]]) assert.throws(() => attendanceTimes("2026-11-12", start, end));
  const duplicate = buildAttendanceRows({ ...extracted, entries: [...extracted.entries, extracted.entries[0]] }, employees, [], "2026-11-12");
  assert.ok(duplicate[0].issues.some(i => i.includes("כפילות")));
  assert.deepEqual(cleanAttendanceName('נדב אחמ״ש'), { name: "נדב", note: 'אחמ״ש' });
  assert.throws(() => attendanceTimes("2026-10-24", "19:00", "01:30"), /שעון/);
});
test("missing year searches real event dates and weekday, preserving genuine ambiguity", () => {
  const venues = [{ id: "v", name: "קסנאדו" }];
  const event = { venue_id: "v", client_name: "לקוח" };
  const events = [{ ...event, id: "2026", event_date: "2026-11-12" }, { ...event, id: "2025", event_date: "2025-11-12" }, { ...event, id: "2020", event_date: "2020-11-12" }];
  assert.deepEqual(matchAttendanceEvents(extracted, events, venues).map(e => e.id), ["2026", "2020"]);
  assert.equal(matchAttendanceEvents({ ...extracted, year: 2026 }, events, venues)[0].id, "2026");
  assert.equal(matchAttendanceEvents({ ...extracted, venue: "אולם אחר" }, events, venues).length, 0);
});
test("OpenAI structured extraction uses strict schema, no tools, no inferred year, rejects incomplete responses", async () => {
  const client = { responses: { create: async (args: Record<string, unknown>) => {
    assert.equal(args.tools, undefined); assert.equal(args.store, false);
    const format = (args.text as { format: { strict: boolean; type: string } }).format;
    assert.equal(format.strict, true); assert.equal(format.type, "json_schema");
    assert.deepEqual(args.input, [{ role: "user", content: attendanceExample }]);
    return { status: "completed", output_text: JSON.stringify(extracted) };
  } } } as unknown as Pick<OpenAI, "responses">;
  assert.deepEqual(await extractAttendance(attendanceExample, new AbortController().signal, client), extracted);
  await assert.rejects(extractAttendance(attendanceExample, new AbortController().signal, { responses: { create: async () => ({ status: "incomplete", output_text: "{}" }) } } as unknown as Pick<OpenAI, "responses">));
});
