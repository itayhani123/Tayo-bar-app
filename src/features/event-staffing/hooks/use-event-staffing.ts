"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createEventAssignment, deleteEventAssignment, listEventAssignments, updateEventAssignment } from "../services/event-staffing-service";
import type { AssignmentFormValues } from "../types";

const key = (eventId: string) => ["event-assignments", eventId] as const;
export function useEventAssignments(eventId: string, includeFinancials = true) { return useQuery({ queryKey: [...key(eventId), includeFinancials], queryFn: () => listEventAssignments(eventId, includeFinancials), enabled: Boolean(eventId) }); }
export function useCreateEventAssignment(eventId: string, eventDate: string) { const client = useQueryClient(); return useMutation({ mutationFn: (values: AssignmentFormValues) => createEventAssignment(eventId, eventDate, values), onSuccess: () => client.invalidateQueries({ queryKey: key(eventId) }) }); }
export function useUpdateEventAssignment(eventId: string, eventDate: string) { const client = useQueryClient(); return useMutation({ mutationFn: ({ id, values }: { id: string; values: AssignmentFormValues }) => updateEventAssignment(id, eventDate, values), onSuccess: () => client.invalidateQueries({ queryKey: key(eventId) }) }); }
export function useDeleteEventAssignment(eventId: string) { const client = useQueryClient(); return useMutation({ mutationFn: deleteEventAssignment, onSuccess: () => client.invalidateQueries({ queryKey: key(eventId) }) }); }
