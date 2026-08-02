import { createClient } from "@/lib/supabase/client";
import type { EventRole, PayType } from "@/features/event-staffing/types";
import { payrollMonthSchema } from "../validation";
import { buildMonthlyPayroll, monthBounds } from "../utils/payroll-calculations";
import type { MonthlyPayroll, PayrollAssignment } from "../types";

type EventRow = { id: string; event_date: string; venue_id: string | null; event_type: string };
type AssignmentRow = { id: string; event_id: string; employee_id: string; event_role: EventRole; pay_type: PayType; hourly_rate: number | string | null; fixed_pay: number | string | null; work_start: string | null; work_end: string | null };
type EmployeeRow = { id: string; full_name: string };
type VenueRow = { id: string; name: string };

export async function getMonthlyPayroll(month: string): Promise<MonthlyPayroll> {
  const validMonth = payrollMonthSchema.parse(month);
  const { start, end } = monthBounds(validMonth);
  const supabase = createClient();
  const { data: eventData, error: eventsError } = await supabase.from("events").select("id, event_date, venue_id, event_type").gte("event_date", start).lt("event_date", end).order("event_date");
  if (eventsError) throw eventsError;
  const events = eventData as EventRow[];
  if (!events.length) return buildMonthlyPayroll(validMonth, []);
  const [{ data: assignmentData, error: assignmentsError }, employeesResult, venuesResult] = await Promise.all([
    supabase.from("event_assignments").select("id, event_id, employee_id, event_role, pay_type, hourly_rate, fixed_pay, work_start, work_end").in("event_id", events.map((event) => event.id)),
    supabase.from("employees").select("id, full_name"),
    supabase.from("venues").select("id, name"),
  ]);
  if (assignmentsError) throw assignmentsError;
  if (employeesResult.error) throw employeesResult.error;
  if (venuesResult.error) throw venuesResult.error;
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const employeeMap = new Map((employeesResult.data as EmployeeRow[]).map((employee) => [employee.id, employee.full_name]));
  const venueMap = new Map((venuesResult.data as VenueRow[]).map((venue) => [venue.id, venue.name]));
  const assignments: Omit<PayrollAssignment, "salary" | "workedMinutes">[] = (assignmentData as AssignmentRow[]).map((row) => {
    const event = eventMap.get(row.event_id);
    if (!event) throw new Error("אירוע השיבוץ לא נמצא.");
    return { id: row.id, employeeId: row.employee_id, employeeName: employeeMap.get(row.employee_id) ?? "עובד לא ידוע", eventId: row.event_id, eventDate: event.event_date, venueName: event.venue_id ? venueMap.get(event.venue_id) ?? "אולם לא ידוע" : "ללא אולם", eventType: event.event_type, eventRole: row.event_role, payType: row.pay_type, hourlyRate: row.hourly_rate === null ? null : Number(row.hourly_rate), fixedPay: row.fixed_pay === null ? null : Number(row.fixed_pay), workStart: row.work_start, workEnd: row.work_end };
  });
  return buildMonthlyPayroll(validMonth, assignments);
}
