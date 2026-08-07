import assert from "node:assert/strict";
import test from "node:test";
import { customerExportEvents, venueExportEvents } from "./export-policy.ts";
import type { ReceivableEvent } from "../types.ts";

const row = (id: string, eventDate: string, payerType: "venue" | "client", outstanding: number, paid = 0, venueId = "v1"): ReceivableEvent => ({ id, eventDate, payerType, outstanding, paid, totalBilled: outstanding + paid, paymentStatus: outstanding <= 0 ? "paid" : paid ? "partial" : "unpaid", venueId, venueName: venueId, eventType: "Wedding", clientName: id, clientPhone: "0501234567", guestCount: 100, pricePerGuest: 15, notes: "", lastPaymentDate: paid ? "2026-08-01" : null, lastPaymentMethod: paid ? "Cash" : null });
const today = "2026-08-07";
test("venue with three past unpaid events exports exactly three rows", () => assert.equal(venueExportEvents([row("1", "2026-08-01", "venue", 100), row("2", "2026-08-02", "venue", 200), row("3", "2026-08-03", "venue", 300)], today, "v1").length, 3));
test("venue export excludes tomorrow, fully paid and client-paid events", () => { const rows = [row("past", "2026-08-01", "venue", 100), row("tomorrow", "2026-08-08", "venue", 100), row("paid", "2026-08-01", "venue", 0, 100), row("client", "2026-08-01", "client", 100)]; assert.deepEqual(venueExportEvents(rows, today).map((event) => event.id), ["past"]); });
test("partial payment preserves the correct remaining balance", () => assert.equal(venueExportEvents([row("partial", "2026-08-01", "venue", 600, 400)], today)[0].outstanding, 600));
test("selected venue is respected", () => assert.deepEqual(venueExportEvents([row("one", "2026-08-01", "venue", 100, 0, "v1"), row("two", "2026-08-01", "venue", 100, 0, "v2")], today, "v2").map((event) => event.id), ["two"]));
test("Xanadu and Uptown exports never mix their events", () => { const rows = [row("xanadu", "2026-08-01", "venue", 100, 0, "xanadu"), row("uptown", "2026-08-02", "venue", 200, 0, "uptown")]; assert.deepEqual(venueExportEvents(rows, today, "xanadu").map((event) => event.id), ["xanadu"]); assert.deepEqual(venueExportEvents(rows, today, "uptown").map((event) => event.id), ["uptown"]); });
test("customer export never mixes venue receivables", () => assert.deepEqual(customerExportEvents([row("client", "2026-08-01", "client", 100), row("venue", "2026-08-01", "venue", 100)], today).map((event) => event.id), ["client"]));
