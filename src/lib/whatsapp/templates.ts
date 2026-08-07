import type { NotificationContext, WhatsAppNotificationType, WhatsAppTemplatePayload } from "./types";

export const WHATSAPP_TEMPLATE_NAMES: Record<WhatsAppNotificationType, string> = {
  assignment_created: "hello_world",
  event_changed: "hello_world",
  reminder_day_before: "hello_world",
  reminder_hours_before: "hello_world",
  work_time_updated: "hello_world",
};

export function buildTemplatePayload(type: WhatsAppNotificationType, phone: string, context: NotificationContext, hoursBefore = 4, includeSalary = false): WhatsAppTemplatePayload {
  const templateName = WHATSAPP_TEMPLATE_NAMES[type];
  if (templateName === "hello_world") return { templateName, phone, parameters: [] };
  return { templateName, phone, parameters: buildTemplateParameters(type, context, hoursBefore, includeSalary) };
}

export function buildTemplateParameters(type: WhatsAppNotificationType, context: NotificationContext, hoursBefore = 4, includeSalary = false): string[] {
  const event = [context.employeeName, context.eventDate, context.eventTime, context.venueName, context.eventType];
  return type === "reminder_hours_before" ? [String(hoursBefore), context.eventTime, context.venueName, context.eventType]
    : type === "reminder_day_before" ? [context.eventDate, context.eventTime, context.venueName, context.eventType]
    : type === "work_time_updated" ? [context.employeeName, context.eventDate, context.workStart ?? "", context.workEnd ?? "", context.workedDuration ?? "", includeSalary ? context.calculatedSalary ?? "" : ""]
    : event;
}
