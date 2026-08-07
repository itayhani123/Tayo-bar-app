import { createClient } from "@/lib/supabase/client";
import type { ImportRow } from "./types";

export async function importEventRows(rows: ImportRow[]): Promise<void> {
  if (rows.some((row) => row.guestCount === null)) throw new Error("Invalid guest count");
  const payload = rows.map((row) => ({ event_date: row.eventDate, start_time: row.startTime, event_type: row.eventType, venue_id: row.venueId, client_name: row.clientName.trim(), client_phone: row.clientPhone.trim() || null, guest_count: row.guestCount as number, price_per_guest: row.pricePerGuest, vat_rate: row.vatRate, price_includes_vat: row.priceIncludesVat, package_type: row.packageType, payer_type: row.payerType, payment_status: row.paymentStatus, manager_employee_id: null, security_check_received: false, invoice_issued: false, estimated_alcohol_cost: 0, notes: row.notes.trim() || null }));
  const { error } = await createClient().from("events").insert(payload);
  if (error) throw error;
}
