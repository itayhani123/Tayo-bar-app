"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createEventPayment, deleteEventPayment, listEventPayments, updateEventPayment } from "../services/event-payments-service";
import type { EventPaymentValues } from "../types";

export const eventPaymentsKey = (eventId: string) => ["event-payments", eventId] as const;
export function useEventPayments(eventId: string) { return useQuery({ queryKey: eventPaymentsKey(eventId), queryFn: () => listEventPayments(eventId), enabled: Boolean(eventId) }); }
function useInvalidate(eventId: string) { const client = useQueryClient(); return () => Promise.all([client.invalidateQueries({ queryKey: eventPaymentsKey(eventId) }), client.invalidateQueries({ queryKey: ["dashboard"] }), client.invalidateQueries({ queryKey: ["events"] })]); }
export function useCreateEventPayment(eventId: string) { const invalidate = useInvalidate(eventId); return useMutation({ mutationFn: (values: EventPaymentValues) => createEventPayment(eventId, values), onSuccess: invalidate }); }
export function useUpdateEventPayment(eventId: string) { const invalidate = useInvalidate(eventId); return useMutation({ mutationFn: ({ id, values }: { id: string; values: EventPaymentValues }) => updateEventPayment(id, values), onSuccess: invalidate }); }
export function useDeleteEventPayment(eventId: string) { const invalidate = useInvalidate(eventId); return useMutation({ mutationFn: deleteEventPayment, onSuccess: invalidate }); }
