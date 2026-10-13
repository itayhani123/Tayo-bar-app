import type { ReceivableEvent } from "../types";

export type VenueSettlement = {
  id: string;
  venueId: string;
  venueName?: string;
  cutoffDate: string;
  amount: number;
  createdBy: string;
  createdAt: string;
};
export type SettlementPreview = {
  venueName: string;
  cutoffDate: string;
  eventCount: number;
  rawAmount: number;
  previousAmount: number;
  amount: number;
  version: string;
};
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function validateCutoff(cutoff: string, today: string, settlements: VenueSettlement[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || !Number.isFinite(Date.parse(cutoff)) || new Date(cutoff).toISOString().slice(0, 10) !== cutoff || cutoff > today)
    throw new Error("יש לבחור תאריך תקין שאינו בעתיד");
  if (settlements.some((row) => row.cutoffDate > cutoff))
    throw new Error("לא ניתן לסגור לפני תאריך הסגירה האחרון");
}

export function calculateVenueClosing(events: ReceivableEvent[], settlements: VenueSettlement[], venueId: string, cutoffDate: string) {
  const relevant = events.filter((event) => event.venueId === venueId && event.eventDate <= cutoffDate && (event.payerType === "venue" || event.venueHallFee > 0));
  const rawAmount = money(relevant.reduce((sum, event) => sum + event.venueSettlement, 0));
  const previousAmount = money(settlements.filter((row) => row.venueId === venueId && row.cutoffDate <= cutoffDate).reduce((sum, row) => sum + row.amount, 0));
  return { cutoffDate, eventCount: relevant.length, rawAmount, previousAmount, amount: money(rawAmount - previousAmount) };
}
