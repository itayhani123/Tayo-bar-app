import assert from "node:assert/strict";
import test from "node:test";
import { calculatePaymentSummary } from "./calculations";

test("customer balance uses gross VAT-inclusive revenue", () => assert.deepEqual(calculatePaymentSummary(4500, [{ amount: 1000 }]), { totalDue: 4500, totalPaid: 1000, remainingBalance: 3500, status: "partial", overpaid: false }));
