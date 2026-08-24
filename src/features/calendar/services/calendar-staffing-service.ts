import { createClient } from "@/lib/supabase/client";
import type { CalendarFinanceStatus, CalendarStaffing } from "../types";

type AssignmentRow = { event_id: string };
export async function listCalendarStaffing(eventIds: string[]): Promise<CalendarStaffing[]> {
  if (!eventIds.length) return [];
  const { data, error } = await createClient().from("event_assignments").select("event_id").in("event_id", eventIds);
  if (error) throw error;
  const counts = new Map<string, number>();
  (data as AssignmentRow[]).forEach((row) => counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1));
  return eventIds.map((eventId) => ({ eventId, assignedCount: counts.get(eventId) ?? 0 }));
}

export async function listCalendarFinanceStatuses(): Promise<CalendarFinanceStatus[]> {
  const response = await fetch("/api/calendar/statuses");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Calendar statuses failed");
  return body.statuses as CalendarFinanceStatus[];
}
