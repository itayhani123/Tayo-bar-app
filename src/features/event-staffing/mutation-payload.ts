import type { AssignmentFormValues } from "./types";
import { eventInstant } from "@/lib/whatsapp/scheduling";

export function buildAssignmentPayload(eventDate: string, values: AssignmentFormValues) {
  const start = values.workStart ? eventInstant(eventDate, values.workStart) : null;
  let end = values.workEnd ? eventInstant(eventDate, values.workEnd) : null;
  if (start && end && end <= start) {
    const nextDay = new Date(`${eventDate}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    end = eventInstant(nextDay.toISOString().slice(0, 10), values.workEnd);
  }
  return {
    employee_id: values.employeeId, event_role: values.eventRole, role: values.eventRole, is_manager: values.eventRole === "manager",
    pay_type: values.payType, hourly_rate: values.payType === "hourly" ? values.hourlyRate : null, fixed_pay: values.payType === "fixed" ? values.fixedPay : null,
    work_start: start?.toISOString() ?? null, work_end: end?.toISOString() ?? null, notes: values.notes.trim() || null,
  };
}
