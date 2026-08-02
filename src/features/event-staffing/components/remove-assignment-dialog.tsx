"use client";
import { Button } from "@/components/ui/button";
import { useDeleteEventAssignment } from "../hooks/use-event-staffing";
import type { EventAssignment } from "../types";

export function RemoveAssignmentDialog({ assignment, onClose, onSuccess, onError }: { assignment: EventAssignment; onClose: () => void; onSuccess: (message: string) => void; onError: (message: string) => void }) {
  const mutation = useDeleteEventAssignment(assignment.eventId);
  const remove = async () => { try { await mutation.mutateAsync(assignment.id); onSuccess("העובד הוסר מצוות האירוע."); onClose(); } catch { onError("לא ניתן להסיר את העובד מהאירוע. נסו שוב."); } };
  return <div className="fixed inset-0 z-70 grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl"><h3 className="font-semibold">הסרת עובד מהאירוע?</h3><p className="mt-2 text-sm text-muted-foreground">{assignment.employeeName} יוסר מצוות האירוע. העובד עצמו לא יימחק.</p><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>ביטול</Button><Button type="button" variant="destructive" disabled={mutation.isPending} onClick={remove}>{mutation.isPending ? "מסיר..." : "הסרה"}</Button></div></div></div>;
}
