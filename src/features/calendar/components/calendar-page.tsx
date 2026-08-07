"use client";
import { useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import heLocale from "@fullcalendar/core/locales/he";
import type { EventClickArg, EventContentArg, EventDropArg, EventMountArg } from "@fullcalendar/core";
import { AlertCircle, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventFormDialog, EventsToast, useUpdateEventSchedule, useVenues } from "@/features/events";
import type { EventFormValues, EventRecord, PaymentStatus } from "@/features/events";
import { useMasterData } from "@/features/master-data";
import { paymentStatusLabels, translateStoredValue } from "@/lib/hebrew";
import { useCalendarData } from "../hooks/use-calendar";
import type { CalendarAccess, CalendarEvent, CalendarFilters } from "../types";
import { recommendedBartenders, toFullCalendarEvent } from "../utils/calendar-events";

type Notice = { kind: "success" | "error"; message: string } | null;
const emptyFilters: CalendarFilters = { venueId: "", eventType: "", paymentStatus: "" };

export function CalendarPage({ access }: { access: CalendarAccess }) {
  const calendarRef = useRef<FullCalendar>(null);
  const { events, staffing } = useCalendarData(access === "owner");
  const venues = useVenues();
  const eventTypes = useMasterData("event_types");
  const packages = useMasterData("bar_packages");
  const scheduleMutation = useUpdateEventSchedule();
  const [filters, setFilters] = useState<CalendarFilters>(emptyFilters);
  const [editing, setEditing] = useState<EventRecord | null | undefined>(undefined);
  const [initialValues, setInitialValues] = useState<Partial<EventFormValues> | undefined>();
  const [notice, setNotice] = useState<Notice>(null);
  const calendarEvents = useMemo<CalendarEvent[]>(() => { const counts = new Map((staffing.data ?? []).map((item) => [item.eventId, item.assignedCount])); return (events.data ?? []).map((event) => ({ ...event, assignedCount: counts.get(event.id) ?? 0, recommendedBartenders: recommendedBartenders(event.guestCount) })).filter((event) => (!filters.venueId || event.venueId === filters.venueId) && (!filters.eventType || event.eventType === filters.eventType) && (!filters.paymentStatus || event.paymentStatus === filters.paymentStatus)); }, [events.data, filters, staffing.data]);
  const eventTypeColors = useMemo(() => new Map((eventTypes.data ?? []).map((item) => [item.name, item.colorHex ?? "#475569"])), [eventTypes.data]);
  const loading = events.isLoading || staffing.isLoading || venues.isLoading || eventTypes.isLoading || packages.isLoading;
  const failed = events.isError || staffing.isError || venues.isError || eventTypes.isError || packages.isError;
  const openNew = (values?: Partial<EventFormValues>) => { setInitialValues(values); setEditing(null); };
  const closeDialog = () => { setEditing(undefined); setInitialValues(undefined); };
  const showSuccess = (message: string) => setNotice({ kind: "success", message });
  const showError = (message: string) => setNotice({ kind: "error", message });

  const dateClick = (arg: DateClickArg) => openNew({ eventDate: localDate(arg.date), startTime: arg.allDay ? "" : localTime(arg.date) });
  const eventClick = (arg: EventClickArg) => setEditing((arg.event.extendedProps.record as CalendarEvent));
  const eventDrop = async (arg: EventDropArg) => { const start = arg.event.start; if (!start) return arg.revert(); try { await scheduleMutation.mutateAsync({ id: arg.event.id, eventDate: localDate(start), startTime: localTime(start) }); showSuccess("מועד האירוע עודכן בהצלחה."); } catch { arg.revert(); showError("לא ניתן לעדכן את מועד האירוע. השינוי בוטל."); } };
  const eventMount = (arg: EventMountArg) => { const event = arg.event.extendedProps.record as CalendarEvent; arg.el.title = `${event.venueName}\n${translateStoredValue(event.eventType)}\n${event.clientName}\n${event.guestCount} אורחים\n${event.assignedCount} עובדים משובצים\n${event.recommendedBartenders} ברמנים מומלצים${access === "owner" ? `\n${paymentStatusLabels[event.paymentStatus]}` : ""}`; };
  const eventContent = (arg: EventContentArg) => { const record = arg.event.extendedProps.record as CalendarEvent; return <div className="min-w-0 px-1 py-0.5"><div className="truncate font-medium">{arg.timeText ? `${arg.timeText} · ` : ""}{arg.event.title}</div>{access === "owner" && <span className="mt-0.5 inline-flex rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] leading-none">{paymentStatusLabels[record.paymentStatus]}</span>}</div>; };

  if (loading) return <CalendarSkeleton />;
  if (failed) return <ErrorState onRetry={() => { events.refetch(); staffing.refetch(); venues.refetch(); eventTypes.refetch(); packages.refetch(); }} />;
  return <div className="mx-auto max-w-7xl space-y-5"><header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-muted-foreground">תפעול</p><h2 className="mt-1 text-2xl font-semibold">לוח שנה</h2><p className="mt-2 text-sm text-muted-foreground">תכנון אירועים, צוות ומוכנות במקום אחד.</p></div><Button type="button" onClick={() => openNew()}><Plus />אירוע חדש</Button></header>
    <Filters filters={filters} venues={venues.data ?? []} eventTypes={(eventTypes.data ?? []).map((item) => item.name)} onChange={setFilters} />
    {notice && <EventsToast kind={notice.kind} message={notice.message} onDismiss={() => setNotice(null)} />}
    <div className="calendar-shell overflow-hidden rounded-xl border border-border bg-card p-2 shadow-sm sm:p-4"><FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]} locale={heLocale} direction="rtl" firstDay={0} initialView={typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "listMonth" : "dayGridMonth"} headerToolbar={{ start: "prev,next today", center: "title", end: "dayGridMonth,timeGridWeek,timeGridDay,listMonth" }} buttonText={{ today: "היום", month: "חודש", week: "שבוע", day: "יום", list: "רשימה" }} noEventsText="אין אירועים להצגה" allDayText="כל היום" height="auto" events={calendarEvents.map((event) => toFullCalendarEvent(event, eventTypeColors.get(event.eventType)))} editable eventDurationEditable={false} dateClick={dateClick} eventClick={eventClick} eventDrop={eventDrop} eventDidMount={eventMount} eventContent={eventContent} nowIndicator slotMinTime="08:00:00" slotMaxTime="30:00:00" />{!calendarEvents.length && <p className="py-5 text-center text-sm text-muted-foreground">אין אירועים להצגה</p>}</div>
    {editing !== undefined && <EventFormDialog event={editing} initialValues={initialValues} showFinancials={access === "owner"} venues={venues.data ?? []} eventTypes={(eventTypes.data ?? []).map((item) => item.name)} packages={(packages.data ?? []).map((item) => item.name)} onClose={closeDialog} onSuccess={showSuccess} onError={showError} />}
  </div>;
}

function Filters({ filters, venues, eventTypes, onChange }: { filters: CalendarFilters; venues: { id: string; name: string }[]; eventTypes: string[]; onChange: (filters: CalendarFilters) => void }) { return <section className="rounded-xl border border-border bg-card p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">סינון</h3><Button type="button" size="sm" variant="ghost" onClick={() => onChange(emptyFilters)}>נקה סינון</Button></div><div className="grid gap-3 sm:grid-cols-3"><Select label="אולם" value={filters.venueId} onChange={(value) => onChange({ ...filters, venueId: value })}><option value="">כל האולמות</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</Select><Select label="סוג אירוע" value={filters.eventType} onChange={(value) => onChange({ ...filters, eventType: value })}><option value="">כל הסוגים</option>{eventTypes.map((type) => <option key={type} value={type}>{translateStoredValue(type)}</option>)}</Select><Select label="סטטוס תשלום" value={filters.paymentStatus} onChange={(value) => onChange({ ...filters, paymentStatus: value })}><option value="">כל הסטטוסים</option>{(["paid", "partial", "unpaid"] as PaymentStatus[]).map((status) => <option key={status} value={status}>{paymentStatusLabels[status]}</option>)}</Select></div></section>; }
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) { return <label className="text-sm font-medium">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">{children}</select></label>; }
function CalendarSkeleton() { return <div className="mx-auto max-w-7xl space-y-5"><div className="h-20 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-[560px] animate-pulse rounded-xl bg-muted" /></div>; }
function ErrorState({ onRetry }: { onRetry: () => void }) { return <div className="grid min-h-96 place-items-center rounded-xl border border-dashed border-destructive/40 bg-card p-8 text-center"><div><AlertCircle className="mx-auto size-7 text-destructive" /><p className="mt-3 font-medium">לא ניתן לטעון את לוח השנה</p><Button type="button" className="mt-4" onClick={onRetry}><LoaderCircle />נסה שוב</Button></div></div>; }
function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function localTime(date: Date) { return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
