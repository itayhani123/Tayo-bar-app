import type { EventRecord } from "@/features/events/types";

export type CalendarStaffing = { eventId: string; assignedCount: number };
export type CalendarEvent = EventRecord & { assignedCount: number; recommendedBartenders: number };
export type CalendarAccess = "owner" | "manager";
export type CalendarFilters = { venueId: string; eventType: string; paymentStatus: string };
