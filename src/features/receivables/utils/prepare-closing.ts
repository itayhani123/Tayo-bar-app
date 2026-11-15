import { calculateReceivableEvent, type RawReceivableEvent } from "./receivables-calculations";
import { calculateVenueClosing, validateCutoff, type VenueSettlement } from "./venue-settlements";
import { hydrateSettlementHistory } from "./settlement-history";

export type VenueClosingSnapshot = { venue: { id: string; name: string } | null; events: RawReceivableEvent[]; settlements: VenueSettlement[] };
export function prepareVenueClosing(snapshot: VenueClosingSnapshot, venueId: string, cutoffDate: string, includesHallFee: boolean, today: string) {
  if (!snapshot.venue) throw new Error("האולם לא נמצא");
  validateCutoff(cutoffDate, today, snapshot.settlements);
  return calculateVenueClosing(snapshot.events.map(calculateReceivableEvent), hydrateSettlementHistory(snapshot.settlements), venueId, cutoffDate, includesHallFee);
}
