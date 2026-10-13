import assert from "node:assert/strict";
import test from "node:test";
import { calculateReceivableEvent, type RawReceivableEvent } from "./receivables-calculations";
import { calculateVenueClosing, validateCutoff, type VenueSettlement } from "./venue-settlements";
import { calculateReceivablesSummary, groupByVenue } from "./receivables-policy";
import { customerExportEvents } from "../exporters/export-policy";
import { createVenueWorkbook } from "../exporters/venue-receivables-excel";

const raw = (overrides: Partial<RawReceivableEvent> = {}): RawReceivableEvent => ({
  id: "event", venueId: "venue", venueName: "אפטאון", eventDate: "2026-08-01", eventType: "Wedding",
  packageType: "Premium", payerType: "venue", clientName: "לקוח", clientPhone: "", guestCount: 300,
  pricePerGuest: 30, priceIncludesVat: true, vatRate: 18, notes: "",
  payments: [{ amount: 1000, paidAt: "2026-08-01", paymentMethod: "Cash" }], ...overrides,
});
const closing = (amount: number, cutoffDate = "2026-08-01"): VenueSettlement => ({ id: "closing", venueId: "venue", cutoffDate, amount, createdBy: "owner", createdAt: cutoffDate });

test("inclusive positive closing nets venue-paid events and customer hall fees, leaving later events open", () => {
  const events = [raw(), raw({ id: "customer", payerType: "client" }), raw({ id: "later", eventDate: "2026-08-02" })].map(calculateReceivableEvent);
  const before = structuredClone(events);
  const amount = calculateVenueClosing(events, [], "venue", "2026-08-01");
  assert.deepEqual(amount, { cutoffDate: "2026-08-01", eventCount: 2, rawAmount: 3800, previousAmount: 0, amount: 3800 });
  const ledger = [closing(amount.amount)];
  assert.equal(calculateVenueClosing(events, ledger, "venue", "2026-08-01").amount, 0);
  assert.equal(calculateVenueClosing(events, ledger, "venue", "2026-08-02").amount, 5900);
  assert.deepEqual(events, before);
  assert.deepEqual(customerExportEvents(events, "2026-08-02"), customerExportEvents(before, "2026-08-02"));
  assert.equal(events[1].outstanding, 8000);
});

test("negative and sequential closings, including corrections at the same cutoff", () => {
  const events = [calculateReceivableEvent(raw({ payerType: "client" }))];
  const first = calculateVenueClosing(events, [], "venue", "2026-08-01");
  assert.equal(first.amount, -2100);
  const ledger = [closing(first.amount)];
  assert.equal(calculateVenueClosing(events, ledger, "venue", "2026-08-01").amount, 0);
  events.push(calculateReceivableEvent(raw({ id: "new", eventDate: "2026-08-02" })));
  const second = calculateVenueClosing(events, ledger, "venue", "2026-08-02");
  ledger.push(closing(second.amount, "2026-08-02"));
  assert.equal(second.amount, 5900);
  assert.equal(calculateVenueClosing(events, ledger, "venue", "2026-08-02").amount, 0);
  events[1] = calculateReceivableEvent(raw({ eventDate: "2026-08-02", payments: [] }));
  assert.equal(calculateVenueClosing(events, ledger, "venue", "2026-08-02").amount, 1000);
});

test("invalid, future and retroactive dates are rejected", () => {
  for (const cutoff of ["", "2026-02-30", "2026-8-01", "2026-09-01", "2026-07-31"])
    assert.throws(() => validateCutoff(cutoff, "2026-08-30", [closing(100)]));
  validateCutoff("2026-08-01", "2026-08-30", [closing(100)]);
});

test("dashboard/summary and venue cards use cumulative net balances; customer amounts are unchanged", () => {
  const events = [raw(), raw({ payerType: "client" })].map(calculateReceivableEvent);
  const ledger = [closing(3800)];
  assert.equal(groupByVenue(events, ledger)[0].venueSettlement, 0);
  assert.deepEqual(calculateReceivablesSummary(events, events, "2026-08-30", ledger), {
    totalOpenBalance: 8000, venueBalance: 0, customerBalance: 8000, currentMonthReceivables: 8000,
  });
  assert.equal(groupByVenue([], ledger)[0].venueSettlement, -3800, "source deletions remain visible as adjustments");
});

test("Excel retains raw event history and separates signed closings from the remaining balance", () => {
  const events = [raw(), raw({ payerType: "client" })].map(calculateReceivableEvent);
  const book = createVenueWorkbook("אפטאון", events, [closing(3800)]);
  assert.equal(book.Sheets["יתרה לגבייה"].I5.v, 5900);
  assert.equal(book.Sheets["יתרה לגבייה"].I6.v, -2100);
  const ledger = book.Sheets["סגירות ויתרה"];
  assert.equal(ledger.B3.v, 3800);
  assert.equal(ledger.B6.v, 0);
});

test("VAT and payment rounding use the canonical event rules", () => {
  const events = [calculateReceivableEvent(raw({ venueName: "Other", guestCount: 3, pricePerGuest: 10.01, priceIncludesVat: false, payments: [{ amount: 0.01, paidAt: "2026-08-01", paymentMethod: "Cash" }] }))];
  const preview = calculateVenueClosing(events, [], "venue", "2026-08-01");
  assert.equal(preview.amount, 35.43);
  assert.equal(calculateVenueClosing(events, [closing(preview.amount)], "venue", "2026-08-01").amount, 0);
});
