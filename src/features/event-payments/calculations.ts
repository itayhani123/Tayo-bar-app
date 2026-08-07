import { roundMoney } from "@/lib/finance/calculations";
import type { PaymentStatus } from "@/features/events/types";
import type { EventPayment, EventPaymentSummary } from "./types";

export function calculatePaymentStatus(totalDue: number, totalPaid: number): PaymentStatus {
  if (totalPaid <= 0) return "unpaid";
  return totalPaid >= totalDue ? "paid" : "partial";
}

export function calculatePaymentSummary(totalDue: number, payments: Pick<EventPayment, "amount">[]): EventPaymentSummary {
  const due = roundMoney(Math.max(totalDue, 0));
  const paid = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
  return { totalDue: due, totalPaid: paid, remainingBalance: roundMoney(due - paid), status: calculatePaymentStatus(due, paid), overpaid: paid > due };
}
