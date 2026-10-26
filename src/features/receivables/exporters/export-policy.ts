import { applyVenueSettlements, type VenueSettlement } from "../utils/venue-settlements";
import type { ReceivableEvent } from "../types";

export const venueExportEvents = (events: ReceivableEvent[], today: string, venueId?: string, settlements: VenueSettlement[] = [], history = false) => (history ? events : applyVenueSettlements(events, settlements)).filter((event) => event.eventDate <= today && (history ? event.payerType === "venue" || event.venueHallFee !== 0 : event.venueSettlement !== 0) && (!venueId || event.venueId === venueId));
export const customerExportEvents = (events: ReceivableEvent[], today: string) => events.filter((event) => event.eventDate <= today && event.payerType === "client" && event.outstanding > 0);
