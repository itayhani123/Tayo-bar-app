import { createClient } from "@/lib/supabase/client";
import type { EventFormValues, EventRecord, VenueOption } from "../types";

type EventDatabaseRow = {
  id: string;
  event_date: string;
  start_time: string;
  event_type: EventFormValues["eventType"];
  venue_id: string;
  client_name: string;
  client_phone: string | null;
  guest_count: number;
  price_per_guest: number | string;
  vat_rate: number | string;
  price_includes_vat: boolean;
  package_type: EventFormValues["packageType"];
  payer_type: EventFormValues["payerType"];
  payment_status: EventFormValues["paymentStatus"];
  manager_employee_id: string | null;
  security_check_received: boolean;
  invoice_issued: boolean;
  estimated_alcohol_cost: number | string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function toRecord(row: EventDatabaseRow, venueName: string): EventRecord {
  return {
    id: row.id, eventDate: row.event_date, startTime: row.start_time, eventType: row.event_type,
    venueId: row.venue_id, venueName, clientName: row.client_name, clientPhone: row.client_phone ?? "",
    guestCount: row.guest_count, pricePerGuest: Number(row.price_per_guest), vatRate: Number(row.vat_rate), priceIncludesVat: row.price_includes_vat, packageType: row.package_type,
    payerType: row.payer_type, paymentStatus: row.payment_status, managerEmployeeId: row.manager_employee_id ?? "",
    securityCheckReceived: row.security_check_received, invoiceIssued: row.invoice_issued,
    estimatedAlcoholCost: Number(row.estimated_alcohol_cost), notes: row.notes ?? "", createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function toPayload(values: EventFormValues) {
  return {
    event_date: values.eventDate, start_time: values.startTime, event_type: values.eventType, venue_id: values.venueId,
    client_name: values.clientName.trim(), client_phone: values.clientPhone.trim() || null, guest_count: values.guestCount,
    price_per_guest: values.pricePerGuest, vat_rate: values.vatRate, price_includes_vat: values.priceIncludesVat, package_type: values.packageType, payer_type: values.payerType,
    payment_status: values.paymentStatus, manager_employee_id: values.managerEmployeeId || null,
    security_check_received: values.securityCheckReceived, invoice_issued: values.invoiceIssued,
    estimated_alcohol_cost: values.estimatedAlcoholCost, notes: values.notes.trim() || null,
  };
}

async function venueNames() {
  const { data, error } = await createClient().from("venues").select("id, name");
  if (error) {
  console.error("Supabase Venues Error:", error);
  throw error;
}
  return new Map((data as VenueOption[]).map((venue) => [venue.id, venue.name]));
}

export async function listVenues(): Promise<VenueOption[]> {
  const { data, error } = await createClient().from("venues").select("id, name").order("name");
  if (error) throw error;
  return data as VenueOption[];
}

export async function listEvents(includeFinancials = true): Promise<EventRecord[]> {
  try {
    const [{ data, error }, names] = await Promise.all([
      createClient()
        .from("events")
        .select(includeFinancials ? "*" : "id, event_date, start_time, event_type, venue_id, client_name, client_phone, guest_count, package_type, security_check_received, invoice_issued, manager_employee_id, notes, created_at, updated_at")
        .order("event_date")
        .order("start_time"),
      venueNames(),
    ]);

    console.log("Events error:", error);
    console.log("Events data:", data);
    console.log("Venue names:", names);

    if (error) {
  console.error("Supabase Events Error:", error);
  throw error;
}

    return (data as unknown as EventDatabaseRow[]).map((event) =>
      toRecord(event, names.get(event.venue_id) ?? "Unknown venue")
    );
  } catch (e) {
    console.error("LIST EVENTS FAILED:", e);
    throw e;
  }
}

export async function getEvent(id: string): Promise<EventRecord> {
  const [{ data, error }, names] = await Promise.all([createClient().from("events").select("*").eq("id", id).single(), venueNames()]);
  if (error) throw error;
  return toRecord(data as EventDatabaseRow, names.get((data as EventDatabaseRow).venue_id) ?? "Unknown venue");
}

export async function createEvent(values: EventFormValues): Promise<EventRecord> {
  const { data, error } = await createClient().from("events").insert(toPayload(values)).select().single();
  if (error) throw error;
  const row = data as EventDatabaseRow;
  return toRecord(row, (await venueNames()).get(row.venue_id) ?? "Unknown venue");
}
export async function createOperationalEvent(values: EventFormValues): Promise<void> { const payload = { event_date: values.eventDate, start_time: values.startTime, event_type: values.eventType, venue_id: values.venueId, client_name: values.clientName.trim(), client_phone: values.clientPhone.trim() || null, guest_count: values.guestCount, package_type: values.packageType, payer_type: "client", payment_status: "unpaid", manager_employee_id: values.managerEmployeeId || null, security_check_received: false, invoice_issued: false, notes: values.notes.trim() || null }; const { error } = await createClient().from("events").insert(payload); if (error) throw error; }

export async function updateEvent(id: string, values: EventFormValues): Promise<EventRecord> {
  const supabase = createClient();
  const { data: previous, error: previousError } = await supabase.from("events").select("event_date, start_time").eq("id", id).single();
  if (previousError) throw previousError;
  const { data, error } = await supabase.from("events").update(toPayload(values)).eq("id", id).select().single();
  if (error) throw error;
  if (previous.event_date !== values.eventDate || previous.start_time.slice(0, 5) !== values.startTime.slice(0, 5)) await notifyEventChanged(id);
  const row = data as EventDatabaseRow;
  return toRecord(row, (await venueNames()).get(row.venue_id) ?? "Unknown venue");
}

export async function updateOperationalEvent(id: string, values: EventFormValues): Promise<void> { const supabase = createClient(); const { data: previous, error: previousError } = await supabase.from("events").select("event_date, start_time").eq("id", id).single(); if (previousError) throw previousError; const payload = { event_date: values.eventDate, start_time: values.startTime, event_type: values.eventType, venue_id: values.venueId, client_name: values.clientName.trim(), client_phone: values.clientPhone.trim() || null, guest_count: values.guestCount, package_type: values.packageType, manager_employee_id: values.managerEmployeeId || null, notes: values.notes.trim() || null }; const { error } = await supabase.from("events").update(payload).eq("id", id); if (error) throw error; if (previous.event_date !== values.eventDate || previous.start_time.slice(0, 5) !== values.startTime.slice(0, 5)) await notifyEventChanged(id); }

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await createClient().from("events").delete().eq("id", id);
  if (error) throw error;
}

export async function updateEventSchedule(id: string, eventDate: string, startTime: string): Promise<void> {
  const supabase = createClient();
  const { data: previous, error: previousError } = await supabase.from("events").select("event_date, start_time").eq("id", id).single();
  if (previousError) throw previousError;
  const { error } = await supabase.from("events").update({ event_date: eventDate, start_time: startTime }).eq("id", id);
  if (error) throw error;
  if (previous.event_date !== eventDate || previous.start_time.slice(0, 5) !== startTime.slice(0, 5)) await notifyEventChanged(id);
}

async function notifyEventChanged(eventId: string) {
  try {
    const response = await fetch("/api/whatsapp/trigger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "event_changed", eventId }) });
    if (!response.ok) console.warn("WhatsApp notification warning:", await response.text());
  } catch (error) { console.warn("WhatsApp notification warning:", error); }
}
