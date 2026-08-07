"use client";

import { useState } from "react";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CalendarDays, FileSpreadsheet, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMasterData } from "@/features/master-data";
import { EventImportDialog } from "@/features/event-import";
import { useEvents, useVenues } from "../hooks";
import type { EventRecord } from "../types";
import { DeleteEventDialog } from "./delete-event-dialog";
import { EventFormDialog } from "./event-form-dialog";
import { EventsTable } from "./events-table";
import { EventsToast } from "./events-toast";

type Notice = { kind: "success" | "error"; message: string } | null;

export function EventsPage({ showFinancials = true }: { showFinancials?: boolean }) {
  const searchParams = useSearchParams();
  const events = useEvents(showFinancials);
  const venues = useVenues();
  const eventTypes = useMasterData("event_types");
  const packages = useMasterData("bar_packages");
  const [formEvent, setFormEvent] = useState<EventRecord | null | undefined>(undefined);
  const [deleteEvent, setDeleteEvent] = useState<EventRecord | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => { const eventId = searchParams.get("event"); const selected = events.data?.find((event) => event.id === eventId); if (selected) setFormEvent(selected); }, [events.data, searchParams]);
  const showSuccess = (message: string) => setNotice({ kind: "success", message });
  const showError = (message: string) => setNotice({ kind: "error", message });

  return <div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-muted-foreground">תפעול</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">אירועים</h2><p className="mt-2 text-sm text-muted-foreground">תכנון, תמחור ומעקב אחר כל אירועי Tayo Bar.</p></div><div className="flex gap-2">{showFinancials && <Button type="button" variant="outline" onClick={() => setShowImport(true)}><FileSpreadsheet />ייבוא חוברת עבודה</Button>}<Button type="button" className="sm:hidden" onClick={() => setFormEvent(null)}><Plus data-icon="inline-start" />אירוע חדש</Button></div></div>
    {notice && <EventsToast kind={notice.kind} message={notice.message} onDismiss={() => setNotice(null)} />}
    {events.isLoading || venues.isLoading || eventTypes.isLoading || packages.isLoading ? <LoadingState /> : events.isError || venues.isError || eventTypes.isError || packages.isError ? <ErrorState /> : !events.data?.length ? <EmptyState onNew={() => setFormEvent(null)} /> : <EventsTable events={events.data} showFinancials={showFinancials} onNew={() => setFormEvent(null)} onEdit={setFormEvent} onDelete={setDeleteEvent} />}
    {formEvent !== undefined && <EventFormDialog event={formEvent} showFinancials={showFinancials} venues={venues.data ?? []} eventTypes={(eventTypes.data ?? []).map((item) => item.name)} packages={(packages.data ?? []).map((item) => item.name)} onClose={() => setFormEvent(undefined)} onSuccess={showSuccess} onError={showError} />}
    {deleteEvent && <DeleteEventDialog event={deleteEvent} onClose={() => setDeleteEvent(null)} onSuccess={showSuccess} onError={showError} />}
    {showImport && <EventImportDialog master={{ venues: venues.data ?? [], packages: (packages.data ?? []).map((item) => item.name), eventTypes: (eventTypes.data ?? []).map((item) => item.name) }} onClose={() => setShowImport(false)} onSuccess={showSuccess} onError={showError} />}
  </div>;
}

function LoadingState() { return <div className="grid min-h-80 place-items-center rounded-xl border border-border bg-card"><div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />טוען אירועים...</div></div>; }
function ErrorState() { return <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-destructive/40 bg-card p-8 text-center"><div><AlertCircle className="mx-auto size-6 text-destructive" /><p className="mt-3 font-medium text-foreground">לא ניתן לטעון אירועים</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">לא הצלחנו לטעון את האירועים. יש לבדוק את החיבור וההרשאות ב־Supabase ולנסות שוב.</p></div></div>; }
function EmptyState({ onNew }: { onNew: () => void }) { return <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border bg-card p-8 text-center"><div><CalendarDays className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 font-medium text-foreground">עדיין אין אירועים</p><p className="mt-1 text-sm text-muted-foreground">צרו את האירוע הראשון כדי להתחיל לנהל הזמנות.</p><Button type="button" className="mt-5" onClick={onNew}><Plus data-icon="inline-start" />אירוע חדש</Button></div></div>; }
