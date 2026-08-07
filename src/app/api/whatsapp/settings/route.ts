import { randomUUID } from "node:crypto";
import { assertOwner } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeIsraeliPhone } from "@/lib/whatsapp/phone";
import { getWhatsAppSettings, saveWhatsAppSettings } from "@/lib/whatsapp/settings";
import type { WhatsAppSettings } from "@/lib/whatsapp/types";

export async function GET() {
  try {
    await assertOwner();
    const [settings, employees] = await Promise.all([getWhatsAppSettings(), createAdminClient().from("employees").select("id, full_name, phone").eq("active", true).order("full_name")]);
    if (employees.error) throw employees.error;
    return Response.json({ settings, employees: employees.data });
  } catch { return Response.json({ error: "Unauthorized" }, { status: 403 }); }
}

export async function PATCH(request: Request) {
  try {
    await assertOwner();
    const settings = await request.json() as WhatsAppSettings;
    if (!Number.isFinite(settings.hoursBefore) || settings.hoursBefore < 1 || settings.hoursBefore > 72) return Response.json({ error: "מספר השעות אינו תקין" }, { status: 400 });
    await saveWhatsAppSettings(settings);
    return Response.json({ saved: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unauthorized" }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    await assertOwner();
    const settings = await getWhatsAppSettings();
    if (!settings.enabled) return Response.json({ error: "יש להפעיל התראות לפני שליחת הודעת בדיקה" }, { status: 400 });
    const { employeeId } = await request.json() as { employeeId?: string };
    if (!employeeId) return Response.json({ error: "יש לבחור עובד" }, { status: 400 });
    const admin = createAdminClient();
    const { data: employee, error } = await admin.from("employees").select("id, full_name, phone").eq("id", employeeId).single();
    if (error) throw error;
    const phone = normalizeIsraeliPhone(employee.phone);
    if (!phone) return Response.json({ error: "לעובד אין מספר טלפון תקין" }, { status: 400 });
    const { error: insertError } = await admin.from("whatsapp_notifications").insert({ employee_id: employee.id, notification_type: "assignment_created", scheduled_for: new Date().toISOString(), payload: { employeeName: employee.full_name, employeePhone: phone, eventDate: "בדיקה", eventTime: "בדיקה", venueName: "TAYO BAR — מצב בדיקה", eventType: "הודעת בדיקה" }, dedupe_key: `test:${randomUUID()}` });
    if (insertError) throw insertError;
    return Response.json({ queued: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unauthorized" }, { status: 403 }); }
}
