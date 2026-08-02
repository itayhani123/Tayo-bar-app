"use client";
import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateEmployee, useUpdateEmployee } from "../hooks/use-employees";
import type { Employee, EmployeeFormValues } from "../types";
import { employeeSchema } from "../validation";

type Props = { employee: Employee | null; onClose: () => void; onSuccess: (message: string) => void; onError: (message: string) => void };
const emptyValues: EmployeeFormValues = { fullName: "", phone: "", defaultHourlyRate: 50, active: true, notes: "" };
const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20";

export function EmployeeFormDialog({ employee, onClose, onSuccess, onError }: Props) {
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const form = useForm<EmployeeFormValues>({ resolver: zodResolver(employeeSchema), defaultValues: employee ? valuesFrom(employee) : emptyValues });
  const saving = create.isPending || update.isPending;
  useEffect(() => { form.reset(employee ? valuesFrom(employee) : emptyValues); }, [employee, form]);

  const submit = async (values: EmployeeFormValues) => {
    try {
      if (employee) await update.mutateAsync({ id: employee.id, values }); else await create.mutateAsync(values);
      onSuccess(employee ? "העובד עודכן בהצלחה." : "העובד נוצר בהצלחה.");
      onClose();
    } catch { onError("לא ניתן לשמור את העובד. נסו שוב."); }
  };

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="employee-form-title"><form onSubmit={form.handleSubmit(submit)} className="mx-auto w-full max-w-xl rounded-xl bg-card p-6 shadow-xl"><div className="flex items-center justify-between"><div><h2 id="employee-form-title" className="font-semibold">{employee ? "עריכת עובד" : "עובד חדש"}</h2><p className="mt-1 text-sm text-muted-foreground">פרטי ההעסקה הקבועים של העובד.</p></div><Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="סגירה"><X /></Button></div><div className="mt-6 grid gap-5 sm:grid-cols-2">
    <Field label="שם מלא" error={form.formState.errors.fullName?.message}><input autoFocus className={inputClass} {...form.register("fullName")} /></Field>
    <Field label="טלפון" error={form.formState.errors.phone?.message}><input type="tel" className={inputClass} {...form.register("phone")} /></Field>
    <Field label="שכר שעתי ברירת מחדל" error={form.formState.errors.defaultHourlyRate?.message}><div className="relative"><input type="number" min="0" step="0.01" className={`${inputClass} pl-10`} {...form.register("defaultHourlyRate", { valueAsNumber: true })} /><span className="absolute bottom-2.5 left-3 text-sm text-muted-foreground">₪</span></div></Field>
    <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium"><input type="checkbox" className="size-4 accent-primary" {...form.register("active")} />פעיל</label>
    <Field label="הערות" error={form.formState.errors.notes?.message} wide><textarea className="mt-1.5 min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-3 focus:ring-ring/20" {...form.register("notes")} /></Field>
  </div><div className="mt-6 flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>ביטול</Button><Button type="submit" disabled={saving}>{saving ? "שומר..." : "שמירה"}</Button></div></form></div>;
}

function valuesFrom(employee: Employee): EmployeeFormValues { return { fullName: employee.fullName, phone: employee.phone, defaultHourlyRate: employee.defaultHourlyRate, active: employee.active, notes: employee.notes }; }
function Field({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: React.ReactNode }) { return <label className={`block text-sm font-medium ${wide ? "sm:col-span-2" : ""}`}>{label}{children}{error && <span className="mt-1 block text-xs text-destructive">{error}</span>}</label>; }
