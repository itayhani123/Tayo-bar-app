"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createEvent, deleteEvent, listEvents, listVenues, updateEvent, updateEventSchedule } from "../services";
import type { EventFormValues } from "../types";

const eventsKey = ["events"] as const;
const venuesKey = ["venues"] as const;

export function useEvents() {
  return useQuery({ queryKey: eventsKey, queryFn: listEvents });
}

export function useVenues() {
  return useQuery({ queryKey: venuesKey, queryFn: listVenues });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createEvent, onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ id, values }: { id: string; values: EventFormValues }) => updateEvent(id, values), onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: deleteEvent, onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) });
}

export function useUpdateEventSchedule() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ id, eventDate, startTime }: { id: string; eventDate: string; startTime: string }) => updateEventSchedule(id, eventDate, startTime), onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) });
}
