import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WhatsAppSettings } from "./types";

const keys = ["whatsapp_notifications_enabled", "whatsapp_assignment_enabled", "whatsapp_event_change_enabled", "whatsapp_day_before_enabled", "whatsapp_hours_before_enabled", "whatsapp_hours_before", "whatsapp_work_time_enabled", "whatsapp_salary_in_owner_messages"] as const;
export const defaultWhatsAppSettings: WhatsAppSettings = { enabled: false, assignmentEnabled: true, eventChangeEnabled: true, dayBeforeEnabled: true, hoursBeforeEnabled: true, hoursBefore: 4, workTimeEnabled: true, salaryInOwnerMessages: false };

export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  const { data, error } = await createAdminClient().from("business_settings").select("key, numeric_value").in("key", [...keys]);
  if (error) throw error;
  const values = new Map((data ?? []).map((row) => [row.key, Number(row.numeric_value)]));
  return { enabled: values.get(keys[0]) === 1, assignmentEnabled: values.get(keys[1]) !== 0, eventChangeEnabled: values.get(keys[2]) !== 0, dayBeforeEnabled: values.get(keys[3]) !== 0, hoursBeforeEnabled: values.get(keys[4]) !== 0, hoursBefore: values.get(keys[5]) ?? 4, workTimeEnabled: values.get(keys[6]) !== 0, salaryInOwnerMessages: values.get(keys[7]) === 1 };
}

export async function saveWhatsAppSettings(settings: WhatsAppSettings) {
  const rows = [settings.enabled, settings.assignmentEnabled, settings.eventChangeEnabled, settings.dayBeforeEnabled, settings.hoursBeforeEnabled, settings.hoursBefore, settings.workTimeEnabled, settings.salaryInOwnerMessages].map((value, index) => ({ key: keys[index], numeric_value: typeof value === "boolean" ? Number(value) : value }));
  const { error } = await createAdminClient().from("business_settings").upsert(rows, { onConflict: "key" });
  if (error) throw error;
}
