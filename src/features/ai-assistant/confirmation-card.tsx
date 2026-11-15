"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import type { ActionResult, ProposalCard } from "./action-types";

export function ConfirmationCard({ proposal, onBusyChange }: { proposal: ProposalCard; onBusyChange?: (busy: boolean) => void }) {
  const cache = useQueryClient();
  const lock = useRef(false);
  const [expired, setExpired] = useState(() => Date.parse(proposal.expiresAt) <= Date.now());
  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Date.parse(proposal.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [proposal.expiresAt]);
  const mutation = useMutation({
    retry: false,
    mutationFn: async (decision: "confirm" | "cancel") => {
      const response = await fetch("/api/ai-assistant/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId: proposal.id, decision }), signal: AbortSignal.timeout(60000), cache: "no-store", redirect: "error" });
      const body = await response.json() as ActionResult & { error?: string; warning?: string };
      if (!body.status) throw new Error(body.error || "לא התקבלה תוצאה. ניתן לנסות שוב את אותו אישור");
      return body;
    },
    onSuccess: async result => {
      if (result.status === "succeeded") await Promise.all(["events", "event-assignments", "event-payments", "calendar-staffing", "calendar-finance-statuses", "dashboard", "payroll", "receivables", "venue-settlements", "income-events", "app-notifications"].map(key => cache.invalidateQueries({ queryKey: [key] })));
    },
    onSettled: () => { lock.current = false; onBusyChange?.(false); },
  });
  const result = mutation.data ?? proposal.result;
  const done = Boolean(result);
  function decide(decision: "confirm" | "cancel") {
    if (lock.current || done) return;
    lock.current = true;
    onBusyChange?.(true);
    mutation.mutate(decision);
  }
  const storedMessages = { succeeded: "הפעולה בוצעה ונשמרה בהצלחה", cancelled: "ההצעה בוטלה ולא תבוצע", expired: "תוקף ההצעה פג", stale: "הנתונים השתנו; יש להכין הצעה חדשה", failed: "הפעולה לא בוצעה", forbidden: "אין הרשאה לפעולה זו" };
  return <section dir="rtl" aria-label={`אישור ${proposal.title}`} className="mt-4 min-w-0 max-w-full overflow-hidden rounded-xl border border-amber-200 bg-white text-right text-slate-900" aria-busy={mutation.isPending}>
    <header className="border-b border-amber-100 bg-amber-50 p-4"><p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 shrink-0" />{proposal.title}</p><p className="mt-1 break-words text-sm">{proposal.target}</p><p className="mt-2 text-xs text-slate-500">תוקף האישור: {new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(new Date(proposal.expiresAt))}</p></header>
    <div className="space-y-3 p-4">{proposal.rows.map((row, index) => <div key={index} className="grid min-w-0 gap-1 border-b border-slate-100 pb-3 text-sm last:border-0"><p className="font-medium">{row.label}</p><div className="grid min-w-0 grid-cols-2 gap-3"><p className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"><span className="block text-xs text-slate-400">לפני</span>{row.before}</p><p className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"><span className="block text-xs text-slate-400">אחרי</span>{row.after}</p></div></div>)}
      {proposal.warnings.map((warning, index) => <p key={index} className="text-xs leading-5 text-slate-500">{warning}</p>)}
      {mutation.isPending && <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />{mutation.variables === "cancel" ? "מבטל הצעה…" : "בודק ומבצע…"}</p>}
      {mutation.isError && <p role="alert" className="text-sm text-red-700">{mutation.error instanceof Error ? mutation.error.message : "החיבור הופסק. ניתן לנסות שוב את אותו אישור"}</p>}
      {result && <div role={result.status === "succeeded" || result.status === "cancelled" ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${result.status === "succeeded" ? "bg-emerald-50 text-emerald-800" : result.status === "cancelled" ? "bg-slate-50" : "bg-red-50 text-red-800"}`}><p>{result.message || ("error" in result ? result.error as string : null) || storedMessages[result.status]}</p>{"warning" in result && !!result.warning && <p className="mt-2">{String(result.warning)}</p>}{result.status === "succeeded" && result.href && <Link href={result.href} className="mt-2 inline-flex min-h-11 items-center underline">פתיחת הרשומה המעודכנת</Link>}</div>}
      {!done && <div className="flex flex-wrap gap-2"><button type="button" disabled={mutation.isPending || (expired && !mutation.isError)} onClick={() => decide("confirm")} className="min-h-11 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">אשר ובצע</button><button type="button" disabled={mutation.isPending} onClick={() => decide("cancel")} className="min-h-11 rounded-lg border px-4 py-2 text-sm disabled:opacity-40">ביטול</button></div>}
      {expired && !done && !mutation.isError && <p role="status" className="text-sm text-amber-800">תוקף ההצעה פג. יש לבקש הצעה חדשה.</p>}
    </div>
  </section>;
}
