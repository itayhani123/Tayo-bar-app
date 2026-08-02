import { getAssignmentSalary } from "@/features/event-staffing/calculations";
import type { EventAssignment } from "@/features/event-staffing/types";
import type { DashboardAssignment, DashboardEvent, DashboardWarning, Readiness } from "../types";

export const recommendedBartenders = (guests: number) => Math.ceil(Math.max(guests, 0) / 70) + 1;
export const assignmentSalary = (assignment: DashboardAssignment) => getAssignmentSalary({ ...assignment, employeePhone: "", notes: "", createdAt: "", updatedAt: "" } as EventAssignment);
export const eventStaffCost = (event: DashboardEvent) => event.assignments.reduce((sum, assignment) => sum + (assignmentSalary(assignment) ?? 0), 0);
export const eventRevenue = (event: DashboardEvent) => event.guestCount * event.pricePerGuest;

export function eventReadiness(event: DashboardEvent): Readiness {
  const bartenders = event.assignments.filter((assignment) => assignment.eventRole === "bartender").length;
  if (!event.assignments.length || bartenders < recommendedBartenders(event.guestCount)) return "staffing";
  if (!event.invoiceIssued || event.paymentStatus !== "paid") return "financial";
  if (!event.securityCheckReceived || !event.assignments.some((assignment) => assignment.eventRole === "manager")) return "attention";
  return "ready";
}

export function buildWarnings(events: DashboardEvent[], today: string): DashboardWarning[] {
  const warnings: DashboardWarning[] = [];
  events.forEach((event) => {
    const prefix = `${event.clientName} (${event.eventDate})`;
    const href = `/events?event=${event.id}`;
    const bartenders = event.assignments.filter((assignment) => assignment.eventRole === "bartender").length;
    if (!event.assignments.length) warnings.push({ id: `${event.id}-empty`, kind: "staffing", message: `${prefix}: אין עובדים משובצים`, href });
    else if (bartenders < recommendedBartenders(event.guestCount)) warnings.push({ id: `${event.id}-bartenders`, kind: "staffing", message: `${prefix}: חסרים ברמנים ביחס להמלצה`, href });
    if (!event.assignments.some((assignment) => assignment.eventRole === "manager")) warnings.push({ id: `${event.id}-manager`, kind: "info", message: `${prefix}: לא שובץ מנהל אירוע`, href });
    if (!event.securityCheckReceived) warnings.push({ id: `${event.id}-security`, kind: "financial", message: `${prefix}: לא התקבל צ׳ק ביטחון`, href });
    if (!event.invoiceIssued) warnings.push({ id: `${event.id}-invoice`, kind: "financial", message: `${prefix}: טרם הוצאה חשבונית`, href });
    if (event.paymentStatus !== "paid") warnings.push({ id: `${event.id}-payment`, kind: "financial", message: `${prefix}: האירוע לא שולם במלואו`, href });
    if (event.eventDate < today && event.assignments.some((assignment) => assignment.payType === "hourly" && (!assignment.workStart || !assignment.workEnd))) warnings.push({ id: `${event.id}-times`, kind: "times", message: `${prefix}: חסרות שעות עבודה`, href });
  });
  return warnings;
}
