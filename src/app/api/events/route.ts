import { eventSchema } from "@/features/events/validation";
import { requireCurrentUser } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueLeadWelcome } from "@/lib/whatsapp/enqueue";

export async function POST(request: Request) {
  try {
    const { role } = await requireCurrentUser();
    const values = eventSchema.parse(await request.json());
    const payload = {
      event_date: values.eventDate, start_time: values.startTime, event_type: values.eventType, venue_id: values.venueId,
      client_name: values.clientName.trim(), client_phone: values.clientPhone.trim() || null, guest_count: values.guestCount,
      package_type: values.packageType, manager_employee_id: values.managerEmployeeId || null, notes: values.notes.trim() || null,
      sales_status: "lead",
      ...(role === "owner" ? { price_per_guest: values.pricePerGuest, vat_rate: values.vatRate, price_includes_vat: values.priceIncludesVat, payer_type: values.payerType, payment_status: values.paymentStatus, security_check_received: values.securityCheckReceived, invoice_issued: values.invoiceIssued, estimated_alcohol_cost: values.estimatedAlcoholCost } : { price_per_guest: 0, payer_type: "client", payment_status: "unpaid" }),
    };
    const admin = createAdminClient();
    const { data, error } = await admin.from("events").insert(payload).select().single();
    if (error) throw error;
    let whatsappWarning: string | undefined;
    try { const result = await enqueueLeadWelcome(data.id); whatsappWarning = result.warning; }
    catch (notificationError) { whatsappWarning = notificationError instanceof Error ? notificationError.message : "יצירת הודעת WhatsApp נכשלה"; console.warn("Lead welcome warning:", notificationError); }
    return Response.json({ event: data, whatsappWarning }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Event creation failed" }, { status: 400 });
  }
}
