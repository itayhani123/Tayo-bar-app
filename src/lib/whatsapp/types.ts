export const notificationTypes = ["assignment_created", "event_changed", "reminder_day_before", "reminder_hours_before", "work_time_updated"] as const;
export type WhatsAppNotificationType = (typeof notificationTypes)[number];
export type WhatsAppNotificationStatus = "pending" | "processing" | "sent" | "delivered" | "read" | "failed" | "cancelled";
export type WhatsAppTemplatePayload = { templateName: string; phone: string; parameters: string[] };
export type WhatsAppSettings = { enabled: boolean; assignmentEnabled: boolean; eventChangeEnabled: boolean; dayBeforeEnabled: boolean; hoursBeforeEnabled: boolean; hoursBefore: number; workTimeEnabled: boolean; salaryInOwnerMessages: boolean };
export type NotificationContext = { employeeName: string; employeePhone: string; eventDate: string; eventTime: string; venueName: string; eventType: string; workStart?: string; workEnd?: string; workedDuration?: string; calculatedSalary?: string };
