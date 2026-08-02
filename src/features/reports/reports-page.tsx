"use client";

import { useState } from "react";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { eventStaffCost } from "@/features/dashboard/utils/dashboard-calculations";
import { useIncomeTaxAdvanceRate } from "@/features/settings";
import { calculateIncomeTaxAdvance, calculateOperationalProfit, calculateVat } from "@/lib/finance/calculations";
import { formatMoney } from "@/lib/hebrew";

export function ReportsPage({ isManager }: { isManager: boolean }) {
  const [month, setMonth] = useState(currentMonth());
  const query = useDashboard(month);
  const taxRate = useIncomeTaxAdvanceRate(!isManager);
  if (isManager) return <div><h2 className="text-2xl font-semibold">דוחות</h2><p className="mt-3 text-sm text-muted-foreground">המידע הפיננסי זמין לבעלים בלבד.</p></div>;
  if (query.isLoading) return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  if (query.isError || !query.data) return <div className="rounded-xl border border-destructive/40 p-6">לא ניתן לטעון את הדוח.</div>;
  const revenues = query.data.monthlyEvents.map(calculateVat);
  const net = revenues.reduce((sum, item) => sum + item.netRevenue, 0);
  const vat = revenues.reduce((sum, item) => sum + item.vatAmount, 0);
  const gross = revenues.reduce((sum, item) => sum + item.grossRevenue, 0);
  const staff = query.data.monthlyEvents.reduce((sum, event) => sum + eventStaffCost(event), 0);
  const alcohol = query.data.monthlyEvents.reduce((sum, event) => sum + event.estimatedAlcoholCost, 0);
  const profit = calculateOperationalProfit(net, staff, alcohol);
  const advance = calculateIncomeTaxAdvance(net, taxRate.data ?? 3.2);
  return <div className="space-y-6"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-semibold">דוחות</h2><p className="mt-2 text-sm text-muted-foreground">סיכום פיננסי חודשי ללא שמירת סכומים מחושבים.</p></div><label className="text-sm">חודש<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="mr-2 h-9 rounded-lg border border-input bg-background px-3" /></label></header><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["הכנסות לפני מע״מ", net], ["מע״מ עסקאות", vat], ["הכנסות כולל מע״מ", gross], ["מקדמות מס הכנסה משוערות", advance], ["עלות עובדים", staff], ["עלות אלכוהול", alcohol], ["רווח תפעולי לפני מס", profit], ["יתרה משוערת לאחר מקדמות", profit - advance]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-semibold">{formatMoney(Number(value))}</p></div>)}</div><p className="text-xs text-muted-foreground">החישוב הוא הערכה ניהולית ואינו תחליף לחישוב רואה חשבון.</p></div>;
}

function currentMonth() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
