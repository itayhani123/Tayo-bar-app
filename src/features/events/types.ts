export const EVENT_TYPES = ["Wedding", "Brit", "Bar Mitzvah", "Bat Mitzvah", "Business", "Henna", "Other"] as const;
export const PACKAGE_TYPES = ["Pouring", "Premium", "Super Premium", "Ultra Premium"] as const;
export const PAYER_TYPES = ["client", "venue"] as const;
export const PAYMENT_STATUSES = ["unpaid", "partial", "paid"] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type PackageType = (typeof PACKAGE_TYPES)[number];
export type PayerType = (typeof PAYER_TYPES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const SALES_STATUSES = ["lead", "contacted", "proposal_sent", "waiting", "won", "lost"] as const;
export type SalesStatus = (typeof SALES_STATUSES)[number];
export const salesStatusLabels: Record<SalesStatus, string> = { lead: "ליד חדש", contacted: "נוצר קשר", proposal_sent: "הצעה נשלחה", waiting: "ממתין", won: "נסגר", lost: "אבד" };

export type EventFormValues = {
  eventDate: string;
  startTime: string;
  venueId: string;
  clientName: string;
  clientPhone: string;
  guestCount: number;
  eventType: string;
  packageType: string;
  pricePerGuest: number;
  vatRate: number;
  priceIncludesVat: boolean;
  payerType: PayerType;
  paymentStatus: PaymentStatus;
  estimatedAlcoholCost: number;
  securityCheckReceived: boolean;
  invoiceIssued: boolean;
  managerEmployeeId: string;
  notes: string;
};

export type EventRecord = EventFormValues & {
  id: string;
  venueName: string;
  createdAt: string;
  updatedAt: string;
  salesStatus: SalesStatus | null;
  leadSource: string;
  salesNotes: string;
  lastContactAt: string;
  nextFollowUpAt: string;
  proposalAmount: number | null;
  closedAt: string;
};

export type VenueOption = { id: string; name: string };

export type EventMutationInput = Omit<EventFormValues, "managerEmployeeId" | "clientPhone" | "notes"> & {
  managerEmployeeId?: string;
  clientPhone?: string;
  notes?: string;
};
