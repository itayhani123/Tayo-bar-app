import type { NotificationContext, WhatsAppNotificationType, WhatsAppTemplatePayload } from "./types";

export const WHATSAPP_TEMPLATE_NAMES: Record<WhatsAppNotificationType, string> = {
  assignment_created: "assignment_created_tayo_assignment_created_he",
  event_changed: "event_changed_tayo_he",
  reminder_day_before: "reminder_day_before_tayo_he",
  reminder_hours_before: "reminder_hours_before_tayo_he",
  work_time_updated: "work_time_updated_tayo_he",
};

export function buildTemplatePayload(type: WhatsAppNotificationType, phone: string, context: NotificationContext, hoursBefore = 4, includeSalary = false): WhatsAppTemplatePayload {
  const templateName = WHATSAPP_TEMPLATE_NAMES[type];
  if (templateName === "hello_world") return { templateName, phone, parameters: [] };
  return { templateName, phone, parameters: buildTemplateParameters(type, context, hoursBefore, includeSalary) };
}

export function buildTemplateParameters(type: WhatsAppNotificationType, context: NotificationContext, hoursBefore = 4, includeSalary = false): string[] {
  const event = [context.employeeName, context.eventDate, context.eventTime, context.venueName, context.eventType];
  return type === "reminder_hours_before"
  ? [
      context.employeeName,
      String(hoursBefore),
      context.eventTime,
      context.venueName,
      context.eventType,
    ]
    : type === "reminder_day_before"
  ? [
      context.employeeName,
      context.eventDate,
      context.eventTime,
      context.venueName,
      context.eventType,
    ]
   : type === "work_time_updated"
  ? [
      context.employeeName,
      context.eventDate,
      context.workStart ?? "",
      context.workEnd ?? "",
      context.workedDuration ?? "",
    ]
    : event;
}
