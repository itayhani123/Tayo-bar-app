"use client";
import { useQuery } from "@tanstack/react-query";
import { useEvents } from "@/features/events";
import { listCalendarStaffing } from "../services/calendar-staffing-service";

export function useCalendarData(includeFinancials: boolean) {
  const events = useEvents(includeFinancials);
  const eventIds = (events.data ?? []).map((event) => event.id);
  const staffing = useQuery({ queryKey: ["calendar-staffing", eventIds], queryFn: () => listCalendarStaffing(eventIds), enabled: !events.isLoading });
  return { events, staffing };
}
