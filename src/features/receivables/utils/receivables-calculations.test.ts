import assert from "node:assert/strict";
import test from "node:test";
import { calculateReceivableEvent, calculateVenueHallFee, getVenueHallFeePerGuest, type RawReceivableEvent } from "./receivables-calculations.ts";
const event = (venueName: string, packageType: string, overrides: Partial<RawReceivableEvent> = {}): RawReceivableEvent => ({ id: "event-1", eventDate: "2026-08-30", eventType: "Wedding", venueId: venueName, venueName, clientName: "לקוח", clientPhone: "0501234567", payerType: "venue", guestCount: 300, packageType, pricePerGuest: 30, vatRate: 18, priceIncludesVat: true, notes: "", payments: [{ amount: 1000, paidAt: "2026-08-30", paymentMethod: "Cash" }], ...overrides });
for (const packageType of ["Premium", "Super Premium", "Ultra Premium"]) {
  test(`Xanadu ${packageType} with 300 guests costs 900`, () => assert.equal(calculateVenueHallFee(event("קסנאדו", packageType)), 900));
  test(`Uptown ${packageType} with 300 guests costs 2100`, () => assert.equal(calculateVenueHallFee(event("אפטאון", packageType)), 2100));
}
test("venue rates require exact names", () => { assert.equal(getVenueHallFeePerGuest("קסנאדו"), 3); assert.equal(getVenueHallFeePerGuest("אפטאון"), 7); assert.equal(getVenueHallFeePerGuest("אולם קסנאדו"), 0); });
test("Pouring has no Xanadu fee but Uptown weddings retain their fee", () => { assert.equal(calculateVenueHallFee(event("קסנאדו", "Pouring")), 0); assert.equal(calculateVenueHallFee(event("אפטאון", "Pouring")), 2100); });
test("unknown venue and missing guests return zero", () => { assert.equal(calculateVenueHallFee(event("אולם אחר", "Premium")), 0); assert.equal(calculateVenueHallFee({ venueName: "אפטאון", eventType: "Wedding", packageType: "Premium", guestCount: null }), 0); });
test("Xanadu fee is deducted once from an 8000 balance", () => { const result = calculateReceivableEvent(event("קסנאדו", "Premium")); assert.equal(result.outstandingBeforeHallFee, 8000); assert.equal(result.venueHallFee, 900); assert.equal(result.outstanding, 7100); });
test("Uptown fee is deducted once from an 8000 balance", () => { const result = calculateReceivableEvent(event("אפטאון", "Premium")); assert.equal(result.outstandingBeforeHallFee, 8000); assert.equal(result.venueHallFee, 2100); assert.equal(result.outstanding, 5900); });
test("client debt stays intact while venue settlement contains only the fee", () => { const result = calculateReceivableEvent(event("קסנאדו", "Premium", { payerType: "client" })); assert.equal(result.outstandingBeforeHallFee, 8000); assert.equal(result.outstanding, 8000); assert.equal(result.venueHallFee, 900); assert.equal(result.venueSettlementBeforeHallFee, 0); assert.equal(result.venueSettlement, -900); });
test("Uptown client-paid Premium settles at minus 2100", () => assert.equal(calculateReceivableEvent(event("אפטאון", "Premium", { payerType: "client" })).venueSettlement, -2100));
test("Uptown client-paid Pouring wedding settles its hall fee", () => assert.equal(calculateReceivableEvent(event("אפטאון", "Pouring", { payerType: "client" })).venueSettlement, -2100));
test("Uptown other Pouring events charge only guests above 100", () => {
  assert.equal(calculateVenueHallFee(event("אפטאון", "Pouring", { eventType: "Other", guestCount: 100 })), 0);
  assert.equal(calculateVenueHallFee(event("אפטאון", "Pouring", { eventType: "Other", guestCount: 120 })), 140);
});
