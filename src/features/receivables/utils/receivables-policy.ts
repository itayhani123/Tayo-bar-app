import type { PaymentStatus } from "@/features/events/types";
import type { VenueSettlement } from "./venue-settlements";
import type { ReceivableEvent, ReceivablesScope, ReceivablesSummary, VenueReceivable } from "../types";

export const isActualReceivable = (event: Pick<ReceivableEvent, "eventDate">, today: string) => event.eventDate <= today;
export const receivablePaymentStatus = (outstanding: number, paid: number): PaymentStatus => outstanding <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";

export function filterReceivables(events: ReceivableEvent[], scope: ReceivablesScope, today: string, venueId = "", eventType = "") {
  const currentMonth = today.slice(0, 7); const scopedMonth = scope === "current" ? currentMonth : scope === "previous" ? moveMonth(currentMonth, -1) : scope === "next" ? moveMonth(currentMonth, 1) : null;
  const periodStart = scopedMonth ? `${scopedMonth}-01` : null;
  const periodEnd = scopedMonth ? endOfMonth(scopedMonth) : today;
  return events.filter((event) => (!periodStart || event.eventDate >= periodStart) && event.eventDate <= today && event.eventDate <= periodEnd && (!venueId || event.venueId === venueId) && (!eventType || event.eventType === eventType));
}

export function calculateReceivablesSummary(filtered: ReceivableEvent[], allEvents: ReceivableEvent[], today: string, settlements: VenueSettlement[] = []): ReceivablesSummary {
  const actualFiltered = filtered.filter((event) => isActualReceivable(event, today)); const actualEvents = allEvents.filter((event) => isActualReceivable(event, today));
  const open = (events: ReceivableEvent[], payer?: "client" | "venue") => events.filter((event) => !payer || event.payerType === payer).reduce((sum, event) => sum + Math.max(event.outstanding, 0), 0);
  const venues = groupByVenue(actualEvents, settlements.filter((row) => row.cutoffDate <= today));
  const venueBalance = money(venues.reduce((sum, venue) => sum + venue.venueSettlement, 0));
  return { totalOpenBalance: money(open(actualFiltered, "client") + venues.reduce((sum, venue) => sum + Math.max(venue.venueSettlement, 0), 0)), venueBalance, customerBalance: open(actualFiltered, "client"), currentMonthReceivables: open(actualEvents.filter((event) => event.eventDate.startsWith(today.slice(0, 7))), "client") };
}

/** With a ledger, pass the complete actual event history, never a filtered period. */
export function groupByVenue(events: ReceivableEvent[], settlements: VenueSettlement[] = []): VenueReceivable[] {
  const groups = new Map<string, ReceivableEvent[]>();
  events.forEach((event) => groups.set(event.venueId, [...(groups.get(event.venueId) ?? []), event]));
  settlements.forEach((row) => { if (!groups.has(row.venueId)) groups.set(row.venueId, []); });
  return [...groups.entries()].map(([venueId, rows]) => { const settlementEvents = rows.filter((event) => event.payerType === "venue" || event.venueHallFee > 0); return { venueId, venueName: rows[0]?.venueName ?? settlements.find((row) => row.venueId === venueId)?.venueName ?? "אולם", eventCount: settlementEvents.length, totalBilled: settlementEvents.reduce((sum, event) => sum + event.venueSettlementBeforeHallFee, 0), paid: settlementEvents.filter((event) => event.payerType === "venue").reduce((sum, event) => sum + event.paid, 0), hallFee: settlementEvents.reduce((sum, event) => sum + event.venueHallFee, 0), venueSettlement: money(settlementEvents.reduce((sum, event) => sum + event.venueSettlement, 0) - settlements.filter((row) => row.venueId === venueId).reduce((sum, row) => sum + row.amount, 0)), events: settlementEvents }; }).filter((venue) => venue.events.length > 0 || settlements.some((row) => row.venueId === venue.venueId)).sort((a, b) => a.venueName.localeCompare(b.venueName, "he"));
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const unpaidEvents = (events: ReceivableEvent[]) => events.filter((event) => event.outstanding > 0);
export const unsettledVenueEvents = (events: ReceivableEvent[]) => events.filter((event) => event.venueSettlement !== 0);
function moveMonth(month: string, delta: number) { const [year, number] = month.split("-").map(Number); const next = new Date(year, number - 1 + delta, 1); return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`; }
function endOfMonth(month: string) { const [year, number] = month.split("-").map(Number); const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate(); return `${month}-${String(lastDay).padStart(2, "0")}`; }
