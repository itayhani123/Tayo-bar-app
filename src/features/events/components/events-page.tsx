"use client";

import { useState } from "react";
import { AlertCircle, CalendarDays, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEvents, useVenues } from "../hooks";
import { useMasterData } from "@/features/master-data";
import type { EventRecord } from "../types";
import { DeleteEventDialog } from "./delete-event-dialog";
import { EventFormDialog } from "./event-form-dialog";
import { EventsTable } from "./events-table";
import { EventsToast } from "./events-toast";

type Notice = { kind: "success" | "error"; message: string } | null;

export function EventsPage() {
  const events = useEvents();
  const venues = useVenues();
  const eventTypes = useMasterData("event_types");
  const packages = useMasterData("bar_packages");
  const [formEvent, setFormEvent] = useState<EventRecord | null | undefined>(undefined);
  const [deleteEvent, setDeleteEvent] = useState<EventRecord | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const closeForm = () => setFormEvent(undefined);
  const showSuccess = (message: string) => setNotice({ kind: "success", message });
  const showError = (message: string) => setNotice({ kind: "error", message });

  return <div className="mx-auto max-w-7xl space-y-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-muted-foreground">Operations</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Events</h2><p className="mt-2 text-sm text-muted-foreground">Plan, price, and track every Tayo Bar event.</p></div><Button type="button" className="sm:hidden" onClick={() => setFormEvent(null)}><Plus data-icon="inline-start" />New Event</Button></div>
    {notice && <EventsToast kind={notice.kind} message={notice.message} onDismiss={() => setNotice(null)} />}
    {events.isLoading || venues.isLoading || eventTypes.isLoading || packages.isLoading ? <LoadingState /> : events.isError || venues.isError || eventTypes.isError || packages.isError ? <ErrorState message="We could not load events. Check your Supabase connection and permissions, then try again." /> : !events.data?.length ? <EmptyState onNew={() => setFormEvent(null)} /> : <EventsTable events={events.data} onNew={() => setFormEvent(null)} onEdit={setFormEvent} onDelete={setDeleteEvent} />}
    {formEvent !== undefined && <EventFormDialog event={formEvent} venues={venues.data ?? []} eventTypes={(eventTypes.data ?? []).map((item) => item.name)} packages={(packages.data ?? []).map((item) => item.name)} onClose={closeForm} onSuccess={showSuccess} onError={showError} />}
    {deleteEvent && <DeleteEventDialog event={deleteEvent} onClose={() => setDeleteEvent(null)} onSuccess={showSuccess} onError={showError} />}
  </div>;
}

function LoadingState() { return <div className="grid min-h-80 place-items-center rounded-xl border border-border bg-card"><div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading events...</div></div>; }
function ErrorState({ message }: { message: string }) { return <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-destructive/40 bg-card p-8 text-center"><div><AlertCircle className="mx-auto size-6 text-destructive" /><p className="mt-3 font-medium text-foreground">Unable to load events</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p></div></div>; }
function EmptyState({ onNew }: { onNew: () => void }) { return <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border bg-card p-8 text-center"><div><CalendarDays className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 font-medium text-foreground">No events yet</p><p className="mt-1 text-sm text-muted-foreground">Create your first event to start managing bookings.</p><Button type="button" className="mt-5" onClick={onNew}><Plus data-icon="inline-start" />New Event</Button></div></div>; }
