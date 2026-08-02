"use client";
import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Employee } from "@/features/employees";
import { useCreateEventAssignment, useUpdateEventAssignment } from "../hooks/use-event-staffing";
import type { AssignmentFormValues, EventAssignment } from "../types";
import { assignmentSchema } from "../validation";
import { timeInputValue } from "../calculations";

const inputClass = "mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-3 focus:ring-ring/20";
const emptyValues: AssignmentFormValues = { employeeId: "", eventRole: "bartender", payType: "hourly", hourlyRate: 50, fixedPay: null, workStart: "", workEnd: "", notes: "" };

export function AssignEmployeeDialog({ eventId, eventDate, assignment, employees, onClose, onSuccess, onError }: { eventId: string; eventDate: string; assignment?: EventAssignment; employees: Employee[]; onClose: () => void; onSuccess: (message: string) => void; onError: (message: string) => void }) {
  const [search, setSearch] = useState("");
  const create = useCreateEventAssignment(eventId, eventDate);
  const update = useUpdateEventAssignment(eventId, eventDate);
  const form = useForm<AssignmentFormValues>({ resolver: zodResolver(assignmentSchema), defaultValues: assignment ? valuesFrom(assignment) : emptyValues });
  const employeeId = form.watch("employeeId");
  const payType = form.watch("payType");
  const matches = useMemo(() => { const term = search.trim().toLocaleLowerCase("he-IL"); return employees.filter((employee) => !term || employee.fullName.toLocaleLowerCase("he-IL").includes(term) || employee.phone.includes(term)); }, [employees, search]);
  useEffect(() => { const employee = employees.find((item) => item.id === employeeId); if (employee && !assignment) form.setValue("hourlyRate", employee.defaultHourlyRate, { shouldValidate: true }); }, [assignment, employeeId, employees, form]);
  const numberValue = (value: unknown) => value === "" || value === undefined ? null : Number(value);
  const submit = async (values: AssignmentFormValues) => { try { const normalized = { ...values, hourlyRate: values.payType === "hourly" ? values.hourlyRate : null, fixedPay: values.payType === "fixed" ? values.fixedPay : null }; if (assignment) await update.mutateAsync({ id: assignment.id, values: normalized }); else await create.mutateAsync(normalized); onSuccess(assignment ? "השיבוץ עודכן בהצלחה." : "העובד נוסף לצוות האירוע."); onClose(); } catch { onError(assignment ? "לא ניתן לעדכן את השיבוץ. נסו שוב." : "לא ניתן להוסיף את העובד. ייתכן שהוא כבר משובץ באירוע."); } };
  const saving = create.isPending || update.isPending;

  return <div className="fixed inset-0 z-60 overflow-y-auto bg-slate-950/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="assignment-title"><form onSubmit={form.handleSubmit(submit)} className="mx-auto w-full max-w-lg rounded-xl bg-card p-6 shadow-xl"><div className="flex items-center justify-between"><h3 id="assignment-title" className="font-semibold">{assignment ? "עריכת שיבוץ" : "הוספת עובד לצוות"}</h3><Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="סגירה"><X /></Button></div><div className="mt-6 space-y-5">
    {!assignment && <Field label="חיפוש עובד"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש לפי שם או טלפון" className={inputClass} /></Field>}
    {assignment ? <Field label="עובד"><input type="hidden" {...form.register("employeeId")} /><div className={`${inputClass} flex items-center bg-muted text-muted-foreground`}>{assignment.employeeName}</div></Field> : <Field label="עובד" error={form.formState.errors.employeeId?.message}><select className={inputClass} {...form.register("employeeId")}><option value="">בחירת עובד</option>{matches.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}{employee.phone ? ` — ${employee.phone}` : ""}</option>)}</select>{!matches.length && <span className="mt-1 block text-xs text-muted-foreground">לא נמצאו עובדים פעילים.</span>}</Field>}
    <div className="grid gap-5 sm:grid-cols-2"><Field label="תפקיד באירוע"><select className={inputClass} {...form.register("eventRole")}><option value="bartender">ברמן</option><option value="manager">מנהל אירוע</option></select></Field><Field label="סוג שכר"><select className={inputClass} {...form.register("payType")}><option value="hourly">שעתי</option><option value="fixed">גלובלי</option></select></Field></div>
    {payType === "hourly" ? <Field label="שכר שעתי" error={form.formState.errors.hourlyRate?.message}><input type="number" min="0" step="0.01" className={inputClass} {...form.register("hourlyRate", { setValueAs: numberValue })} /></Field> : <Field label="שכר גלובלי" error={form.formState.errors.fixedPay?.message}><input type="number" min="0" step="0.01" className={inputClass} {...form.register("fixedPay", { setValueAs: numberValue })} /></Field>}
    <div className="grid gap-5 sm:grid-cols-2"><Field label="שעת כניסה" error={form.formState.errors.workStart?.message}><input type="time" className={inputClass} {...form.register("workStart")} /></Field><Field label="שעת יציאה" error={form.formState.errors.workEnd?.message}><input type="time" className={inputClass} {...form.register("workEnd")} /></Field></div>
    <Field label="הערות" error={form.formState.errors.notes?.message}><textarea className="mt-1.5 min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-3 focus:ring-ring/20" {...form.register("notes")} /></Field>
  </div><div className="mt-6 flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>ביטול</Button><Button type="submit" disabled={saving || (!assignment && !employees.length)}>{saving ? "שומר..." : assignment ? "שמירה" : "הוספה"}</Button></div></form></div>;
}
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block text-sm font-medium">{label}{children}{error && <span className="mt-1 block text-xs text-destructive">{error}</span>}</label>; }
function valuesFrom(assignment: EventAssignment): AssignmentFormValues { return { employeeId: assignment.employeeId, eventRole: assignment.eventRole, payType: assignment.payType, hourlyRate: assignment.hourlyRate, fixedPay: assignment.fixedPay, workStart: timeInputValue(assignment.workStart), workEnd: timeInputValue(assignment.workEnd), notes: assignment.notes }; }
