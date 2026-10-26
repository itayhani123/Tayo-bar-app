import { calculateReceivableEvent } from "./receivables-calculations";
import { calculateVenueClosing, type VenueSettlement } from "./venue-settlements";

/** Reconstruct legacy allocations from the immutable original source, never today's events. */
export function hydrateSettlementHistory(rows: VenueSettlement[]): VenueSettlement[] {
  const history: VenueSettlement[] = [];
  for (const row of [...rows].sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const allocations = row.allocations ?? (row.sourceEvents ? calculateVenueClosing(row.sourceEvents.map(calculateReceivableEvent), history, row.venueId, row.cutoffDate).allocations : undefined);
    history.push({ ...row, includesHallFee: row.includesHallFee ?? true, allocations });
  }
  return history;
}
