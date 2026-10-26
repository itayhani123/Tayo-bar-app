import { hydrateSettlementHistory } from "./settlement-history";
import { venueExportEvents } from "../exporters/export-policy";
import assert from "node:assert/strict";
import test from "node:test";
import { calculateReceivableEvent, type RawReceivableEvent } from "./receivables-calculations";
import { applyVenueSettlements, calculateVenueClosing, validateCutoff, type VenueSettlement } from "./venue-settlements";
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
  assert.deepEqual({ cutoffDate: amount.cutoffDate, eventCount: amount.eventCount, rawAmount: amount.rawAmount, previousAmount: amount.previousAmount, amount: amount.amount }, { cutoffDate: "2026-08-01", eventCount: 2, rawAmount: 3800, previousAmount: 0, amount: 3800 });
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
  const book = createVenueWorkbook("אפטאון", events, [closing(3800)], true);
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

for (const includesHallFee of [true, false]) test("component closing, fee choice " + includesHallFee, () => {
  const events = [calculateReceivableEvent(raw()), calculateReceivableEvent(raw({ id: "client", payerType: "client" }))];
  const before = structuredClone(events);
  const first = calculateVenueClosing(events, [], "venue", "2026-08-01", includesHallFee);
  const ledger = [{ ...closing(first.amount), allocations: first.allocations, includesHallFee }];
  const open = applyVenueSettlements(events, ledger);
  assert.equal(first.amount, includesHallFee ? 3800 : 8000);
  assert.equal(open.reduce((sum, event) => sum + event.venueSettlement, 0), includesHallFee ? 0 : -4200);
  assert.deepEqual(customerExportEvents(open, "2026-08-02"), customerExportEvents(events, "2026-08-02").map((event) => open.find((row) => row.id === event.id)));
  assert.equal(open[1].outstanding, before[1].outstanding);
  const book = createVenueWorkbook("אפטאון", events, ledger);
  const sheet = book.Sheets[book.SheetNames[0]];
  if (includesHallFee) assert.equal(sheet.A5.v, "סה״כ להתחשבנות");
  else { assert.equal(sheet.F5.v, "עמלת אולם בלבד"); assert.equal(sheet.G5.v, 0); assert.equal(sheet.I5.v, -2100); }
  const next = calculateVenueClosing(events, ledger, "venue", "2026-08-01");
  assert.equal(next.amount, includesHallFee ? 0 : -4200);
  ledger.push({ ...closing(next.amount), allocations: next.allocations, includesHallFee: true });
  assert.ok(applyVenueSettlements(events, ledger).every((event) => event.venueSettlement === 0));
  const changed = [calculateReceivableEvent(raw({ payments: [] })), events[1], calculateReceivableEvent(raw({ id: "later", eventDate: "2026-08-02" }))];
  const remaining = applyVenueSettlements(changed, ledger);
  assert.equal(remaining[0].venueSettlement, 1000);
  assert.equal(remaining[2].venueSettlement, 5900);
  const summary = calculateReceivablesSummary(changed, changed, "2026-08-02", ledger);
  assert.equal(summary.venueBalance, groupByVenue(changed, ledger)[0].venueSettlement);
  assert.deepEqual(events, before);
});

test("legacy immutable snapshots reconstruct signed allocations and preserve later corrections", () => {
  const events = [raw(), raw({ id: "customer", payerType: "client" })];
  const first = { ...closing(3800), sourceEvents: events };
  const history = hydrateSettlementHistory([first]);
  assert.equal(history[0].includesHallFee, true);
  assert.equal(venueExportEvents(events.map(calculateReceivableEvent), "2026-08-01", "venue", history).length, 0);
  const changed = [raw({ payments: [] }), events[1]].map(calculateReceivableEvent);
  const open = venueExportEvents(changed, "2026-08-01", "venue", history);
  assert.equal(open.length, 1);
  assert.equal(open[0].venueSettlement, 1000);
  const second = { ...closing(1000), id: "second", createdAt: "2026-08-02", sourceEvents: changed.map((event, index) => index === 0 ? raw({ payments: [] }) : events[index]) };
  assert.equal(venueExportEvents(changed, "2026-08-01", "venue", hydrateSettlementHistory([second, first])).length, 0);
});
test("deleted source and lowered fee remain visible as signed adjustments", () => {
  const event = calculateReceivableEvent(raw({ payerType: "client" }));
  const first = calculateVenueClosing([event], [], "venue", "2026-08-01");
  const history = [{ ...closing(first.amount), allocations: first.allocations }];
  const corrected = { ...event, venueHallFee: 1000, venueSettlement: -1000 };
  assert.equal(groupByVenue([corrected], history)[0].events[0].venueSettlement, 1100);
  assert.equal(venueExportEvents([], "2026-08-01", "venue", history)[0].venueSettlement, 2100);
});
