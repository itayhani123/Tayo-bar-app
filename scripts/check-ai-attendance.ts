// Read-only extraction smoke test. Never connects to Supabase or logs attendance or credentials.
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { extractAttendance } from "../src/features/ai-assistant/attendance-service";
import { buildAttendanceRows } from "../src/features/ai-assistant/attendance";
import { attendanceExample, employees } from "../src/features/ai-assistant/attendance-fixture";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
try {
  const extracted = await extractAttendance(attendanceExample, AbortSignal.timeout(45000));
  assert.equal(extracted.year, null);
  assert.equal(extracted.day, 12); assert.equal(extracted.month, 11); assert.equal(extracted.weekday, 4);
  const rows = buildAttendanceRows(extracted, employees, [], "2026-11-12");
  assert.equal(rows.length, 8); assert.ok(rows.every(row => row.issues.length === 0));
  assert.ok(rows.find(row => row.name === "נדב")?.note.includes("פתיחה"));
  assert.deepEqual(rows.map(r => r.minutes).sort((a, b) => a! - b!), [355,410,410,410,410,410,430,595]);
  console.log("OpenAI attendance extraction passed: eight employees, exact times, no inferred year. No database writes.");
} catch (error) {
  const details = error as { name?: string; status?: number; code?: string; cause?: { code?: string } };
  console.error(JSON.stringify({ category: details.name, status: details.status, code: details.code, connectionCode: details.cause?.code }));
  console.error((error as Error).stack?.split("\n").filter(line => line.trim().startsWith("at ")).slice(0, 4).join("\n"));
  console.error("OpenAI attendance extraction failed (request, schema, or expected attendance values). No database writes.");
  process.exitCode = 1;
}
