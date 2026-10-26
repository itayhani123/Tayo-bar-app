import type { ReceivableEvent } from "../types";

export type VenueSettlement = {
  includesHallFee?: boolean;
  allocations?: SettlementAllocation[];
  sourceEvents?: import("./receivables-calculations").RawReceivableEvent[];
  id: string;
  venueId: string;
  venueName?: string;
  cutoffDate: string;
  amount: number;
  createdBy: string;
  createdAt: string;
};
export type SettlementAllocation = { eventId: string; payment: number; hallFee: number; event?: ReceivableEvent };
export type SettlementPreview = {
  paymentBalance: number;
  hallFeeBalance: number;
  remainingHallFee: number;
  remainingBalance: number;
  includesHallFee: boolean;
  allocations: SettlementAllocation[];
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


/** Fixed components preserve later payment/fee corrections and customer balances. */
export function applyVenueSettlements(events: ReceivableEvent[], settlements: VenueSettlement[]): ReceivableEvent[] {
  const sources = new Map(events.map((event) => [event.venueId + ":" + event.id, event]));
  for (const settlement of settlements) for (const allocation of settlement.allocations ?? []) {
    if (!sources.has(settlement.venueId + ":" + allocation.eventId) && allocation.event) sources.set(settlement.venueId + ":" + allocation.eventId, { ...allocation.event, venueSettlementBeforeHallFee: 0, venueHallFee: 0, venueSettlement: 0, outstanding: 0, notes: "התאמה לאירוע שהוסר או הועבר" });
  }
  return [...sources.values()].map((event) => {
    const allocations = settlements.filter((row) => row.venueId === event.venueId).flatMap((row) => row.allocations ?? []).filter((row) => row.eventId === event.id);
    const payment = money(event.venueSettlementBeforeHallFee - allocations.reduce((sum, row) => sum + row.payment, 0));
    const hallFee = money(event.venueHallFee - allocations.reduce((sum, row) => sum + row.hallFee, 0));
    return { ...event, venueSettlementBeforeHallFee: payment, venueHallFee: hallFee, venueSettlement: money(payment - hallFee) };
  });
}

export function calculateVenueClosing(events: ReceivableEvent[], settlements: VenueSettlement[], venueId: string, cutoffDate: string, includesHallFee = true) {
  const relevant = events.filter((event) => event.venueId === venueId && event.eventDate <= cutoffDate);
  const previous = settlements.filter((row) => row.venueId === venueId && row.cutoffDate <= cutoffDate);
  const open = applyVenueSettlements(relevant, previous);
  const rawAmount = money(relevant.reduce((sum, event) => sum + event.venueSettlement, 0));
  const previousAmount = money(previous.reduce((sum, row) => sum + row.amount, 0));
  const paymentBalance = money(open.reduce((sum, event) => sum + event.venueSettlementBeforeHallFee, 0));
  const hallFeeBalance = money(open.reduce((sum, event) => sum + event.venueHallFee, 0));
  const amount = includesHallFee ? money(rawAmount - previousAmount) : paymentBalance;
  const allocations = open.map((event) => ({ eventId: event.id, payment: event.venueSettlementBeforeHallFee, hallFee: includesHallFee ? event.venueHallFee : 0, event: relevant.find((row) => row.id === event.id) ?? { ...event, venueSettlementBeforeHallFee: 0, venueHallFee: 0, venueSettlement: 0 } }));
  return { cutoffDate, eventCount: relevant.length, rawAmount, previousAmount, amount, paymentBalance, hallFeeBalance, remainingHallFee: includesHallFee ? 0 : hallFeeBalance, remainingBalance: money(rawAmount - previousAmount - amount), includesHallFee, allocations };
}
