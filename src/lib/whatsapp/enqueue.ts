import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDuration, getAssignmentSalary, getWorkedMinutes } from "@/features/event-staffing/calculations";
import { formatMoney, translateStoredValue } from "@/lib/hebrew";
import { normalizeIsraeliPhone } from "./phone";
import { notificationDedupeKey } from "./dedupe";
import { reminderSchedule } from "./scheduling";
import { getWhatsAppSettings } from "./settings";
import type { NotificationContext, WhatsAppNotificationType } from "./types";
import { workTimeNotificationDedupeSource } from "@/features/event-staffing/work-time-notification";

type EventRow = { id: string; event_date: string; start_time: string; event_type: string; venue_id: string };
type AssignmentRow = { id: string; event_id: string; employee_id: string; pay_type: "hourly" | "fixed"; hourly_rate: number | null; fixed_pay: number | null; work_start: string | null; work_end: string | null };

export async function enqueueAssignmentNotifications(assignmentId: string, type: "assignment_created" | "work_time_updated", actorRole: "owner" | "manager") {
  const admin = createAdminClient();
  const { data: assignment, error } = await admin.from("event_assignments").select("id, event_id, employee_id, pay_type, hourly_rate, fixed_pay, work_start, work_end").eq("id", assignmentId).single();
  if (error) throw error;
  const settings = await getWhatsAppSettings();
  if (!settings.enabled || (type === "assignment_created" ? !settings.assignmentEnabled : !settings.workTimeEnabled)) return { queued: 0, disabled: true, warning: "ההתראות אינן פעילות" };
  if (type === "work_time_updated" && (!assignment.work_start || !assignment.work_end)) return { queued: 0, skipped: true };
  try {
    const context = await loadContext(assignment as AssignmentRow, actorRole === "owner" && settings.salaryInOwnerMessages);
    const workTimeDedupe = type === "work_time_updated" ? workTimeNotificationDedupeSource(assignmentId, { workStart: assignment.work_start, workEnd: assignment.work_end }) : null;
    const queued = await insertNotification(type, assignment as AssignmentRow, context, new Date(), workTimeDedupe ?? `${type}:${assignmentId}:created`);
    if (type === "assignment_created") await scheduleReminders(assignment as AssignmentRow, context, settings);
    return queued;
  } catch (notificationError) {
    const message = notificationError instanceof Error ? notificationError.message : "יצירת ההתראה נכשלה";
    await recordFailure(type, assignment as AssignmentRow, message, `${type}:${assignmentId}:failed:${type === "work_time_updated" ? `${assignment.work_start}:${assignment.work_end}` : "created"}`);
    return { queued: 0, warning: message };
  }
}

export async function enqueueEventChanged(eventId: string) {
  const settings = await getWhatsAppSettings();
  if (!settings.enabled || !settings.eventChangeEnabled) return { queued: 0, warning: "ההתראות אינן פעילות" };
  const admin = createAdminClient();
  const { data, error } = await admin.from("event_assignments").select("id, event_id, employee_id, pay_type, hourly_rate, fixed_pay, work_start, work_end").eq("event_id", eventId);
  if (error) throw error;
  await admin.from("whatsapp_notifications").update({ status: "cancelled" }).eq("event_id", eventId).eq("status", "pending").in("notification_type", ["reminder_day_before", "reminder_hours_before"]);
  let queued = 0;
  for (const row of (data ?? []) as AssignmentRow[]) {
    try {
      const context = await loadContext(row, false);
      const version = `${context.eventDate}:${context.eventTime}`;
      queued += (await insertNotification("event_changed", row, context, new Date(), `event_changed:${row.id}:${version}`)).queued;
      await scheduleReminders(row, context, settings);
    } catch (notificationError) {
      const message = notificationError instanceof Error ? notificationError.message : "יצירת ההתראה נכשלה";
      await recordFailure("event_changed", row, message, `event_changed:${row.id}:failed`);
    }
  }
  return { queued };
}

export async function cancelAssignmentNotifications(assignmentId: string) {
  const { error } = await createAdminClient().from("whatsapp_notifications").update({ status: "cancelled" }).eq("assignment_id", assignmentId).in("status", ["pending", "processing"]);
  if (error) throw error;
}

async function scheduleReminders(assignment: AssignmentRow, context: NotificationContext, settings: Awaited<ReturnType<typeof getWhatsAppSettings>>) {
  const eventVersion = `${context.eventDate}:${context.eventTime}`;
  if (settings.dayBeforeEnabled) {
    const when = reminderSchedule(context.eventDate, context.eventTime, 24);
    if (when) await insertNotification("reminder_day_before", assignment, context, when, `reminder_day_before:${assignment.id}:${eventVersion}`);
  }
  if (settings.hoursBeforeEnabled) {
    const when = reminderSchedule(context.eventDate, context.eventTime, settings.hoursBefore);
    if (when) await insertNotification("reminder_hours_before", assignment, { ...context, calculatedSalary: String(settings.hoursBefore) }, when, `reminder_hours_before:${assignment.id}:${eventVersion}:${settings.hoursBefore}`);
  }
}

async function loadContext(assignment: AssignmentRow, includeSalary: boolean): Promise<NotificationContext> {
  const admin = createAdminClient();
  const [eventResult, employeeResult] = await Promise.all([admin.from("events").select("id, event_date, start_time, event_type, venue_id").eq("id", assignment.event_id).single(), admin.from("employees").select("full_name, phone").eq("id", assignment.employee_id).single()]);
  if (eventResult.error) throw eventResult.error;
  if (employeeResult.error) throw employeeResult.error;
  const event = eventResult.data as EventRow;
  const { data: venue } = await admin.from("venues").select("name").eq("id", event.venue_id).maybeSingle();
  const phone = normalizeIsraeliPhone(employeeResult.data.phone);
  if (!phone) throw new Error("לעובד חסר מספר טלפון ישראלי תקין");
  const minutes = getWorkedMinutes(assignment.work_start, assignment.work_end);
  const salary = getAssignmentSalary({ ...assignment, eventId: assignment.event_id, employeeId: assignment.employee_id, employeeName: employeeResult.data.full_name, employeePhone: employeeResult.data.phone ?? "", eventRole: "bartender", payType: assignment.pay_type, hourlyRate: assignment.hourly_rate, fixedPay: assignment.fixed_pay, workStart: assignment.work_start, workEnd: assignment.work_end, notes: "", createdAt: "", updatedAt: "" });
  return { employeeName: employeeResult.data.full_name, employeePhone: phone, eventDate: event.event_date, eventTime: event.start_time.slice(0, 5), venueName: venue?.name ?? "ללא אולם", eventType: translateStoredValue(event.event_type), workStart: formatTime(assignment.work_start), workEnd: formatTime(assignment.work_end), workedDuration: minutes === null ? undefined : formatDuration(minutes), calculatedSalary: includeSalary && salary !== null ? formatMoney(salary) : undefined };
}

async function insertNotification(type: WhatsAppNotificationType, assignment: AssignmentRow, context: NotificationContext, scheduledFor: Date, dedupeSource: string) {
  const dedupeKey = notificationDedupeKey(dedupeSource);
  const { error } = await createAdminClient().from("whatsapp_notifications").insert({ employee_id: assignment.employee_id, event_id: assignment.event_id, assignment_id: assignment.id, notification_type: type, status: "pending", scheduled_for: scheduledFor.toISOString(), payload: context, dedupe_key: dedupeKey });
  if (error?.code === "23505") return { queued: 0 };
  if (error) throw error;
  return { queued: 1 };
}

async function recordFailure(type: WhatsAppNotificationType, assignment: AssignmentRow, message: string, dedupeSource: string) {
  const { error } = await createAdminClient().from("whatsapp_notifications").insert({ employee_id: assignment.employee_id, event_id: assignment.event_id, assignment_id: assignment.id, notification_type: type, status: "failed", error_message: message.slice(0, 1000), payload: { operationalWarning: message }, dedupe_key: notificationDedupeKey(dedupeSource) });
  if (error?.code !== "23505" && error) console.error("Failed to record WhatsApp warning:", error.message);
}

function formatTime(value: string | null) { return value ? new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : undefined; }
