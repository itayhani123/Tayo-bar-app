"use client";
import { useMemo, useState } from "react";
import { AlertCircle, LoaderCircle, Pencil, Plus, Search, UserRoundCheck, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/hebrew";
import { useEmployees } from "../hooks/use-employees";
import type { Employee, EmployeeStatusFilter } from "../types";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { EmployeeStatusDialog } from "./employee-status-dialog";
import { EmployeesToast } from "./employees-toast";

type Notice = { kind: "success" | "error"; message: string } | null;
const filters: { value: EmployeeStatusFilter; label: string }[] = [{ value: "active", label: "פעילים" }, { value: "inactive", label: "לא פעילים" }, { value: "all", label: "הכול" }];

export function EmployeesPage() {
  const query = useEmployees();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EmployeeStatusFilter>("active");
  const [editing, setEditing] = useState<Employee | null | undefined>(undefined);
  const [statusEmployee, setStatusEmployee] = useState<Employee | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const employees = useMemo(() => (query.data ?? []).filter((employee) => {
    const matchesStatus = filter === "all" || (filter === "active" ? employee.active : !employee.active);
    const term = search.trim().toLocaleLowerCase("he-IL");
    return matchesStatus && (!term || employee.fullName.toLocaleLowerCase("he-IL").includes(term) || employee.phone.includes(term));
  }), [filter, query.data, search]);
  const success = (message: string) => setNotice({ kind: "success", message });
  const error = (message: string) => setNotice({ kind: "error", message });

  return <div className="mx-auto max-w-7xl space-y-6"><header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-muted-foreground">ניהול צוות</p><h2 className="mt-1 text-2xl font-semibold">עובדים</h2><p className="mt-2 text-sm text-muted-foreground">ניהול פרטי העובדים ושכר ברירת המחדל שלהם.</p></div><Button type="button" onClick={() => setEditing(null)}><Plus data-icon="inline-start" />עובד חדש</Button></header>
    {notice && <EmployeesToast kind={notice.kind} message={notice.message} onDismiss={() => setNotice(null)} />}
    {query.isLoading ? <Loading /> : query.isError ? <ErrorState /> : <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between"><div className="relative w-full md:max-w-sm"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש עובדים" aria-label="חיפוש עובדים" className="h-9 w-full rounded-lg border border-input bg-background pr-9 pl-3 text-sm outline-none focus:ring-3 focus:ring-ring/20" /></div><div className="flex rounded-lg bg-muted p-1" aria-label="סינון לפי סטטוס">{filters.map((item) => <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-md px-3 py-1.5 text-sm transition ${filter === item.value ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>{item.label}</button>)}</div></div>
      {employees.length ? <><DesktopTable employees={employees} onEdit={setEditing} onStatus={setStatusEmployee} /><MobileCards employees={employees} onEdit={setEditing} onStatus={setStatusEmployee} /></> : <Empty />}
    </section>}
    {editing !== undefined && <EmployeeFormDialog employee={editing} onClose={() => setEditing(undefined)} onSuccess={success} onError={error} />}
    {statusEmployee && <EmployeeStatusDialog employee={statusEmployee} onClose={() => setStatusEmployee(null)} onSuccess={success} onError={error} />}
  </div>;
}

function DesktopTable({ employees, onEdit, onStatus }: ListProps) { return <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-right text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><Th>שם מלא</Th><Th>טלפון</Th><Th>שכר שעתי ברירת מחדל</Th><Th>סטטוס</Th><Th><span className="sr-only">פעולות</span></Th></tr></thead><tbody className="divide-y divide-border">{employees.map((employee) => <tr key={employee.id} className="hover:bg-muted/30"><Td><span className="font-medium">{employee.fullName}</span></Td><Td>{employee.phone || "—"}</Td><Td>{formatMoney(employee.defaultHourlyRate)}</Td><Td><Status active={employee.active} /></Td><Td><Actions employee={employee} onEdit={onEdit} onStatus={onStatus} /></Td></tr>)}</tbody></table></div>; }
function MobileCards({ employees, onEdit, onStatus }: ListProps) { return <div className="divide-y divide-border md:hidden">{employees.map((employee) => <article key={employee.id} className="space-y-4 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{employee.fullName}</p><p className="mt-1 text-sm text-muted-foreground">{employee.phone || "ללא טלפון"}</p></div><Status active={employee.active} /></div><div><p className="text-xs text-muted-foreground">שכר שעתי ברירת מחדל</p><p className="mt-1 text-sm">{formatMoney(employee.defaultHourlyRate)}</p></div><Actions employee={employee} onEdit={onEdit} onStatus={onStatus} labels /></article>)}</div>; }
type ListProps = { employees: Employee[]; onEdit: (employee: Employee) => void; onStatus: (employee: Employee) => void };
function Actions({ employee, onEdit, onStatus, labels = false }: { employee: Employee; onEdit: (employee: Employee) => void; onStatus: (employee: Employee) => void; labels?: boolean }) { return <div className="flex justify-end gap-1"><Button type="button" size={labels ? "sm" : "icon-xs"} variant="ghost" onClick={() => onEdit(employee)} aria-label={`עריכת ${employee.fullName}`}><Pencil />{labels && "עריכה"}</Button><Button type="button" size={labels ? "sm" : "icon-xs"} variant="ghost" onClick={() => onStatus(employee)} aria-label={`${employee.active ? "השבתת" : "הפעלת"} ${employee.fullName}`}>{employee.active ? <UserRoundX className="text-destructive" /> : <UserRoundCheck className="text-emerald-600" />}{labels && (employee.active ? "השבתה" : "הפעלה")}</Button></div>; }
function Status({ active }: { active: boolean }) { return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{active ? "פעיל" : "לא פעיל"}</span>; }
function Th({ children }: { children: React.ReactNode }) { return <th className="whitespace-nowrap px-5 py-3.5 font-medium">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="whitespace-nowrap px-5 py-4">{children}</td>; }
function Loading() { return <div className="grid min-h-80 place-items-center rounded-xl border bg-card"><span className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />טוען עובדים...</span></div>; }
function ErrorState() { return <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-destructive/40 bg-card p-8 text-center"><div><AlertCircle className="mx-auto size-6 text-destructive" /><p className="mt-3 font-medium">לא ניתן לטעון עובדים</p><p className="mt-1 text-sm text-muted-foreground">בדקו את החיבור וההרשאות ונסו שוב.</p></div></div>; }
function Empty() { return <div className="grid min-h-64 place-items-center p-8 text-center"><div><UserRoundCheck className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 font-medium">לא נמצאו עובדים</p><p className="mt-1 text-sm text-muted-foreground">נסו לשנות את החיפוש או את מסנן הסטטוס.</p></div></div>; }
