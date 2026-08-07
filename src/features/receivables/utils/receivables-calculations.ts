import { calculatePaymentSummary } from "@/features/event-payments";
import { calculateVat } from "@/lib/finance/calculations";
import type { ReceivableEvent } from "../types";
import { receivablePaymentStatus } from "./receivables-policy";

export type RawReceivableEvent = { id: string; eventDate: string; eventType: string; venueId: string; venueName: string; clientName: string; clientPhone: string; payerType: "client" | "venue"; guestCount: number; pricePerGuest: number; vatRate: number; priceIncludesVat: boolean; notes: string; payments: { amount: number; paidAt: string; paymentMethod: string }[] };

export function calculateReceivableEvent(event: RawReceivableEvent): ReceivableEvent {
  const payment = calculatePaymentSummary(calculateVat(event).grossRevenue, event.payments);
  const lastPayment = [...event.payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];
  const paymentStatus = receivablePaymentStatus(payment.remainingBalance, payment.totalPaid);
  return { id: event.id, eventDate: event.eventDate, eventType: event.eventType, venueId: event.venueId, venueName: event.venueName, clientName: event.clientName, clientPhone: event.clientPhone, guestCount: event.guestCount, pricePerGuest: event.pricePerGuest, notes: event.notes, payerType: event.payerType, totalBilled: payment.totalDue, paid: payment.totalPaid, outstanding: payment.remainingBalance, paymentStatus, lastPaymentDate: lastPayment?.paidAt ?? null, lastPaymentMethod: lastPayment?.paymentMethod ?? null };
}
