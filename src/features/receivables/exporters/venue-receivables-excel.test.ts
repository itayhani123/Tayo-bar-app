import assert from "node:assert/strict";
import test from "node:test";
import { calculateReceivableEvent, type RawReceivableEvent } from "../utils/receivables-calculations.ts";
import { createVenueWorkbook } from "./venue-receivables-excel.ts";

const raw: RawReceivableEvent = { id: "uptown-event", eventDate: "2026-08-30", eventType: "Wedding", venueId: "uptown", venueName: "אפטאון", clientName: "לקוח", clientPhone: "", payerType: "venue", guestCount: 300, packageType: "Premium", pricePerGuest: 30, vatRate: 18, priceIncludesVat: true, notes: "", payments: [{ amount: 1000, paidAt: "2026-08-30", paymentMethod: "Cash" }] };

test("venue Excel exports calculated balances and a negative numeric hall fee", () => {
  const workbook = createVenueWorkbook("אפטאון", [calculateReceivableEvent(raw)]);
  const sheet = workbook.Sheets["יתרה לגבייה"];
  assert.equal(sheet.G5.v, 8000);
  assert.equal(sheet.H5.v, -2100);
  assert.equal(sheet.H5.t, "n");
  assert.equal(sheet.I5.v, 5900);
  assert.equal(sheet.G6.v, 8000);
  assert.equal(sheet.H6.v, -2100);
  assert.equal(sheet.I6.v, 5900);
});

test("client-paid event exports only its negative venue fee settlement", () => {
  const event = calculateReceivableEvent({ ...raw, payerType: "client" });
  const sheet = createVenueWorkbook("אפטאון", [event]).Sheets["יתרה לגבייה"];
  assert.equal(sheet.F5.v, "לקוח");
  assert.equal(sheet.G5.v, 0);
  assert.equal(sheet.H5.v, -2100);
  assert.equal(sheet.I5.v, -2100);
});
