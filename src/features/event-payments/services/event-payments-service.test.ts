import assert from "node:assert/strict";
import test from "node:test";
import { buildEventPaymentPayload } from "./event-payments-service.ts";

const values = (paymentMethod: string) => ({ amount: 100, paymentMethod, payerType: "client" as const, paidAt: "2026-08-03T12:00:00.000Z", notes: "" });
test("create stores Cash as English text", () => assert.equal(buildEventPaymentPayload(values("Cash")).payment_method, "Cash"));
test("create stores Bank Transfer as English text", () => assert.equal(buildEventPaymentPayload(values("Bank Transfer")).payment_method, "Bank Transfer"));
test("editing Cash to Bit stores Bit as English text", () => assert.equal(buildEventPaymentPayload(values("Bit")).payment_method, "Bit"));
