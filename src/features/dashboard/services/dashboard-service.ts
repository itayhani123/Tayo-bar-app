import { createClient } from "@/lib/supabase/client";
import type { EventRole, PayType } from "@/features/event-staffing/types";
import type { PaymentStatus } from "@/features/events/types";
import { payrollMonthSchema } from "@/features/payroll/validation";
import type { DashboardAssignment, DashboardData, DashboardEvent } from "../types";
import { getDashboardActualDateRange, getIsraelDateOnly } from "../utils/dashboard-date-range";

type EventRow = { id: string; event_date: string; start_time: string; venue_id: string | null; event_type: string; client_name: string; guest_count: number; price_per_guest: number | string; vat_rate: number | string; price_includes_vat: boolean; estimated_alcohol_cost: number | string; payment_status: PaymentStatus; security_check_received: boolean; invoice_issued: boolean; created_at: string; updated_at: string };
type AssignmentRow = { id: string; event_id: string; employee_id: string; event_role: EventRole; pay_type: PayType; hourly_rate: number | string | null; fixed_pay: number | string | null; work_start: string | null; work_end: string | null };
type NameRow = { id: string; name: string };
type EmployeeRow = { id: string; full_name: string };
type PaymentRow = { event_id: string; amount: number | string };
const eventFields = "id, event_date, start_time, venue_id, event_type, client_name, guest_count, price_per_guest, vat_rate, price_includes_vat, estimated_alcohol_cost, payment_status, security_check_received, invoice_issued, created_at, updated_at";
const operationalEventFields = "id, event_date, start_time, venue_id, event_type, client_name, guest_count, security_check_received, created_at, updated_at";

export async function getDashboardData(month: string, includePayments = true): Promise<DashboardData> {
  const validMonth = payrollMonthSchema.parse(month);
  const today = getIsraelDateOnly();
  const actualRange = getDashboardActualDateRange(validMonth, today);
  const weekEndDate = new Date(); weekEndDate.setDate(weekEndDate.getDate() + 8);
  const weekEnd = getIsraelDateOnly(weekEndDate);
  const supabase = createClient();
  const selectedEventFields = includePayments ? eventFields : operationalEventFields;
  const [monthlyResult, operationalResult, recentResult, venuesResult, employeesResult] = await Promise.all([
    actualRange ? supabase.from("events").select(selectedEventFields).gte("event_date", actualRange.start).lte("event_date", actualRange.end).order("event_date") : Promise.resolve({ data: [], error: null }),
    supabase.from("events").select(selectedEventFields).gte("event_date", today).lt("event_date", weekEnd).order("event_date").order("start_time"),
    supabase.from("events").select(selectedEventFields).order("updated_at", { ascending: false }).limit(8),
    supabase.from("venues").select("id, name"),
    supabase.from("employees").select("id, full_name"),
  ]);
  for (const result of [monthlyResult, operationalResult, recentResult, venuesResult, employeesResult]) if (result.error) throw result.error;
  const rows = uniqueEvents([...(monthlyResult.data as unknown as EventRow[]), ...(operationalResult.data as unknown as EventRow[]), ...(recentResult.data as unknown as EventRow[])]);
  const eventIds = rows.map((event) => event.id);
  const [assignmentResult, paymentResult] = await Promise.all([
    eventIds.length ? supabase.from("event_assignments").select(includePayments ? "id, event_id, employee_id, event_role, pay_type, hourly_rate, fixed_pay, work_start, work_end" : "id, event_id, employee_id, event_role, work_start, work_end").in("event_id", eventIds) : Promise.resolve({ data: [], error: null }),
    includePayments && eventIds.length ? supabase.from("event_payments").select("event_id, amount").in("event_id", eventIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (assignmentResult.error) throw assignmentResult.error;
  if (paymentResult.error) throw paymentResult.error;
  const venueNames = new Map((venuesResult.data as NameRow[]).map((venue) => [venue.id, venue.name]));
  const employeeNames = new Map((employeesResult.data as EmployeeRow[]).map((employee) => [employee.id, employee.full_name]));
  const assignmentGroups = new Map<string, DashboardAssignment[]>();
  (assignmentResult.data as AssignmentRow[]).forEach((row) => assignmentGroups.set(row.event_id, [...(assignmentGroups.get(row.event_id) ?? []), { id: row.id, eventId: row.event_id, employeeId: row.employee_id, employeeName: employeeNames.get(row.employee_id) ?? "עובד לא ידוע", eventRole: row.event_role, payType: row.pay_type, hourlyRate: row.hourly_rate === null ? null : Number(row.hourly_rate), fixedPay: row.fixed_pay === null ? null : Number(row.fixed_pay), workStart: row.work_start, workEnd: row.work_end }]));
  const paymentGroups = new Map<string, number[]>();
  (paymentResult.data as PaymentRow[]).forEach((row) => paymentGroups.set(row.event_id, [...(paymentGroups.get(row.event_id) ?? []), Number(row.amount)]));
  const mapped = new Map(rows.map((row) => [row.id, toEvent(row, venueNames, assignmentGroups, paymentGroups)]));
  const mapRows = (data: EventRow[]) => data.map((row) => mapped.get(row.id)).filter((event): event is DashboardEvent => Boolean(event));
  const operational = mapRows(operationalResult.data as unknown as EventRow[]);
  return { month: validMonth, monthlyEvents: mapRows(monthlyResult.data as unknown as EventRow[]), todayEvents: operational.filter((event) => event.eventDate === today), upcomingEvents: operational.filter((event) => event.eventDate >= today && event.eventDate < weekEnd), recentEvents: mapRows(recentResult.data as unknown as EventRow[]) };
}

function toEvent(row: EventRow, venues: Map<string, string>, assignments: Map<string, DashboardAssignment[]>, payments: Map<string, number[]>): DashboardEvent { return { id: row.id, eventDate: row.event_date, startTime: row.start_time, venueName: row.venue_id ? venues.get(row.venue_id) ?? "אולם לא ידוע" : "ללא אולם", eventType: row.event_type, clientName: row.client_name, guestCount: row.guest_count, pricePerGuest: Number(row.price_per_guest), vatRate: Number(row.vat_rate), priceIncludesVat: row.price_includes_vat, estimatedAlcoholCost: Number(row.estimated_alcohol_cost), paymentStatus: row.payment_status, paymentAmounts: payments.get(row.id) ?? [], securityCheckReceived: row.security_check_received, invoiceIssued: row.invoice_issued, createdAt: row.created_at, updatedAt: row.updated_at, assignments: assignments.get(row.id) ?? [] }; }
function uniqueEvents(events: EventRow[]) { return [...new Map(events.map((event) => [event.id, event])).values()]; }
