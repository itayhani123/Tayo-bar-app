import assert from "node:assert/strict";
import test from "node:test";
import { getDashboardActualDateRange, getIsraelDateOnly } from "./dashboard-date-range.ts";

test("current month includes today", () => assert.deepEqual(getDashboardActualDateRange("2026-08", "2026-08-04"), { start: "2026-08-01", end: "2026-08-04" }));
test("current month excludes tomorrow", () => assert.notEqual(getDashboardActualDateRange("2026-08", "2026-08-04")?.end, "2026-08-05"));
test("past month includes the full month", () => assert.deepEqual(getDashboardActualDateRange("2026-07", "2026-08-04"), { start: "2026-07-01", end: "2026-07-31" }));
test("future month has no actual range", () => assert.equal(getDashboardActualDateRange("2026-09", "2026-08-04"), null));
test("month boundary supports leap years", () => assert.deepEqual(getDashboardActualDateRange("2024-02", "2024-03-01"), { start: "2024-02-01", end: "2024-02-29" }));
test("Israel local date can be ahead of UTC", () => assert.equal(getIsraelDateOnly(new Date("2026-08-03T21:30:00.000Z")), "2026-08-04"));
