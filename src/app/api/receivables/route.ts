import { assertOwner } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { getIsraelDateOnly } from "@/features/dashboard/utils/dashboard-date-range";

type EventRow = { id: string; event_date: string; event_type: string; venue_id: string; client_name: string; client_phone: string | null; payer_type: "client" | "venue"; guest_count: number; price_per_guest: number | string; vat_rate: number | string; price_includes_vat: boolean; notes: string | null };
type VenueRow = { id: string; name: string };
type PaymentRow = { event_id: string; amount: number | string; paid_at: string; payment_method: string };

export async function GET() {
  try { await assertOwner(); } catch { return Response.json({ error: "Unauthorized" }, { status: 403 }); }
  const supabase = await createClient();
  const today = getIsraelDateOnly();
  const [eventsResult, venuesResult] = await Promise.all([
    supabase.from("events").select("id, event_date, event_type, venue_id, client_name, client_phone, payer_type, guest_count, price_per_guest, vat_rate, price_includes_vat, notes").lte("event_date", today).order("event_date"),
    supabase.from("venues").select("id, name"),
  ]);
  const eventRows = (eventsResult.data ?? []) as EventRow[];
  const paymentsResult = eventRows.length ? await supabase.from("event_payments").select("event_id, amount, paid_at, payment_method").in("event_id", eventRows.map((event) => event.id)) : { data: [] as PaymentRow[], error: null };
  const error = eventsResult.error ?? venuesResult.error ?? paymentsResult.error;
  if (error) return Response.json({ error: error.message }, { status: 400 });
  const venues = new Map((venuesResult.data as VenueRow[]).map((venue) => [venue.id, venue.name]));
  const payments = new Map<string, { amount: number; paidAt: string; paymentMethod: string }[]>();
  (paymentsResult.data as PaymentRow[]).forEach((payment) => payments.set(payment.event_id, [...(payments.get(payment.event_id) ?? []), { amount: Number(payment.amount), paidAt: payment.paid_at, paymentMethod: payment.payment_method }]));
  return Response.json(eventRows.map((event) => ({ id: event.id, eventDate: event.event_date, eventType: event.event_type, venueId: event.venue_id, venueName: venues.get(event.venue_id) ?? "אולם לא ידוע", clientName: event.client_name, clientPhone: event.client_phone ?? "", payerType: event.payer_type, guestCount: event.guest_count, pricePerGuest: Number(event.price_per_guest), vatRate: Number(event.vat_rate), priceIncludesVat: event.price_includes_vat, notes: event.notes ?? "", payments: payments.get(event.id) ?? [] })));
}
