import assert from "node:assert/strict";
import test from "node:test";
import { calculateReceivablesSummary, filterReceivables, groupByVenue, receivablePaymentStatus } from "./receivables-policy.ts";
import type { ReceivableEvent } from "../types.ts";

const event = (id: string, eventDate: string, payerType: "client" | "venue", paid: number, outstanding: number, venueId = "venue-1", venueHallFee = 0): ReceivableEvent => ({ id, eventDate, payerType, paid, outstandingBeforeHallFee: outstanding, outstanding, venueSettlementBeforeHallFee: payerType === "venue" ? outstanding : 0, venueSettlement: payerType === "venue" ? outstanding - venueHallFee : -venueHallFee, totalBilled: paid + outstanding, paymentStatus: receivablePaymentStatus(outstanding, paid), eventType: "Wedding", venueId, venueName: venueId === "venue-1" ? "קסנאדו" : "אפטאון", clientName: `לקוח ${id}`, clientPhone: "0501234567", guestCount: 100, packageType: venueHallFee ? "Premium" : "Pouring", venueHallFeePerGuest: venueHallFee ? 3 : 0, venueHallFee, pricePerGuest: 15, notes: "", lastPaymentDate: paid ? "2026-08-01" : null, lastPaymentMethod: paid ? "Cash" : null });
const today = "2026-08-07";

test("past unpaid event appears and is unpaid", () => { const rows = filterReceivables([event("unpaid", "2026-08-06", "client", 0, 1000)], "all", today); assert.equal(rows.length, 1); assert.equal(rows[0].paymentStatus, "unpaid"); });
test("past partially paid event keeps its remaining balance", () => { const row = event("partial", "2026-08-06", "client", 400, 600); assert.equal(row.paymentStatus, "partial"); assert.equal(row.outstanding, 600); });
test("past fully paid event has zero balance and paid status", () => { const row = event("paid", "2026-08-06", "client", 1000, 0); assert.equal(row.paymentStatus, "paid"); assert.equal(row.outstanding, 0); });
test("tomorrow and later events this month never appear", () => { const rows = filterReceivables([event("today", today, "client", 0, 100), event("tomorrow", "2026-08-08", "client", 0, 100), event("later", "2026-08-31", "client", 0, 100)], "current", today); assert.deepEqual(rows.map((row) => row.id), ["today"]); });
test("current venue cards include only events from the current month through today", () => {
  const today = "2026-08-30";
  const rows = [event("july", "2026-07-31", "venue", 0, 100), event("month-start", "2026-08-01", "venue", 0, 200), event("month-current", "2026-08-20", "venue", 0, 300), event("future", "2026-08-31", "venue", 0, 400)];
  const currentCards = groupByVenue(filterReceivables(rows, "current", today));
  assert.deepEqual(currentCards[0].events.map((row) => row.id), ["month-start", "month-current"]);
  assert.equal(currentCards[0].venueSettlement, 500);
});
test("previous month includes the full month and future month is empty", () => { const rows = [event("previous", "2026-07-31", "client", 0, 100), event("future", "2026-09-01", "client", 0, 100)]; assert.deepEqual(filterReceivables(rows, "previous", today).map((row) => row.id), ["previous"]); assert.equal(filterReceivables(rows, "next", today).length, 0); });
test("venue and client balances are split by event payer", () => { const rows = [event("venue", "2026-08-06", "venue", 0, 700), event("client", "2026-08-06", "client", 0, 300)]; assert.deepEqual(calculateReceivablesSummary(rows, rows, today), { totalOpenBalance: 1000, venueBalance: 700, customerBalance: 300, currentMonthReceivables: 1000 }); });
test("venue cards net venue debt with client-paid hall fees", () => { const cards = groupByVenue([event("v1", "2026-08-01", "venue", 200, 7100), event("c1", "2026-08-02", "client", 0, 8000, "venue-1", 900)]); const xanadu = cards.find((card) => card.venueId === "venue-1"); assert.equal(xanadu?.venueSettlement, 6200); assert.equal(xanadu?.hallFee, 900); assert.equal(xanadu?.eventCount, 2); });
