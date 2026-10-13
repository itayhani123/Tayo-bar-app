import { getAssignmentSalary } from "@/features/event-staffing/calculations";
import { calculatePaymentSummary } from "@/features/event-payments";
import { calculateVat } from "@/lib/finance/calculations";
import type { EventAssignment } from "@/features/event-staffing/types";
import type { DashboardAssignment, DashboardEvent, DashboardWarning, Readiness } from "../types";

export const recommendedBartenders = (guests: number) => Math.ceil(Math.max(guests, 0) / 70) + 1;
export const assignmentSalary = (assignment: DashboardAssignment) => getAssignmentSalary({ ...assignment, employeePhone: "", notes: "", createdAt: "", updatedAt: "" } as EventAssignment);
export const eventStaffCost = (event: DashboardEvent) => event.assignments.reduce((sum, assignment) => sum + (assignmentSalary(assignment) ?? 0), 0);
export const eventRevenue = (event: DashboardEvent) => event.guestCount * event.pricePerGuest;
export type VenueProfitability = {
  venueName: string;
  eventCount: number;
  guestCount: number;
  netRevenue: number;
  grossRevenue: number;
  staffCost: number;
  alcoholCost: number;
  profit: number;
};

export function calculateVenueProfitability(
  events: DashboardEvent[],
): VenueProfitability[] {
  const venues = new Map<
    string,
    VenueProfitability
  >();

  for (const event of events) {
    const revenue = calculateVat(event);
    const staffCost = eventStaffCost(event);
    const alcoholCost =
      event.estimatedAlcoholCost ?? 0;

    const existing = venues.get(
      event.venueName,
    ) ?? {
      venueName: event.venueName,
      eventCount: 0,
      guestCount: 0,
      netRevenue: 0,
      grossRevenue: 0,
      staffCost: 0,
      alcoholCost: 0,
      profit: 0,
    };

    existing.eventCount += 1;
    existing.guestCount +=
      event.guestCount ?? 0;

    existing.netRevenue +=
      revenue.netRevenue;

    existing.grossRevenue +=
      revenue.grossRevenue;

    existing.staffCost += staffCost;
    existing.alcoholCost += alcoholCost;

    existing.profit +=
      revenue.netRevenue -
      staffCost -
      alcoholCost;

    venues.set(
      event.venueName,
      existing,
    );
  }

  return [...venues.values()].sort(
    (a, b) =>
      b.profit - a.profit ||
      a.venueName.localeCompare(
        b.venueName,
        "he",
      ),
  );
}
export const actualPaymentStatus = (event: DashboardEvent) => calculatePaymentSummary(calculateVat(event).grossRevenue, event.paymentAmounts.map((amount) => ({ amount }))).status;

export function eventReadiness(event: DashboardEvent): Readiness {
  const bartenders = event.assignments.filter((assignment) => assignment.eventRole === "bartender").length;
  if (!event.assignments.length || bartenders < recommendedBartenders(event.guestCount)) return "staffing";
  if (!event.invoiceIssued || actualPaymentStatus(event) !== "paid") return "financial";
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
    const payment = calculatePaymentSummary(calculateVat(event).grossRevenue, event.paymentAmounts.map((amount) => ({ amount })));
    if (event.eventDate >= today && payment.totalPaid === 0) warnings.push({ id: `${event.id}-payment-empty`, kind: "financial", message: `${prefix}: טרם התקבל תשלום`, href });
    else if (event.eventDate >= today && payment.status === "partial") warnings.push({ id: `${event.id}-payment-partial`, kind: "financial", message: `${prefix}: האירוע שולם חלקית`, href });
    if (event.eventDate < today && payment.remainingBalance > 0) warnings.push({ id: `${event.id}-payment-balance`, kind: "financial", message: `${prefix}: נותרה יתרה לתשלום`, href });
    if (payment.overpaid) warnings.push({ id: `${event.id}-payment-overpaid`, kind: "financial", message: `${prefix}: סכום התשלומים גבוה מסכום האירוע`, href });
    if (event.eventDate < today && event.assignments.some((assignment) => assignment.payType === "hourly" && (!assignment.workStart || !assignment.workEnd))) warnings.push({ id: `${event.id}-times`, kind: "times", message: `${prefix}: חסרות שעות עבודה`, href });
  });
  return warnings;
}
