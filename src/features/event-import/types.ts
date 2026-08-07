import type { EventFormValues, PayerType, VenueOption } from "@/features/events/types";

export type ImportRow = Omit<EventFormValues, "guestCount"> & { rowNumber: number; eventName: string; guestCount: number | null; venueName: string; secondaryContactName: string; secondaryContactPhone: string; sourceCreatedAt: string; eventTypeNeedsReview: boolean; errors: string[] };
export type ImportMasterData = { venues: VenueOption[]; packages: string[]; eventTypes: string[] };
export type BulkDefaults = { venueId: string; startTime: string; pricePerGuest: number; packageType: string; payerType: PayerType };
