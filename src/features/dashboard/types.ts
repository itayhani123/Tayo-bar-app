import type { EventRole, PayType } from "@/features/event-staffing/types";
import type { PaymentStatus } from "@/features/events/types";

export type DashboardAssignment = { id: string; eventId: string; employeeId: string; employeeName: string; eventRole: EventRole; payType: PayType; hourlyRate: number | null; fixedPay: number | null; workStart: string | null; workEnd: string | null };
export type DashboardEvent = { id: string; eventDate: string; startTime: string; venueName: string; eventType: string; clientName: string; guestCount: number; pricePerGuest: number; vatRate: number; priceIncludesVat: boolean; estimatedAlcoholCost: number; paymentStatus: PaymentStatus; paymentAmounts: number[]; securityCheckReceived: boolean; invoiceIssued: boolean; createdAt: string; updatedAt: string; assignments: DashboardAssignment[] };
export type DashboardData = { month: string; monthlyEvents: DashboardEvent[]; todayEvents: DashboardEvent[]; upcomingEvents: DashboardEvent[]; recentEvents: DashboardEvent[] };
export type Readiness = "ready" | "attention" | "staffing" | "financial";
export type DashboardWarning = { id: string; kind: "staffing" | "financial" | "info" | "times"; message: string; href: string };
