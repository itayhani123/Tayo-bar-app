"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateEvent, useUpdateEvent } from "../hooks";
import type { EventFormValues, EventRecord, VenueOption } from "../types";
import { PAYER_TYPES, PAYMENT_STATUSES } from "../types";
import { eventSchema } from "../validation";

type Props = { event: EventRecord | null; venues: VenueOption[]; eventTypes: string[]; packages: string[]; onClose: () => void; onSuccess: (message: string) => void; onError: (message: string) => void };

const emptyValues: EventFormValues = { eventDate: "", startTime: "", venueId: "", clientName: "", clientPhone: "", guestCount: 0, eventType: "Wedding", packageType: "Pouring", pricePerGuest: 0, payerType: "client", paymentStatus: "unpaid", estimatedAlcoholCost: 0, securityCheckReceived: false, invoiceIssued: false, managerEmployeeId: "", notes: "" };
const fieldClass = "mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20";
const labelClass = "block text-sm font-medium text-foreground";

export function EventFormDialog({ event, venues, eventTypes, packages, onClose, onSuccess, onError }: Props) {
  const createMutation = useCreateEvent();
  const updateMutation = useUpdateEvent();
  const form = useForm<EventFormValues>({ resolver: zodResolver(eventSchema), defaultValues: event ?? emptyValues });
  const { register, handleSubmit, reset, watch, formState: { errors } } = form;
  const revenue = (watch("guestCount") || 0) * (watch("pricePerGuest") || 0);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  useEffect(() => { reset(event ?? emptyValues); }, [event, reset]);

  const submit = async (values: EventFormValues) => {
    try {
      if (event) await updateMutation.mutateAsync({ id: event.id, values }); else await createMutation.mutateAsync(values);
      onSuccess(event ? "Event updated successfully." : "Event created successfully.");
      onClose();
    } catch (error) { onError(error instanceof Error ? error.message : "Unable to save the event."); }
  };
  const message = (name: keyof EventFormValues) => errors[name]?.message;

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title"><div className="mx-auto w-full max-w-3xl rounded-xl bg-card shadow-xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4"><div><h2 id="event-dialog-title" className="font-semibold text-foreground">{event ? "Edit Event" : "New Event"}</h2><p className="mt-1 text-sm text-muted-foreground">Enter the event details below.</p></div><Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X /></Button></div><form onSubmit={handleSubmit(submit)} className="space-y-8 p-5">
    <FormSection title="General"><Field label="Date" error={message("eventDate")}><input type="date" className={fieldClass} {...register("eventDate")} /></Field><Field label="Time" error={message("startTime")}><input type="time" className={fieldClass} {...register("startTime")} /></Field><Field label="Venue" error={message("venueId")}><select className={fieldClass} {...register("venueId")}><option value="">Select a venue</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></Field><Field label="Client Name" error={message("clientName")}><input className={fieldClass} {...register("clientName")} /></Field><Field label="Phone" error={message("clientPhone")}><input type="tel" className={fieldClass} {...register("clientPhone")} /></Field><Field label="Guests" error={message("guestCount")}><input type="number" min="1" className={fieldClass} {...register("guestCount", { valueAsNumber: true })} /></Field><Field label="Event Type" error={message("eventType")}><select className={fieldClass} {...register("eventType")}><option value="">Select an event type</option>{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field><Field label="Package" error={message("packageType")}><select className={fieldClass} {...register("packageType")}><option value="">Select a package</option>{packages.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field></FormSection>
    <FormSection title="Financial"><Field label="Price per guest" error={message("pricePerGuest")}><input type="number" min="0" step="0.01" className={fieldClass} {...register("pricePerGuest", { valueAsNumber: true })} /></Field><Field label="Revenue"><output className={`${fieldClass} flex items-center bg-muted text-muted-foreground`}>{new Intl.NumberFormat("en-US", { style: "currency", currency: "ILS" }).format(revenue)}</output></Field><Field label="Payer" error={message("payerType")}><select className={fieldClass} {...register("payerType")}>{PAYER_TYPES.map((type) => <option key={type} value={type}>{type === "client" ? "Client" : "Venue"}</option>)}</select></Field><Field label="Payment Status" error={message("paymentStatus")}><select className={fieldClass} {...register("paymentStatus")}>{PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></Field><Field label="Estimated Alcohol Cost" error={message("estimatedAlcoholCost")}><input type="number" min="0" step="0.01" className={fieldClass} {...register("estimatedAlcoholCost", { valueAsNumber: true })} /></Field></FormSection>
    <FormSection title="Documents"><Check label="Security check received" {...register("securityCheckReceived")} /><Check label="Invoice issued" {...register("invoiceIssued")} /></FormSection>
    <FormSection title="Staff"><Field label="Manager ID (optional)" error={message("managerEmployeeId")}><input placeholder="Employee UUID" className={fieldClass} {...register("managerEmployeeId")} /></Field></FormSection>
    <FormSection title="Notes"><label className={labelClass}>Notes<textarea className="mt-1.5 min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" {...register("notes")} /></label>{message("notes") && <p className="mt-1 text-xs text-destructive">{message("notes")}</p>}</FormSection>
    <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : event ? "Save Changes" : "Create Event"}</Button></div>
  </form></div></div>;
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3><div className="grid gap-4 sm:grid-cols-2">{children}</div></section>; }
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className={labelClass}>{label}{children}{error && <span className="mt-1 block text-xs text-destructive">{error}</span>}</label>; }
function Check({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) { return <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" className="size-4 rounded border-input accent-primary" {...props} />{label}</label>; }
