"use client";
import { Button } from "@/components/ui/button";
import { useSetEmployeeActive } from "../hooks/use-employees";
import type { Employee } from "../types";

export function EmployeeStatusDialog({ employee, onClose, onSuccess, onError }: { employee: Employee; onClose: () => void; onSuccess: (message: string) => void; onError: (message: string) => void }) {
  const mutation = useSetEmployeeActive();
  const nextActive = !employee.active;
  const apply = async () => { try { await mutation.mutateAsync({ id: employee.id, active: nextActive }); onSuccess(nextActive ? "העובד הופעל בהצלחה." : "העובד הושבת בהצלחה."); onClose(); } catch { onError("לא ניתן לעדכן את סטטוס העובד. נסו שוב."); } };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="employee-status-title"><div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl"><h2 id="employee-status-title" className="text-lg font-semibold">{nextActive ? "הפעלת עובד?" : "השבתת עובד?"}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{nextActive ? `${employee.fullName} יחזור להיות זמין לשיבוץ באירועים.` : `${employee.fullName} יישאר בהיסטוריה אך לא יהיה זמין לשיבוץ כברירת מחדל.`}</p><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>ביטול</Button><Button type="button" variant={nextActive ? "default" : "destructive"} disabled={mutation.isPending} onClick={apply}>{mutation.isPending ? "מעדכן..." : nextActive ? "הפעלה" : "השבתה"}</Button></div></div></div>;
}
