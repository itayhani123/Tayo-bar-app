import assert from "node:assert/strict";
import test from "node:test";
import { notificationDedupeKey } from "./dedupe.ts";
import { buildTemplateParameters, buildTemplatePayload } from "./templates.ts";

const context = { employeeName: "ישראל", employeePhone: "972501234567", eventDate: "04/08/2026", eventTime: "19:30", venueName: "קסנאדו", eventType: "חתונה", workStart: "19:00", workEnd: "03:00", workedDuration: "8 שעות", calculatedSalary: "400 ₪" };
test("identical triggers have identical duplicate keys", () => assert.equal(notificationDedupeKey("work:a:19:00:03:00"), notificationDedupeKey("work:a:19:00:03:00")));
test("event versions produce different duplicate keys", () => assert.notEqual(notificationDedupeKey("reminder:a:2026-08-04:19:30"), notificationDedupeKey("reminder:a:2026-08-05:19:30")));
test("hello_world has no body parameters", () => assert.deepEqual(buildTemplatePayload("assignment_created", context.employeePhone, context).parameters, []));
test("future custom template parameters remain supported", () => assert.equal(buildTemplateParameters("assignment_created", context).length, 5));
test("manager custom work-time parameters exclude salary", () => assert.equal(buildTemplateParameters("work_time_updated", context, 4, false).includes("400 ₪"), false));
test("owner custom work-time parameters may include salary", () => assert.equal(buildTemplateParameters("work_time_updated", context, 4, true).includes("400 ₪"), true));
