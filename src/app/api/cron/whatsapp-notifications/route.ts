import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/client";
import { getWhatsAppSettings } from "@/lib/whatsapp/settings";
import { buildTemplatePayload } from "@/lib/whatsapp/templates";
import type { NotificationContext, WhatsAppNotificationType } from "@/lib/whatsapp/types";
import { hasValidCronAuthorization } from "@/lib/whatsapp/security";

type NotificationRow = {
  id: string;
  notification_type: WhatsAppNotificationType;
  payload: NotificationContext;
};

async function handleCron(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getWhatsAppSettings();

  if (!settings.enabled) {
    return Response.json({ processed: 0, disabled: true });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("whatsapp_notifications")
    .select("id, notification_type, payload")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for")
    .limit(20);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const notification of (data ?? []) as NotificationRow[]) {
    const { data: claimed } = await admin
      .from("whatsapp_notifications")
      .update({ status: "processing" })
      .eq("id", notification.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!claimed) continue;

    try {
      const payload = buildTemplatePayload(
        notification.notification_type,
        notification.payload.employeePhone,
        notification.payload,
        settings.hoursBefore,
        Boolean(notification.payload.calculatedSalary)
      );

      const providerId = await sendWhatsAppTemplate(payload);

      await admin
        .from("whatsapp_notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: providerId,
          error_message: null,
        })
        .eq("id", notification.id);

      sent += 1;
    } catch (sendError) {
      const message =
        sendError instanceof Error
          ? sendError.message
          : "WhatsApp send failed";

      await admin
        .from("whatsapp_notifications")
        .update({
          status: "failed",
          error_message: message.slice(0, 1000),
        })
        .eq("id", notification.id);

      failed += 1;
    }
  }

  return Response.json({
    processed: sent + failed,
    sent,
    failed,
  });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}