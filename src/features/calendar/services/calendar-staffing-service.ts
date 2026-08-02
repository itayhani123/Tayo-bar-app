import { createClient } from "@/lib/supabase/client";
import type { CalendarStaffing } from "../types";

type AssignmentRow = { event_id: string };
export async function listCalendarStaffing(eventIds: string[]): Promise<CalendarStaffing[]> {
  if (!eventIds.length) return [];
  const { data, error } = await createClient().from("event_assignments").select("event_id").in("event_id", eventIds);
  if (error) throw error;
  const counts = new Map<string, number>();
  (data as AssignmentRow[]).forEach((row) => counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1));
  return eventIds.map((eventId) => ({ eventId, assignedCount: counts.get(eventId) ?? 0 }));
}
