import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedTool, toolSchema } from "./policy";
import { calculateReceivableEvent, type RawReceivableEvent } from "@/features/receivables/utils/receivables-calculations";
import { applyVenueSettlements, type VenueSettlement } from "@/features/receivables/utils/venue-settlements";
import { hydrateSettlementHistory } from "@/features/receivables/utils/settlement-history";
import { calculateVat, calculateOperationalProfit, roundMoney } from "@/lib/finance/calculations";
import { getAssignmentSalary } from "@/features/event-staffing/calculations";
import type { EventAssignment } from "@/features/event-staffing/types";
import { getIsraelDateOnly } from "@/features/dashboard/utils/dashboard-date-range";

type Assignment = Pick<EventAssignment, "payType" | "hourlyRate" | "fixedPay" | "workStart" | "workEnd"> & { eventId: string; eventRole: string; employee: { full_name: string } | null };
export type FinancialEvent = RawReceivableEvent & { startTime: string; estimatedAlcoholCost: number | null; venue: { name: string } | null };
type Closing = VenueSettlement & { source_snapshot?: { events?: RawReceivableEvent[] } };
const operationalFields = "id,eventDate:event_date,startTime:start_time,eventType:event_type,venueId:venue_id,guestCount:guest_count,packageType:package_type,venue:venues(name)";
const financialFields = operationalFields + ",payerType:payer_type,pricePerGuest:price_per_guest,vatRate:vat_rate,priceIncludesVat:price_includes_vat,estimatedAlcoholCost:estimated_alcohol_cost";
const assignmentFields = "eventId:event_id,eventRole:event_role,workStart:work_start,workEnd:work_end,employee:employees(full_name)";
const payFields = ",payType:pay_type,hourlyRate:hourly_rate,fixedPay:fixed_pay";

// A full sentinel page is rejected; partial data must never look like a complete financial total.
async function read<T>(query: PromiseLike<{ data: unknown; error: unknown; count: number | null }>): Promise<T[]> {
  const { data, error, count } = await query;
  if (error) throw new Error("DATA_UNAVAILABLE");
  if (!Array.isArray(data) || count === null || data.length >= 501 || count !== data.length) throw new Error("RANGE_TOO_LARGE");
  return data as T[];
}

export function summarizeFinancials(events: FinancialEvent[], assignments: Assignment[]) {
  const groups = new Map<string, { venue: string; events: number; netRevenue: number; grossRevenue: number; calculatedPayroll: number; estimatedAlcoholCost: number; hallFees: number; missingSalary: number; missingAlcoholCost: number; unstaffedEvents: number }>();
  for (const event of events) {
    const row = groups.get(event.venueId) ?? { venue: event.venueName, events: 0, netRevenue: 0, grossRevenue: 0, calculatedPayroll: 0, estimatedAlcoholCost: 0, hallFees: 0, missingSalary: 0, missingAlcoholCost: 0, unstaffedEvents: 0 };
    const finance = calculateVat(event);
    const salaries = assignments.filter(a => a.eventId === event.id).map(a => getAssignmentSalary({ ...a, eventRole: "bartender", id: "", employeeId: "", employeeName: "", employeePhone: "", notes: "", createdAt: "", updatedAt: "" }));
    row.events++;
    row.netRevenue += finance.netRevenue;
    row.grossRevenue += finance.grossRevenue;
    row.calculatedPayroll += salaries.reduce<number>((n, s) => n + (s ?? 0), 0);
    row.missingSalary += salaries.filter(s => s === null).length;
    row.unstaffedEvents += salaries.length ? 0 : 1;
    row.missingAlcoholCost += event.estimatedAlcoholCost == null ? 1 : 0;
    row.estimatedAlcoholCost += Number(event.estimatedAlcoholCost ?? 0);
    row.hallFees += calculateReceivableEvent(event).venueHallFee;
    groups.set(event.venueId, row);
  }
  return [...groups.values()].map(row => {
    const incomplete = row.missingSalary || row.missingAlcoholCost || row.unstaffedEvents;
    const profit = calculateOperationalProfit(row.netRevenue, row.calculatedPayroll, row.estimatedAlcoholCost);
    return { ...row, netRevenue: roundMoney(row.netRevenue), grossRevenue: roundMoney(row.grossRevenue), calculatedPayroll: roundMoney(row.calculatedPayroll), estimatedProfit: incomplete ? null : profit, estimatedProfitAfterHallFees: incomplete ? null : roundMoney(profit - row.hallFees) };
  });
}

export async function executeDataTool(db: SupabaseClient, role: string, name: string, rawArgs: unknown, signal: AbortSignal) {
  // Authorization happens before all reads, even for unadvertised function calls.
  if (!allowedTool(role, name)) throw new Error("FORBIDDEN_TOOL");
  const args = toolSchema.parse(rawArgs);
  const today = getIsraelDateOnly();
  const fields = name === "operations" ? operationalFields : financialFields + (name === "receivables" ? ",clientName:client_name" : "");
  let query = db.from("events").select(fields, { count: "exact" }).order("event_date").order("id").limit(501);
  if (args.venueId) query = query.eq("venue_id", args.venueId);
  // Open balances require all past events and closures, independent of the requested period.
  if (name === "receivables" || name === "venue_closings") query = query.lte("event_date", today);
  else query = query.gte("event_date", args.start).lte("event_date", name === "financial_summary" && args.end > today ? today : args.end);
  const events = (await read<FinancialEvent>(query.abortSignal(signal))).map(e => ({ ...e, venueName: e.venue?.name ?? "אולם לא ידוע", clientName: e.clientName ?? "", clientPhone: "", notes: "", payments: [] as RawReceivableEvent["payments"] }));
  if (name !== "operations" && events.some(e => [e.guestCount, e.pricePerGuest, e.vatRate].some(n => n == null || !Number.isFinite(Number(n))) || typeof e.priceIncludesVat !== "boolean")) throw new Error("INCOMPLETE_FINANCIAL_DATA");
  const ids = events.map(e => e.id);
  if(name==="financial_summary"&&ids.length){
    const movements=await read<{event_id:string;kind:string;cost:string|number}>(db.from("inventory_movements").select("event_id,kind,cost:total_cost_agorot",{count:"exact"}).in("event_id",ids).in("kind",["consumption","reversal"]).order("id").limit(501).abortSignal(signal));
    const actual=new Map<string,bigint>();for(const m of movements)actual.set(m.event_id,(actual.get(m.event_id)??BigInt(0))+(m.kind==="consumption"?BigInt(1):-BigInt(1))*BigInt(m.cost));
    for(const event of events)if(actual.has(event.id))event.estimatedAlcoholCost=Number(actual.get(event.id)!)/100;
  }
  if (name === "operations" || name === "financial_summary") {
    const assignments = ids.length ? await read<Assignment>(db.from("event_assignments").select(assignmentFields + (name === "financial_summary" ? payFields : ""), { count: "exact" }).in("event_id", ids).order("id").limit(501).abortSignal(signal)) : [];
    if (name === "operations") return { start: args.start, end: args.end, events: events.map(e => ({ id: e.id, date: e.eventDate, time: e.startTime, venue: e.venueName, type: e.eventType, guests: e.guestCount, alcoholPackage: e.packageType, assignments: assignments.filter(a => a.eventId === e.id).map(a => ({ name: a.employee?.full_name ?? "עובד לא ידוע", role: a.eventRole, start: a.workStart, end: a.workEnd })) })) };
    return { start: args.start, through: args.end < today ? args.end : today, venues: summarizeFinancials(events, assignments), definitions: "ILS. Revenue by event date, excluding future events. Payroll is calculated liability, NOT actual payments: paid flags exist only in browser localStorage. Profit is estimated net revenue minus calculated staffing and approved inventory alcohol consumption when tracked, otherwise legacy estimated alcohol; after-hall-fees profit additionally subtracts canonical hall fees. Excludes general expenses/tax. Missing salary, alcohol costs or assignments makes profit unknown. Empty results mean no recorded events, not verified zero business activity." };
  }
  const payments = ids.length ? await read<{ eventId: string; amount: number; paidAt: string; paymentMethod: string }>(db.from("event_payments").select("eventId:event_id,amount,paidAt:paid_at,paymentMethod:payment_method", { count: "exact" }).in("event_id", ids).order("id").limit(501).abortSignal(signal)) : [];
  for (const e of events) e.payments = payments.filter(p => p.eventId === e.id).map(p => ({ ...p, amount: Number(p.amount) }));
  let closingsQuery = db.from("venue_settlements").select("id,venueId:venue_id,cutoffDate:cutoff_date,amount,createdAt:created_at,includesHallFee:includes_hall_fee,allocations,source_snapshot", { count: "exact" }).order("created_at").order("id").limit(501);
  if (args.venueId) closingsQuery = closingsQuery.eq("venue_id", args.venueId);
  const closings = hydrateSettlementHistory((await read<Closing>(closingsQuery.abortSignal(signal))).map(c => ({ ...c, amount: Number(c.amount), sourceEvents: c.source_snapshot?.events })));
  if (closings.some(c => !c.allocations)) throw new Error("INCOMPLETE_SETTLEMENT_HISTORY");
  const calculated = events.map(calculateReceivableEvent);
  const open = applyVenueSettlements(calculated, closings);
  const venueIds = [...new Set([...open.map(e => e.venueId), ...closings.map(c => c.venueId)])];
  return { asOf: today, currency: "ILS", scope: "All recorded events through today and all closing allocations. Positive venue balance is owed to Tayo, negative is owed to venue. Customer balances are unaffected by venue closures.", venues: venueIds.map(id => {
    const rows = open.filter(e => e.venueId === id);
    return { venueId: id, venue: rows[0]?.venueName ?? "אולם לא ידוע", openVenueBalance: roundMoney(rows.reduce((n, e) => n + e.venueSettlement, 0)), openPaymentComponent: roundMoney(rows.reduce((n, e) => n + e.venueSettlementBeforeHallFee, 0)), openHallFeeComponent: roundMoney(rows.reduce((n, e) => n + e.venueHallFee, 0)) };
  }), customerReceivables: name === "receivables" ? calculated.filter(e => e.payerType === "client" && e.outstanding !== 0).map(e => ({ eventId: e.id, customer: e.clientName, date: e.eventDate, venue: e.venueName, outstanding: e.outstanding })) : undefined,
  closings: name === "venue_closings" ? closings.filter(c => c.cutoffDate >= args.start && c.cutoffDate <= args.end).map(c => ({ venueId: c.venueId, cutoff: c.cutoffDate, amount: c.amount, includesHallFee: c.includesHallFee, createdAt: c.createdAt })) : undefined };
}
