import type { PayerType, PaymentStatus } from "@/features/events/types";

export type EventPaymentValues = {
  amount: number;
  paymentMethod: string;
  payerType: PayerType;
  paidAt: string;
  notes: string;
};

export type EventPayment = EventPaymentValues & {
  id: string;
  eventId: string;
  createdAt: string;
  updatedAt: string;
};

export type EventPaymentSummary = {
  totalDue: number;
  totalPaid: number;
  remainingBalance: number;
  status: PaymentStatus;
  overpaid: boolean;
};
