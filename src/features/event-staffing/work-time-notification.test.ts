import test from "node:test";
import assert from "node:assert/strict";
import { getWorkedMinutes } from "./calculations.ts";
import { shouldEnqueueWorkTimeUpdated, workTimeNotificationDedupeSource } from "./work-time-notification.ts";

const start = "2026-08-09T15:30:00.000Z";
const end = "2026-08-09T22:30:00.000Z";

test("start only does not enqueue", () => assert.equal(shouldEnqueueWorkTimeUpdated({ workStart: null, workEnd: null }, { workStart: start, workEnd: null }), false));
test("end only does not enqueue when start is absent", () => assert.equal(shouldEnqueueWorkTimeUpdated({ workStart: null, workEnd: null }, { workStart: null, workEnd: end }), false));
test("saving end enqueues when a start was already saved", () => assert.equal(shouldEnqueueWorkTimeUpdated({ workStart: start, workEnd: null }, { workStart: start, workEnd: end }), true));
test("both changed times enqueue", () => assert.equal(shouldEnqueueWorkTimeUpdated({ workStart: null, workEnd: null }, { workStart: start, workEnd: end }), true));
test("identical instants with different timestamp formats do not enqueue", () => assert.equal(shouldEnqueueWorkTimeUpdated({ workStart: "2026-08-09T18:30:00+03:00", workEnd: "2026-08-10T01:30:00+03:00" }, { workStart: start, workEnd: end }), false));
test("changing work end creates a distinct dedupe source", () => { const first = workTimeNotificationDedupeSource("a1", { workStart: start, workEnd: end }); const second = workTimeNotificationDedupeSource("a1", { workStart: start, workEnd: "2026-08-09T23:00:00.000Z" }); assert.notEqual(first, second); });
test("overnight shift duration is seven hours", () => assert.equal(getWorkedMinutes("2026-08-09T18:30:00+03:00", "2026-08-10T01:30:00+03:00"), 420));
