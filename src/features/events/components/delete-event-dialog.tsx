"use client";

import { Button } from "@/components/ui/button";
import { useDeleteEvent } from "../hooks";
import type { EventRecord } from "../types";

export function DeleteEventDialog({ event, onClose, onSuccess, onError }: { event: EventRecord; onClose: () => void; onSuccess: (message: string) => void; onError: (message: string) => void }) {
  const mutation = useDeleteEvent();
  const remove = async () => { try { await mutation.mutateAsync(event.id); onSuccess("האירוע נמחק בהצלחה."); onClose(); } catch { onError("לא ניתן למחוק את האירוע. נסו שוב."); } };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-event-title"><div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl"><h2 id="delete-event-title" className="text-lg font-semibold text-foreground">מחיקת אירוע?</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">פעולה זו תמחק לצמיתות את האירוע של {event.clientName} ואת רשומות התשלום והשיבוץ הקשורות אליו.</p><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>ביטול</Button><Button type="button" variant="destructive" disabled={mutation.isPending} onClick={remove}>{mutation.isPending ? "מוחק..." : "מחיקת אירוע"}</Button></div></div></div>;
}
