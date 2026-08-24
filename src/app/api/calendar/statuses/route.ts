import { requireCurrentUser } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateVat } from "@/lib/finance/calculations";

type EventRow = { id: string; guest_count: number; price_per_guest: number | string; vat_rate: number | string; price_includes_vat: boolean };
type PaymentRow = { event_id: string; amount: number | string };

export async function GET() {
  try {
    const { role } = await requireCurrentUser();
    const admin = createAdminClient();
    const [eventsResult, paymentsResult] = await Promise.all([
      admin.from("events").select("id, guest_count, price_per_guest, vat_rate, price_includes_vat"),
      admin.from("event_payments").select("event_id, amount"),
    ]);
    if (eventsResult.error) throw eventsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    const paid = new Map<string, number>();
    for (const payment of (paymentsResult.data ?? []) as PaymentRow[]) paid.set(payment.event_id, (paid.get(payment.event_id) ?? 0) + Number(payment.amount));
    const statuses = ((eventsResult.data ?? []) as EventRow[]).map((event) => {
      const grossTotal = calculateVat({ guestCount: event.guest_count, pricePerGuest: Number(event.price_per_guest), vatRate: Number(event.vat_rate), priceIncludesVat: event.price_includes_vat }).grossRevenue;
      const outstandingBalance = Math.max(0, Math.round((grossTotal - (paid.get(event.id) ?? 0) + Number.EPSILON) * 100) / 100);
      return { eventId: event.id, hasOutstandingBalance: outstandingBalance > 0, ...(role === "owner" ? { outstandingBalance } : {}) };
    });
    return Response.json({ statuses });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Calendar statuses failed" }, { status: 400 }); }
}
