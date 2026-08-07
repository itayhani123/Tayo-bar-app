import assert from "node:assert/strict";
import test from "node:test";
import { eventInstant, reminderSchedule, scheduleChanged, shouldNotifyWorkTime } from "./scheduling.ts";

test("detects only event date or time changes", () => { assert.equal(scheduleChanged("2026-08-04", "19:30", "2026-08-04", "19:30:00"), false); assert.equal(scheduleChanged("2026-08-04", "19:30", "2026-08-05", "19:30"), true); });
test("schedules reminders before the Israel-local event instant", () => assert.equal(reminderSchedule("2026-08-10", "19:30", 24, new Date("2026-08-01T00:00:00Z"))?.toISOString(), "2026-08-09T16:30:00.000Z"));
test("does not schedule reminders late", () => assert.equal(reminderSchedule("2026-08-04", "19:30", 4, new Date("2026-08-04T16:00:00Z")), null));
test("handles Israel time around midnight", () => assert.equal(eventInstant("2026-08-05", "00:30").toISOString(), "2026-08-04T21:30:00.000Z"));
test("work-time message requires both changed times", () => { assert.equal(shouldNotifyWorkTime(null, null, "2026-08-04T16:00:00Z", null), false); assert.equal(shouldNotifyWorkTime(null, null, "2026-08-04T16:00:00Z", "2026-08-04T22:00:00Z"), true); assert.equal(shouldNotifyWorkTime("a", "b", "a", "b"), false); });
