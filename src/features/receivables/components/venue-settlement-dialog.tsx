"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/hebrew";
import { getIsraelDateOnly } from "@/features/dashboard/utils/dashboard-date-range";
import { settlementRequest } from "../hooks/use-venue-settlements";
import type { SettlementPreview, VenueSettlement } from "../utils/venue-settlements";

export function VenueSettlementDialog({ venueId, venueName, history }: { venueId: string; venueName: string; history: VenueSettlement[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const [cutoffDate, setCutoffDate] = useState(getIsraelDateOnly());
  const [includesHallFee, setIncludesHallFee] = useState(true);
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const requestId = useRef("");
  useEffect(() => { const element = dialog.current; return () => element?.close(); }, []);
  const latest = history.reduce((date, row) => row.cutoffDate > date ? row.cutoffDate : date, "");
  async function act(action: "preview" | "confirm") {
    setBusy(true); setError(""); setSuccess("");
    try {
      if (action === "preview") {
        setPreview(null); setConfirmed(false);
        const result = await settlementRequest<SettlementPreview>({ action, venueId, cutoffDate, includesHallFee });
        requestId.current = crypto.randomUUID(); setPreview(result);
      } else {
        await settlementRequest({ action, venueId, cutoffDate, includesHallFee, version: preview?.version, requestId: requestId.current });
        setPreview(null); setConfirmed(false); setSuccess("הסגירה נרשמה בהצלחה");
        await Promise.all(["venue-settlements", "receivables", "dashboard"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      }
    } catch (error) { setError(error instanceof Error ? error.message : "הפעולה נכשלה"); }
    finally { setBusy(false); }
  }
  return <>
    <Button ref={trigger} variant="outline" className="mt-3 w-full" onClick={() => { setIncludesHallFee(true); setError(""); setSuccess(""); setPreview(null); setConfirmed(false); dialog.current?.showModal(); }}>איפוס יתרה עד תאריך</Button>
    <dialog ref={dialog} dir="rtl" aria-labelledby={`settlement-title-${venueId}`} aria-describedby={`settlement-help-${venueId}`} onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={() => trigger.current?.focus()} className="fixed inset-0 m-auto max-h-[90vh] w-[min(95vw,36rem)] overflow-y-auto rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/50">
      <h2 id={`settlement-title-${venueId}`} className="text-xl font-semibold">סגירת התחשבנות — {venueName}</h2>
      <p id={`settlement-help-${venueId}`} className="my-3 text-sm">סגירה מצטברת של כל האירועים עד התאריך הנבחר, בהתאם למצב העמלה שנבחר, ללא תלות במסננים. יתרות הלקוחות אינן משתנות.</p>
      <label className="block">תאריך סגירה (כולל)<input autoFocus type="date" value={cutoffDate} min={latest || undefined} max={getIsraelDateOnly()} disabled={busy} onChange={(event) => { setCutoffDate(event.target.value); setPreview(null); setConfirmed(false); setSuccess(""); }} className="my-2 block rounded border p-2" /></label>
      <label className="my-3 block">אופן הסגירה<select disabled={busy} value={String(includesHallFee)} onChange={(event) => { setIncludesHallFee(event.target.value === "true"); setPreview(null); setConfirmed(false); }} className="block border p-2"><option value="true">כולל עמלת אולם — סגירה נטו לאחר קיזוז העמלה</option><option value="false">ללא עמלת אולם — העמלה נשארת פתוחה בנפרד</option></select></label>
      <Button disabled={busy || !cutoffDate} onClick={() => void act("preview")}>הצגת תצוגה מקדימה</Button>
      {busy && <p role="status" className="mt-3">טוען…</p>}
      {error && <p role="alert" className="mt-3 text-red-600">{error}</p>}
      {success && <p role="status" className="mt-3 text-emerald-700">{success}</p>}
      {preview && <div className="my-4 space-y-2 rounded border p-3" aria-live="polite">
        <p>{preview.venueName} — עד {formatDate(preview.cutoffDate)}</p>
        <p>אירועים בהתחשבנות: {preview.eventCount}</p>
        <p>סכום אירועים לפני סגירות: {formatMoney(preview.rawAmount)}</p>
        <p>סגירות קודמות: {formatMoney(preview.previousAmount)}</p>
        <p>יתרת תשלומים מהאולם: {formatMoney(preview.paymentBalance)}</p>
        <p>סך עמלות פתוחות: {formatMoney(preview.hallFeeBalance)}</p>
        <p>עמלה שתישאר פתוחה: {formatMoney(preview.remainingHallFee)}</p>
        <p>יתרה שתישאר לאחר הסגירה: {formatMoney(preview.remainingBalance)}</p>
        <p className="font-semibold">סכום לסגירה: {formatMoney(preview.amount)}</p>
        <p>{preview.amount > 0 ? "האולם חייב לטאיו" : preview.amount < 0 ? "טאיו חייבת לאולם" : "היתרה מאופסת"}</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy || !preview.amount} onChange={(event) => setConfirmed(event.target.checked)} />אני מאשר/ת סגירת הסכום המוצג ורישומו בהיסטוריית ההתחשבנות</label>
        <Button disabled={busy || !confirmed || !preview.amount} onClick={() => void act("confirm")}>אישור סגירה</Button>
      </div>}
      <Button variant="outline" disabled={busy} className="mt-4" onClick={() => dialog.current?.close()}>סגירה</Button>
    </dialog>
    <details className="mt-3 text-sm"><summary className="cursor-pointer">היסטוריית סגירות ({history.length})</summary>
      {history.length ? <ul className="mt-2 space-y-2">{[...history].reverse().map((row) => <li key={row.id}>עד {formatDate(row.cutoffDate)}: {formatMoney(row.amount)} — {row.includesHallFee !== false ? "כולל עמלת אולם" : "ללא עמלת אולם"}<span className="block text-xs text-muted-foreground">נרשם: {formatDate(row.createdAt.slice(0, 10))}</span></li>)}</ul> : <p>טרם נרשמו סגירות</p>}
    </details>
  </>;
}
