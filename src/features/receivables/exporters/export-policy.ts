import type { ReceivableEvent } from "../types";

export const venueExportEvents = (events: ReceivableEvent[], today: string, venueId?: string) => events.filter((event) => event.eventDate <= today && event.payerType === "venue" && event.outstanding > 0 && (!venueId || event.venueId === venueId));
export const customerExportEvents = (events: ReceivableEvent[], today: string) => events.filter((event) => event.eventDate <= today && event.payerType === "client" && event.outstanding > 0);
