"use client";
import { useState } from "react";
import { LoaderCircle, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEmployees } from "@/features/employees";
import { formatMoney } from "@/lib/hebrew";
import { useEventAssignments } from "../hooks/use-event-staffing";
import type { EventAssignment } from "../types";
import { AssignEmployeeDialog } from "./assign-employee-dialog";
import { RemoveAssignmentDialog } from "./remove-assignment-dialog";
import { formatAssignmentTime, formatDuration, getAssignmentSalary, getWorkedMinutes } from "../calculations";

export function EventStaffingSection({ eventId, eventDate, guestCount, pricePerGuest, estimatedAlcoholCost, onSuccess, onError }: { eventId: string; eventDate: string; guestCount: number; pricePerGuest: number; estimatedAlcoholCost: number; onSuccess: (message: string) => void; onError: (message: string) => void }) {
  const assignments = useEventAssignments(eventId);
  const employees = useEmployees();
  const [dialog, setDialog] = useState<"create" | EventAssignment | null>(null);
  const [removing, setRemoving] = useState<EventAssignment | null>(null);
  const recommended = Math.ceil(Math.max(guestCount, 0) / 70) + 1;
  const assigned = assignments.data ?? [];
  const revenue = Math.max(guestCount, 0) * Math.max(pricePerGuest, 0);
  const staffCost = assigned.reduce((total, assignment) => total + (getAssignmentSalary(assignment) ?? 0), 0);
  const profit = revenue - staffCost - Math.max(estimatedAlcoholCost, 0);
  const assignedIds = new Set(assigned.map((item) => item.employeeId));
  const availableEmployees = (employees.data ?? []).filter((employee) => employee.active && !assignedIds.has(employee.id));
  const editEmployees = (employees.data ?? []).filter((employee) => employee.active);

  return <section className="border-t border-border pt-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">צוות האירוע</h3><div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground"><span>ברמנים מומלצים: <strong className="text-foreground">{recommended}</strong></span><span>משובצים בפועל: <strong className="text-foreground">{assigned.length}</strong></span></div></div><Button type="button" variant="outline" onClick={() => setDialog("create")} disabled={employees.isLoading || !availableEmployees.length}><Plus />הוסף עובד</Button></div>
    <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-4"><Summary label="הכנסה צפויה" value={formatMoney(revenue)} /><Summary label="עלות אלכוהול" value={formatMoney(estimatedAlcoholCost)} /><Summary label="עלות עובדים" value={formatMoney(staffCost)} /><Summary label="רווח צפוי" value={formatMoney(profit)} /></div>
    {assignments.isLoading || employees.isLoading ? <State><LoaderCircle className="size-4 animate-spin" />טוען את צוות האירוע...</State> : assignments.isError || employees.isError ? <div className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">לא ניתן לטעון את צוות האירוע. נסו שוב.</div> : assigned.length ? <div className="mt-5 overflow-hidden rounded-lg border border-border"><div className="divide-y divide-border">{assigned.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} onEdit={setDialog} onRemove={setRemoving} />)}</div></div> : <State><Users className="size-4" />אין עובדים משובצים</State>}
    {dialog && <AssignEmployeeDialog eventId={eventId} eventDate={eventDate} assignment={dialog === "create" ? undefined : dialog} employees={dialog === "create" ? availableEmployees : editEmployees} onClose={() => setDialog(null)} onSuccess={onSuccess} onError={onError} />}
    {removing && <RemoveAssignmentDialog assignment={removing} onClose={() => setRemoving(null)} onSuccess={onSuccess} onError={onError} />}
  </section>;
}

function AssignmentRow({ assignment, onEdit, onRemove }: { assignment: EventAssignment; onEdit: (assignment: EventAssignment) => void; onRemove: (assignment: EventAssignment) => void }) { const minutes = getWorkedMinutes(assignment.workStart, assignment.workEnd); const incomplete = Boolean(assignment.workStart) !== Boolean(assignment.workEnd); const duration = incomplete ? "חסרה שעת כניסה או יציאה" : minutes === null ? "טרם הוזנו שעות" : formatDuration(minutes); const salary = getAssignmentSalary(assignment); return <div className="p-4 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{assignment.employeeName}</p>{assignment.employeePhone && <p className="mt-0.5 text-xs text-muted-foreground">{assignment.employeePhone}</p>}</div><div className="flex gap-1"><Button type="button" size="icon-xs" variant="ghost" onClick={() => onEdit(assignment)} aria-label={`עריכת השיבוץ של ${assignment.employeeName}`}><Pencil /></Button><Button type="button" size="icon-xs" variant="ghost" onClick={() => onRemove(assignment)} aria-label={`הסרת ${assignment.employeeName}`}><Trash2 className="text-destructive" /></Button></div></div><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3"><Labeled label="תפקיד באירוע" value={assignment.eventRole === "bartender" ? "ברמן" : "מנהל אירוע"} /><Labeled label="סוג שכר" value={assignment.payType === "hourly" ? "שעתי" : "גלובלי"} /><Labeled label="תעריף / שכר גלובלי" value={assignment.payType === "hourly" ? `${formatMoney(assignment.hourlyRate ?? 0)} לשעה` : formatMoney(assignment.fixedPay ?? 0)} /><Labeled label="שעת כניסה" value={formatAssignmentTime(assignment.workStart)} /><Labeled label="שעת יציאה" value={formatAssignmentTime(assignment.workEnd)} /><Labeled label="משך עבודה" value={duration} /><Labeled label="שכר מחושב" value={salary === null ? "טרם ניתן לחשב" : formatMoney(salary)} /></div>{assignment.notes && <p className="mt-3 text-xs text-muted-foreground">הערות: {assignment.notes}</p>}</div>; }
function Labeled({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5">{value}</p></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>; }
function State({ children }: { children: React.ReactNode }) { return <div className="mt-5 flex min-h-20 items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{children}</div>; }
