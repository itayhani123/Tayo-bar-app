import type { PayerType, PaymentStatus } from "@/features/events/types";

export type ReceivableEvent = {
  id: string;
  eventDate: string;
  eventType: string;
  venueId: string;
  venueName: string;
  clientName: string;
  clientPhone: string;
  guestCount: number;
  pricePerGuest: number;
  notes: string;
  payerType: PayerType;
  totalBilled: number;
  paid: number;
  outstanding: number;
  paymentStatus: PaymentStatus;
  lastPaymentDate: string | null;
  lastPaymentMethod: string | null;
};

export type ReceivablesScope = "current" | "previous" | "next" | "all";
export type VenueReceivable = { venueId: string; venueName: string; eventCount: number; totalBilled: number; paid: number; outstanding: number; events: ReceivableEvent[] };
export type ReceivablesSummary = { totalOpenBalance: number; venueBalance: number; customerBalance: number; currentMonthReceivables: number };
