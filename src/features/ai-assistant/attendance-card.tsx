"use client";
import { useRef, useState } from "react";
import Link from "next/link.js";
import { useQueryClient } from "@tanstack/react-query";
import type { AttendancePreview, AttendanceRow } from "./attendance";
import { formatDuration } from "@/features/event-staffing/calculations";

export async function attendanceRequest(body: unknown) {
  const response = await fetch("/api/ai-assistant/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(55000), cache: "no-store", redirect: "error" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || "הפעולה לא הושלמה");
  return data;
}
const previous = (v: string | null) => v ? new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "—";
export function AttendanceCard({ initial, onBusyChange }: { initial: AttendancePreview; onBusyChange: (busy: boolean) => void }) {
  const cache = useQueryClient();
  const [preview, setPreview] = useState(initial);
  const [rows, setRows] = useState(initial.rows);
  const [eventId, setEventId] = useState(initial.eventId ?? "");
  const [allowNew, setAllowNew] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ message: string; eventId?: string } | null>(null);
  const lock = useRef(false);
  function edit(key: string, patch: Partial<AttendanceRow>) { setRows(current => current.map(r => r.key === key ? { ...r, ...patch } : r)); setDirty(true); }
  async function run(confirm: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError("");
    try {
      if (confirm) {
        if (dirty || !preview.proposalId) return;
        const saved = await attendanceRequest({ action: "confirm", proposalId: preview.proposalId, confirmed: true });
        setResult(saved);
        await Promise.all(["events", "event-assignments", "calendar-staffing", "calendar-finance-statuses", "dashboard", "payroll", "receivables", "income-events"].map(key => cache.invalidateQueries({ queryKey: [key] })));
      } else {
        const next = await attendanceRequest({ action: "preview", extracted: preview.extracted, correction: { eventId: eventId || null, rows: rows.map(({ key, employeeId, start, end, note }) => ({ key, employeeId, start, end, note })) }, allowNew }) as AttendancePreview;
        setPreview(next); setRows(next.rows); setEventId(next.eventId ?? ""); setDirty(false);
      }
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  const selected = preview.events.find(e => e.id === eventId);
  return <section aria-label="תצוגה מקדימה של נוכחות" className="mt-3 min-w-0 space-y-3 rounded-xl border bg-white p-3 text-slate-900" aria-busy={busy}>
    <h3 className="font-semibold">קליטת רשימת נוכחות — {rows.filter(r => r.employeeId).length} עובדים מזוהים</h3>
    <p className="text-xs">השעות לפי שעון ישראל. יציאה מוקדמת מהכניסה מסומנת ביום הבא. הערות תפקיד אינן משנות תפקיד או שכר.</p>
    <label className="block">אירוע קיים<select aria-label="בחירת אירוע" className="block min-h-11 w-full rounded border p-2" value={eventId} disabled={busy || !!result} onChange={e => { setEventId(e.target.value); setDirty(true); }}><option value="">יש לבחור אירוע</option>{preview.events.map(e => <option key={e.id} value={e.id}>{e.venueName} · {e.event_date} · {e.client_name}</option>)}</select></label>
    {selected && <p>{selected.venueName} · {selected.event_date}</p>}
    <div className="max-w-full overflow-x-auto"><table className="w-full text-right text-sm"><thead><tr>{["עובד", "כניסה", "יציאה", "שעות עבודה", "פעולה / שעות קיימות", "הערה"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.key} className="border-t align-top">
      <td className="min-w-40 p-2"><span className="block text-xs">{row.name}</span><select aria-label={`עובד עבור ${row.name}`} className="min-h-11 max-w-48 rounded border" value={row.employeeId ?? ""} disabled={busy || !!result} onChange={e => edit(row.key, { employeeId: e.target.value || null })}><option value="">בחירת עובד קיים</option>{preview.employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select>{row.candidates.length > 1 && <p className="text-xs text-amber-800">התאמה לא ודאית — נדרשת בחירה</p>}{row.issues.map((issue, i) => <p key={i} className="text-xs text-red-700">{issue}</p>)}</td>
      <td className="p-2"><input aria-label={`כניסה ${row.name}`} type="time" className="min-h-11 rounded border p-1" value={row.start} disabled={busy || !!result} onChange={e => edit(row.key, { start: e.target.value })} /></td>
      <td className="p-2"><input aria-label={`יציאה ${row.name}`} type="time" className="min-h-11 rounded border p-1" value={row.end} disabled={busy || !!result} onChange={e => edit(row.key, { end: e.target.value })} />{row.end && row.start && row.end < row.start && <span className="block text-xs">למחרת</span>}</td>
      <td className="p-2">{dirty ? "יש לבדוק מחדש" : row.minutes === null ? "חסר" : formatDuration(row.minutes)}</td>
      <td className="p-2">{row.operation === "create" ? "שיבוץ חדש (דורש אישור)" : "עדכון שיבוץ קיים"}{row.operation === "update" && <p className="text-xs">{previous(row.previousStart)} — {previous(row.previousEnd)}</p>}</td>
      <td className="p-2"><input aria-label={`הערה ${row.name}`} className="min-h-11 w-32 rounded border p-1" maxLength={500} value={row.note} disabled={busy || !!result} onChange={e => edit(row.key, { note: e.target.value })} /></td>
    </tr>)}</tbody></table></div>
    {preview.issues.map(issue => <p key={issue} className="text-sm text-amber-800">{issue}</p>)}
    {rows.some(r => r.operation === "create") && !result && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowNew} disabled={busy} onChange={e => { setAllowNew(e.target.checked); setDirty(true); }} />אני מאשר בנפרד להוסיף לאירוע את העובדים שמסומנים כשיבוץ חדש, בתנאי השיבוץ הרגילים שלהם</label>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {result ? <p role="status">{result.message} {result.eventId && <Link className="underline" href={`/events?event=${result.eventId}`}>פתיחת האירוע</Link>}</p> : <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded border px-3" disabled={busy} onClick={() => void run(false)}>בדוק את התיקונים והכן אישור</button><button type="button" className="min-h-11 rounded bg-slate-950 px-3 text-white disabled:opacity-40" disabled={busy || dirty || !preview.proposalId || !!preview.issues.length || rows.some(r => r.issues.length > 0)} onClick={() => void run(true)}>{busy ? "בודק ושומר…" : "אשר ושמור את כל השעות"}</button></div>}
  </section>;
}
