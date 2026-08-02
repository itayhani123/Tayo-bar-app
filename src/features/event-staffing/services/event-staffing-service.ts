import { createClient } from "@/lib/supabase/client";
import type { AssignmentFormValues, EventAssignment, EventRole, PayType } from "../types";

type AssignmentRow = { id: string; event_id: string; employee_id: string; event_role: EventRole; pay_type: PayType; hourly_rate: number | string | null; fixed_pay: number | string | null; work_start: string | null; work_end: string | null; notes: string | null; created_at: string; updated_at: string };
type EmployeeRow = { id: string; full_name: string; phone: string | null };

export async function listEventAssignments(eventId: string): Promise<EventAssignment[]> {
  const supabase = createClient();
  const [{ data, error }, employeesResult] = await Promise.all([
    supabase.from("event_assignments").select("*").eq("event_id", eventId).order("created_at"),
    supabase.from("employees").select("id, full_name, phone"),
  ]);
  if (error) throw error;
  if (employeesResult.error) throw employeesResult.error;
  const employees = new Map((employeesResult.data as EmployeeRow[]).map((employee) => [employee.id, employee]));
  return (data as AssignmentRow[]).map((row) => {
    const employee = employees.get(row.employee_id);
    return { id: row.id, eventId: row.event_id, employeeId: row.employee_id, employeeName: employee?.full_name ?? "עובד לא ידוע", employeePhone: employee?.phone ?? "", eventRole: row.event_role, payType: row.pay_type, hourlyRate: row.hourly_rate === null ? null : Number(row.hourly_rate), fixedPay: row.fixed_pay === null ? null : Number(row.fixed_pay), workStart: row.work_start, workEnd: row.work_end, notes: row.notes ?? "", createdAt: row.created_at, updatedAt: row.updated_at };
  });
}

export async function createEventAssignment(eventId: string, eventDate: string, values: AssignmentFormValues): Promise<void> {
  const supabase = createClient();
  const { data: existing, error: lookupError } = await supabase.from("event_assignments").select("id").eq("event_id", eventId).eq("employee_id", values.employeeId).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) throw new Error("employee_already_assigned");
  const times = assignmentTimes(eventDate, values.workStart, values.workEnd);
  const payload = { event_id: eventId, employee_id: values.employeeId, event_role: values.eventRole, role: values.eventRole, is_manager: values.eventRole === "manager", pay_type: values.payType, hourly_rate: values.payType === "hourly" ? values.hourlyRate : null, fixed_pay: values.payType === "fixed" ? values.fixedPay : null, work_start: times.workStart, work_end: times.workEnd, notes: values.notes.trim() || null };
  const { error } = await supabase.from("event_assignments").insert(payload);
  if (error) throw error;
}

export async function updateEventAssignment(id: string, eventDate: string, values: AssignmentFormValues): Promise<void> {
  const times = assignmentTimes(eventDate, values.workStart, values.workEnd);
  const payload = { event_role: values.eventRole, role: values.eventRole, is_manager: values.eventRole === "manager", pay_type: values.payType, hourly_rate: values.payType === "hourly" ? values.hourlyRate : null, fixed_pay: values.payType === "fixed" ? values.fixedPay : null, work_start: times.workStart, work_end: times.workEnd, notes: values.notes.trim() || null };
  const { error } = await createClient().from("event_assignments").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteEventAssignment(id: string): Promise<void> {
  const { error } = await createClient().from("event_assignments").delete().eq("id", id);
  if (error) throw error;
}

function assignmentTimes(eventDate: string, startValue: string, endValue: string) {
  const start = startValue ? new Date(`${eventDate}T${startValue}:00`) : null;
  const end = endValue ? new Date(`${eventDate}T${endValue}:00`) : null;
  if (start && end && end <= start) end.setDate(end.getDate() + 1);
  return { workStart: start?.toISOString() ?? null, workEnd: end?.toISOString() ?? null };
}
