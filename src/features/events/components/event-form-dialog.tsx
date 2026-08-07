"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventStaffingSection } from "@/features/event-staffing";
import { EventPaymentsSection } from "@/features/event-payments";
import { calculateVat } from "@/lib/finance/calculations";
import { formatMoney, payerLabels, paymentStatusLabels, translateStoredValue } from "@/lib/hebrew";
import { useCreateEvent, useCreateOperationalEvent, useUpdateEvent, useUpdateOperationalEvent } from "../hooks";
import type { EventFormValues, EventRecord, VenueOption } from "../types";
import { PAYER_TYPES, PAYMENT_STATUSES } from "../types";
import { eventSchema } from "../validation";

type Props = { event: EventRecord | null; initialValues?: Partial<EventFormValues>; showFinancials?: boolean; venues: VenueOption[]; eventTypes: string[]; packages: string[]; onClose: () => void; onSuccess: (message: string) => void; onError: (message: string) => void };

const emptyValues: EventFormValues = { eventDate: "", startTime: "", venueId: "", clientName: "", clientPhone: "", guestCount: 0, eventType: "Wedding", packageType: "Pouring", pricePerGuest: 0, vatRate: 18, priceIncludesVat: true, payerType: "client", paymentStatus: "unpaid", estimatedAlcoholCost: 0, securityCheckReceived: false, invoiceIssued: false, managerEmployeeId: "", notes: "" };
const fieldClass = "mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20";
const labelClass = "block text-sm font-medium text-foreground";

export function EventFormDialog({ event, initialValues, showFinancials = true, venues, eventTypes, packages, onClose, onSuccess, onError }: Props) {
  const createMutation = useCreateEvent();
  const operationalCreateMutation = useCreateOperationalEvent();
  const updateMutation = useUpdateEvent();
  const operationalUpdateMutation = useUpdateOperationalEvent();
  const form = useForm<EventFormValues>({ resolver: zodResolver(eventSchema), defaultValues: event ?? { ...emptyValues, ...initialValues } });
  const { register, handleSubmit, reset, watch, formState: { errors } } = form;
  const revenue = (watch("guestCount") || 0) * (watch("pricePerGuest") || 0);
  const grossRevenue = calculateVat({ guestCount: watch("guestCount") || 0, pricePerGuest: watch("pricePerGuest") || 0, vatRate: watch("vatRate") || 0, priceIncludesVat: watch("priceIncludesVat") }).grossRevenue;
  const isSaving = createMutation.isPending || operationalCreateMutation.isPending || updateMutation.isPending || operationalUpdateMutation.isPending;

  useEffect(() => { reset(event ?? { ...emptyValues, ...initialValues }); }, [event, initialValues, reset]);

  const submit = async (values: EventFormValues) => {
    try {
      if (event) { if (showFinancials) await updateMutation.mutateAsync({ id: event.id, values }); else await operationalUpdateMutation.mutateAsync({ id: event.id, values }); } else if (showFinancials) await createMutation.mutateAsync(values); else await operationalCreateMutation.mutateAsync(values);
      onSuccess(event ? "האירוע עודכן בהצלחה." : "האירוע נוצר בהצלחה.");
      onClose();
    } catch { onError("לא ניתן לשמור את האירוע. נסו שוב."); }
  };
  const message = (name: keyof EventFormValues) => errors[name]?.message;

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title"><div className="mx-auto w-full max-w-3xl rounded-xl bg-card shadow-xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4"><div><h2 id="event-dialog-title" className="font-semibold text-foreground">{event ? "עריכת אירוע" : "אירוע חדש"}</h2><p className="mt-1 text-sm text-muted-foreground">הזינו את פרטי האירוע.</p></div><Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="סגירה"><X /></Button></div><form onSubmit={handleSubmit(submit)} className="space-y-8 p-5">
    <FormSection title="פרטי האירוע"><Field label="תאריך" error={message("eventDate")}><input type="date" className={fieldClass} {...register("eventDate")} /></Field><Field label="שעה" error={message("startTime")}><input type="time" className={fieldClass} {...register("startTime")} /></Field><Field label="אולם" error={message("venueId")}><select className={fieldClass} {...register("venueId")}><option value="">בחירת אולם</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></Field><Field label="שם איש קשר" error={message("clientName")}><input className={fieldClass} {...register("clientName")} /></Field><Field label="טלפון" error={message("clientPhone")}><input type="tel" className={fieldClass} {...register("clientPhone")} /></Field><Field label="מספר אורחים" error={message("guestCount")}><input type="number" min="1" className={fieldClass} {...register("guestCount", { valueAsNumber: true })} /></Field><Field label="סוג אירוע" error={message("eventType")}><select className={fieldClass} {...register("eventType")}><option value="">בחירת סוג אירוע</option>{eventTypes.map((type) => <option key={type} value={type}>{translateStoredValue(type)}</option>)}</select></Field><Field label="חבילת בר" error={message("packageType")}><select className={fieldClass} {...register("packageType")}><option value="">בחירת חבילת בר</option>{packages.map((type) => <option key={type} value={type}>{translateStoredValue(type)}</option>)}</select></Field></FormSection>
    {showFinancials && <FormSection title="כספים"><Field label="מחיר לאורח" error={message("pricePerGuest")}><input type="number" min="0" step="0.01" className={fieldClass} {...register("pricePerGuest", { valueAsNumber: true })} /></Field><Field label="הכנסה צפויה"><output className={`${fieldClass} flex items-center bg-muted text-muted-foreground`}>{formatMoney(revenue)}</output></Field><Field label="שיעור מע״מ" error={message("vatRate")}><input type="number" min="0" max="100" step="0.01" className={fieldClass} {...register("vatRate", { valueAsNumber: true })} /></Field><Check label="המחיר לאורח כולל מע״מ" {...register("priceIncludesVat")} /><Field label="מי משלם" error={message("payerType")}><select className={fieldClass} {...register("payerType")}>{PAYER_TYPES.map((type) => <option key={type} value={type}>{payerLabels[type]}</option>)}</select></Field><Field label="סטטוס תשלום" error={message("paymentStatus")}><select className={fieldClass} {...register("paymentStatus")}>{PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{paymentStatusLabels[status]}</option>)}</select></Field><Field label="עלות אלכוהול משוערת" error={message("estimatedAlcoholCost")}><input type="number" min="0" step="0.01" className={fieldClass} {...register("estimatedAlcoholCost", { valueAsNumber: true })} /></Field></FormSection>}
    <FormSection title="מסמכים"><Check label="התקבל צ׳ק ביטחון" {...register("securityCheckReceived")} /><Check label="הוצאה חשבונית" {...register("invoiceIssued")} /></FormSection>
    <FormSection title="צוות"><Field label="מזהה מנהל (אופציונלי)" error={message("managerEmployeeId")}><input placeholder="UUID של העובד" className={fieldClass} {...register("managerEmployeeId")} /></Field></FormSection>
    <FormSection title="הערות"><label className={labelClass}>הערות<textarea className="mt-1.5 min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" {...register("notes")} /></label>{message("notes") && <p className="mt-1 text-xs text-destructive">{message("notes")}</p>}</FormSection>
    <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>ביטול</Button><Button type="submit" disabled={isSaving}>{isSaving ? "שומר..." : event ? "שמירת שינויים" : "יצירת אירוע"}</Button></div>
  </form>{event && <div className="space-y-7 px-5 pb-6"><EventStaffingSection eventId={event.id} eventDate={watch("eventDate")} guestCount={watch("guestCount") || 0} pricePerGuest={watch("pricePerGuest") || 0} vatRate={watch("vatRate") || 0} priceIncludesVat={watch("priceIncludesVat")} estimatedAlcoholCost={watch("estimatedAlcoholCost") || 0} showFinancials={showFinancials} onSuccess={onSuccess} onError={onError} />{showFinancials && <EventPaymentsSection eventId={event.id} totalDue={grossRevenue} onSuccess={onSuccess} onError={onError} />}</div>}</div></div>;
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3><div className="grid gap-4 sm:grid-cols-2">{children}</div></section>; }
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className={labelClass}>{label}{children}{error && <span className="mt-1 block text-xs text-destructive">{error}</span>}</label>; }
function Check({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) { return <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" className="size-4 rounded border-input accent-primary" {...props} />{label}</label>; }
