import type { PaymentStatus } from "@/features/events/types";
import type { ReceivableEvent, ReceivablesScope, ReceivablesSummary, VenueReceivable } from "../types";

export const isActualReceivable = (event: Pick<ReceivableEvent, "eventDate">, today: string) => event.eventDate <= today;
export const receivablePaymentStatus = (outstanding: number, paid: number): PaymentStatus => outstanding <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";

export function filterReceivables(events: ReceivableEvent[], scope: ReceivablesScope, today: string, venueId = "", eventType = "") {
  const currentMonth = today.slice(0, 7); const scopedMonth = scope === "current" ? currentMonth : scope === "previous" ? moveMonth(currentMonth, -1) : scope === "next" ? moveMonth(currentMonth, 1) : null;
  return events.filter((event) => isActualReceivable(event, today) && (!scopedMonth || event.eventDate.startsWith(scopedMonth)) && (!venueId || event.venueId === venueId) && (!eventType || event.eventType === eventType));
}

export function calculateReceivablesSummary(filtered: ReceivableEvent[], allEvents: ReceivableEvent[], today: string): ReceivablesSummary {
  const actualFiltered = filtered.filter((event) => isActualReceivable(event, today)); const actualEvents = allEvents.filter((event) => isActualReceivable(event, today));
  const open = (events: ReceivableEvent[], payer?: "client" | "venue") => events.filter((event) => !payer || event.payerType === payer).reduce((sum, event) => sum + Math.max(event.outstanding, 0), 0);
  return { totalOpenBalance: open(actualFiltered), venueBalance: open(actualFiltered, "venue"), customerBalance: open(actualFiltered, "client"), currentMonthReceivables: open(actualEvents.filter((event) => event.eventDate.startsWith(today.slice(0, 7)))) };
}

export function groupByVenue(events: ReceivableEvent[]): VenueReceivable[] {
  const groups = new Map<string, ReceivableEvent[]>();
  events.forEach((event) => groups.set(event.venueId, [...(groups.get(event.venueId) ?? []), event]));
  return [...groups.entries()].map(([venueId, rows]) => { const venuePaidEvents = rows.filter((event) => event.payerType === "venue"); return { venueId, venueName: rows[0].venueName, eventCount: venuePaidEvents.filter((event) => event.outstanding > 0).length, totalBilled: venuePaidEvents.reduce((sum, event) => sum + event.totalBilled, 0), paid: venuePaidEvents.reduce((sum, event) => sum + event.paid, 0), outstanding: venuePaidEvents.reduce((sum, event) => sum + Math.max(event.outstanding, 0), 0), events: venuePaidEvents }; }).sort((a, b) => a.venueName.localeCompare(b.venueName, "he"));
}

export const unpaidEvents = (events: ReceivableEvent[]) => events.filter((event) => event.outstanding > 0);
function moveMonth(month: string, delta: number) { const [year, number] = month.split("-").map(Number); const next = new Date(year, number - 1 + delta, 1); return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`; }
