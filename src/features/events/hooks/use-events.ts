"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createEvent, createOperationalEvent, deleteEvent, listEvents, listVenues, updateEvent, updateEventSchedule } from "../services";
import { updateOperationalEvent } from "../services/events-service";
import type { EventFormValues } from "../types";

const eventsKey = ["events"] as const;
const venuesKey = ["venues"] as const;

export function useEvents(includeFinancials = true) {
  return useQuery({ queryKey: [...eventsKey, includeFinancials], queryFn: () => listEvents(includeFinancials) });
}

export function useVenues() {
  return useQuery({ queryKey: venuesKey, queryFn: listVenues });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createEvent, onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) });
}
export function useCreateOperationalEvent() { const queryClient = useQueryClient(); return useMutation({ mutationFn: createOperationalEvent, onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) }); }

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ id, values }: { id: string; values: EventFormValues }) => updateEvent(id, values), onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) });
}
export function useUpdateOperationalEvent() { const queryClient = useQueryClient(); return useMutation({ mutationFn: ({ id, values }: { id: string; values: EventFormValues }) => updateOperationalEvent(id, values), onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) }); }

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: deleteEvent, onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) });
}

export function useUpdateEventSchedule() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ id, eventDate, startTime }: { id: string; eventDate: string; startTime: string }) => updateEventSchedule(id, eventDate, startTime), onSuccess: () => queryClient.invalidateQueries({ queryKey: eventsKey }) });
}
