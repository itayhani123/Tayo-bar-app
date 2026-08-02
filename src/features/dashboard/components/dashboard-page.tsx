"use client";
import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePayrollPaymentStatus } from "@/features/payroll/hooks/use-payroll-payment-status";
import { useIncomeTaxAdvanceRate } from "@/features/settings";
import { calculateIncomeTaxAdvance, calculateOperationalProfit, calculateVat } from "@/lib/finance/calculations";
import { formatDate, formatMoney, paymentStatusLabels, translateStoredValue } from "@/lib/hebrew";
import { useDashboard } from "../hooks/use-dashboard";
import type { DashboardEvent, DashboardWarning, Readiness } from "../types";
import { assignmentSalary, buildWarnings, eventReadiness, eventStaffCost, recommendedBartenders } from "../utils/dashboard-calculations";

export type DashboardAccess = "owner" | "manager";
const readinessLabels: Record<Readiness, string> = { ready: "מוכן", attention: "דורש טיפול", staffing: "חסר צוות", financial: "חסר מידע כספי" };
const readinessClasses: Record<Readiness, string> = { ready: "bg-emerald-50 text-emerald-700", attention: "bg-amber-50 text-amber-700", staffing: "bg-red-50 text-red-700", financial: "bg-orange-50 text-orange-700" };

export function DashboardPage({ access }: { access: DashboardAccess }) {
  const [month, setMonth] = useState(currentMonth());
  const query = useDashboard(month);
  const incomeTaxRate = useIncomeTaxAdvanceRate(access === "owner");
  const { paidIds } = usePayrollPaymentStatus(month);
  if (query.isLoading) return <DashboardSkeleton />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;
  const data = query.data;
  const revenues = data.monthlyEvents.map((event) => calculateVat(event));
  const netRevenue = revenues.reduce((sum, revenue) => sum + revenue.netRevenue, 0);
  const vatAmount = revenues.reduce((sum, revenue) => sum + revenue.vatAmount, 0);
  const grossRevenue = revenues.reduce((sum, revenue) => sum + revenue.grossRevenue, 0);
  const staffCost = data.monthlyEvents.reduce((sum, event) => sum + eventStaffCost(event), 0);
  const alcoholCost = data.monthlyEvents.reduce((sum, event) => sum + event.estimatedAlcoholCost, 0);
  const operationalProfit = calculateOperationalProfit(netRevenue, staffCost, alcoholCost);
  const taxAdvances = calculateIncomeTaxAdvance(netRevenue, incomeTaxRate.data ?? 3.2);
  const estimatedAfterAdvances = operationalProfit - taxAdvances;
  const employeeTotals = new Map<string, number>();
  const employeeNames = new Map<string, string>();
  data.monthlyEvents.flatMap((event) => event.assignments).forEach((assignment) => { employeeTotals.set(assignment.employeeId, (employeeTotals.get(assignment.employeeId) ?? 0) + (assignmentSalary(assignment) ?? 0)); employeeNames.set(assignment.employeeId, assignment.employeeName); });
  let warnings = buildWarnings([...new Map([...data.upcomingEvents, ...data.monthlyEvents.filter((event) => event.eventDate < today())].map((event) => [event.id, event])).values()], today());
  if (access === "owner" && new Date() > paymentDeadline(month)) [...employeeTotals.entries()].filter(([id, amount]) => amount > 0 && !paidIds.has(id)).forEach(([id]) => warnings.push({ id: `payroll-${id}`, kind: "financial", message: `${employeeNames.get(id) ?? "עובד"}: המשכורת טרם שולמה לאחר תאריך התשלום האחרון`, href: `/payroll` }));
  if (access === "manager") warnings = warnings.filter((warning) => warning.kind === "staffing" || warning.kind === "info");

  return <div className="mx-auto max-w-7xl space-y-6"><header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-medium text-muted-foreground">תפעול</p><h2 className="mt-1 text-2xl font-semibold">מרכז בקרה</h2><p className="mt-2 text-sm text-muted-foreground">תמונת מצב חודשית ופעילות קרובה.</p></div><MonthPicker month={month} onChange={setMonth} /></header>
    {access === "owner" && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="הכנסות לפני מע״מ" value={formatMoney(netRevenue)} /><Kpi label="מע״מ עסקאות" value={formatMoney(vatAmount)} /><Kpi label="הכנסות כולל מע״מ" value={formatMoney(grossRevenue)} /><Kpi label="מקדמות מס הכנסה משוערות" value={formatMoney(taxAdvances)} /><Kpi label="עלות עובדים" value={formatMoney(staffCost)} /><Kpi label="עלות אלכוהול" value={formatMoney(alcoholCost)} /><Kpi label="רווח תפעולי לפני מס" value={formatMoney(operationalProfit)} /><Kpi label="יתרה משוערת לאחר מקדמות" value={formatMoney(estimatedAfterAdvances)} /></div><MonthlyBreakdown revenue={netRevenue} staff={staffCost} alcohol={alcoholCost} profit={operationalProfit} /></>}
    <section><h3 className="mb-3 text-lg font-semibold">היום</h3>{data.todayEvents.length ? <div className="grid gap-3 lg:grid-cols-2">{data.todayEvents.map((event) => <TodayEvent key={event.id} event={event} />)}</div> : <Empty text="אין אירועים היום" />}</section>
    <div className="grid gap-6 xl:grid-cols-2"><section><h3 className="mb-3 text-lg font-semibold">השבוע הקרוב</h3>{data.upcomingEvents.length ? <div className="space-y-3">{data.upcomingEvents.map((event) => <UpcomingEvent key={event.id} event={event} />)}</div> : <Empty text="אין אירועים בשבוע הקרוב" />}</section><Warnings warnings={warnings} /></div>
    {access === "owner" && <RecentEvents events={data.recentEvents} />}
  </div>;
}

function TodayEvent({ event }: { event: DashboardEvent }) { return <Link href={`/events?event=${event.id}`} className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/30"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{event.startTime.slice(0, 5)} · {event.venueName}</p><p className="mt-1 text-sm text-muted-foreground">{translateStoredValue(event.eventType)} · {event.clientName}</p></div><ReadinessBadge event={event} /></div><div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><Small label="אורחים" value={String(event.guestCount)} /><Small label="עובדים משובצים" value={String(event.assignments.length)} /><Small label="ברמנים מומלצים" value={String(recommendedBartenders(event.guestCount))} /><Small label="סטטוס תשלום" value={paymentStatusLabels[event.paymentStatus]} /></div></Link>; }
function UpcomingEvent({ event }: { event: DashboardEvent }) { return <Link href={`/events?event=${event.id}`} className="block rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/30"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{formatDate(event.eventDate)} · {event.startTime.slice(0, 5)}</p><p className="mt-1 text-sm text-muted-foreground">{event.venueName} · {event.guestCount} אורחים</p></div><ReadinessBadge event={event} /></div><p className="mt-3 text-xs text-muted-foreground">עובדים משובצים: {event.assignments.length} · ברמנים מומלצים: {recommendedBartenders(event.guestCount)}</p></Link>; }
function Warnings({ warnings }: { warnings: DashboardWarning[] }) { return <section><h3 className="mb-3 text-lg font-semibold">דורש טיפול</h3>{warnings.length ? <div className="space-y-2">{warnings.slice(0, 14).map((warning) => <Link key={warning.id} href={warning.href} className={`block rounded-lg border p-3 text-sm ${warning.kind === "staffing" ? "border-red-200 bg-red-50 text-red-800" : warning.kind === "info" ? "border-blue-200 bg-blue-50 text-blue-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{warning.message}</Link>)}</div> : <Empty text="אין משימות פתוחות" />}</section>; }
function RecentEvents({ events }: { events: DashboardEvent[] }) { return <section><h3 className="mb-3 text-lg font-semibold">אירועים אחרונים</h3><div className="overflow-hidden rounded-xl border border-border bg-card">{events.map((event) => { const created = Math.abs(new Date(event.updatedAt).getTime() - new Date(event.createdAt).getTime()) < 60000; return <Link key={event.id} href={`/events?event=${event.id}`} className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm font-medium">{event.clientName} · {event.venueName}</span><span className="text-xs text-muted-foreground">{created ? "אירוע נוצר" : "אירוע עודכן"} · {new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.updatedAt))}</span></Link>; })}</div></section>; }
function MonthlyBreakdown({ revenue, staff, alcohol, profit }: { revenue: number; staff: number; alcohol: number; profit: number }) { const max = Math.max(revenue, staff, alcohol, Math.abs(profit), 1); return <section className="rounded-xl border border-border bg-card p-5 shadow-sm"><h3 className="font-semibold">פירוט חודשי</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">{[["הכנסה צפויה", revenue, "bg-indigo-500"], ["עלות עובדים", staff, "bg-amber-500"], ["עלות אלכוהול", alcohol, "bg-orange-500"], ["רווח צפוי", profit, profit >= 0 ? "bg-emerald-500" : "bg-red-500"]].map(([label, value, color]) => <div key={String(label)}><div className="flex justify-between text-sm"><span>{label}</span><span>{formatMoney(Number(value))}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.abs(Number(value)) / max * 100)}%` }} /></div></div>)}</div></section>; }
function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) { return <div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" onClick={() => onChange(moveMonth(month, -1))} aria-label="החודש הקודם"><ChevronRight /></Button><label className="text-sm">חודש<input type="month" value={month} onChange={(event) => onChange(event.target.value)} className="mr-2 h-9 rounded-lg border border-input bg-background px-3" /></label><Button type="button" variant="outline" size="icon" onClick={() => onChange(moveMonth(month, 1))} aria-label="החודש הבא"><ChevronLeft /></Button></div>; }
function ReadinessBadge({ event }: { event: DashboardEvent }) { const readiness = eventReadiness(event); return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${readinessClasses[readiness]}`}>{readinessLabels[readiness]}</span>; }
function Kpi({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p></div>; }
function Small({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1">{value}</p></div>; }
function Empty({ text }: { text: string }) { return <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">{text}</div>; }
function DashboardSkeleton() { return <div className="mx-auto max-w-7xl space-y-6"><div className="h-20 animate-pulse rounded-xl bg-muted" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div><div className="grid gap-6 lg:grid-cols-2"><div className="h-72 animate-pulse rounded-xl bg-muted" /><div className="h-72 animate-pulse rounded-xl bg-muted" /></div></div>; }
function ErrorState({ onRetry }: { onRetry: () => void }) { return <div className="grid min-h-96 place-items-center rounded-xl border border-dashed border-destructive/40 bg-card p-8 text-center"><div><AlertCircle className="mx-auto size-7 text-destructive" /><p className="mt-3 font-medium">לא ניתן לטעון את מרכז הבקרה</p><Button type="button" className="mt-4" onClick={onRetry}><LoaderCircle />נסה שוב</Button></div></div>; }
function currentMonth() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function moveMonth(month: string, delta: number) { const [year, number] = month.split("-").map(Number); const date = new Date(year, number - 1 + delta, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function paymentDeadline(month: string) { const [year, number] = month.split("-").map(Number); return new Date(year, number, 10); }
