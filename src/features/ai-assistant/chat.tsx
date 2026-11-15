"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, LoaderCircle, Send, Sparkles, Trash2 } from "lucide-react";
import type { AppRole } from "@/lib/auth/user";
import { ownerSuggestions, suggestions } from "./policy";
import type { Choice, ConversationMessage, ConversationReply } from "./conversation-types";
import { ConfirmationCard } from "./confirmation-card";
import { AttendanceCard, attendanceRequest } from "./attendance-card";
import { looksLikeAttendance, type AttendancePreview } from "./attendance";
import { AiClientError, newAiRequestId, requestAiJson, type SendDiagnostic } from "./client-transport";
import { AI_TRANSPORT_VERSION } from "./transport-version";

type Message = ConversationMessage;

export function AssistantChat({ role, userId = "preview", buildId = "local" }: { role: AppRole; userId?: string; buildId?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [attendanceMode, setAttendanceMode] = useState(false);
  const [attendanceImports, setAttendanceImports] = useState<{ id: string; text: string; preview: AttendancePreview }[]>([]);
  const [busyActions, setBusyActions] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [serverBusy, setServerBusy] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [clientError, setClientError] = useState("");
  const [diagnostic, setDiagnostic] = useState<SendDiagnostic | null>(null);
  const generation = useRef(0);
  const storageKey = `tayo-ai-conversation:${userId}:${role}`;
  const end = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const attendanceSequence = useRef(0);
  function recordDiagnostic(value: SendDiagnostic) { setDiagnostic(value); console.info("Tayo AI transport", value); }
  const attendanceMutation = useMutation({
    retry: false,
    mutationFn: async (text: string) => ({ text, preview: await attendanceRequest({ action: "extract", text }) as AttendancePreview }),
    onSuccess: ({ text, preview }) => { const id = `attendance-${++attendanceSequence.current}`; setAttendanceImports(current => [...current, { id, text, preview }]); setDraft(""); },
    onSettled: () => { lock.current = false; },
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (turn: { conversationId: string; message: string; requestId: string; selection?: { kind: string; id: string } }) => {
      controller.current = new AbortController();
      const data = await requestAiJson<ConversationReply>("/api/ai-assistant", { body: turn, requestId: turn.requestId, signal: controller.current.signal, diagnostic: recordDiagnostic });
      if (typeof data.answer !== "string" || !Array.isArray(data.messages)) throw new AiClientError("השרת החזיר תשובה במבנה לא תקין. יש לרענן את העמוד ולנסות שוב", "INVALID_CHAT_RESPONSE");
      return data;
    },
    onSuccess: result => setMessages(result.messages),
    onSettled: () => { lock.current = false; },
  });
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, mutation.isPending, attendanceImports, attendanceMutation.isPending]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restoreController = new AbortController();
    const startedAt = Date.now();
    const epoch = generation.current;
    async function restore() {
      try {
        const id = localStorage.getItem(storageKey);
        if (!id) return;
        const data = await requestAiJson<{ messages: Message[]; busy?: boolean; interrupted?: boolean }>(`/api/ai-assistant?conversationId=${encodeURIComponent(id)}`, { signal: restoreController.signal, timeoutMs: 12000 });
        if (!active || epoch !== generation.current) return;
        if (!Array.isArray(data.messages)) throw new AiClientError("לא ניתן לשחזר את השיחה: תשובת שרת לא תקינה", "INVALID_RESTORE_RESPONSE");
        if (data.busy && Date.now() - startedAt > 90000) throw new AiClientError("השיחה הקודמת עדיין עסוקה. אפשר לנסות שחזור נוסף או לפתוח שיחה חדשה", "RESTORE_BUSY_TIMEOUT");
        setConversationId(id);
        setMessages(data.messages);
        setServerBusy(Boolean(data.busy));
        if (data.interrupted) setRestoreError("הבקשה הקודמת לא הושלמה, אך הפרטים נשמרו. ניתן להמשיך את השיחה או לשלוח אותה שוב");
        if (data.busy) timer = setTimeout(() => void restore(), 2000);
      } catch (error) {
        if (active && epoch === generation.current) {
          if (error instanceof AiClientError && error.code === "HTTP_404") { try { localStorage.removeItem(storageKey); } catch {} }
          setServerBusy(false); setRestoreError(error instanceof AiClientError ? error.message : "לא ניתן לשחזר את השיחה כרגע. אפשר לפתוח שיחה חדשה");
        }
      } finally { if (active && epoch === generation.current) setRestoring(false); }
    }
    void restore();
    return () => { active = false; restoreController.abort(); if (timer) clearTimeout(timer); };
  }, [storageKey, restoreVersion]);
  function send(content: string, choice?: Choice) {
    const text = content.trim();
    setClientError("");
    if (!text) { setClientError("יש להזין הודעה לפני שליחה"); return; }
    if (lock.current || restoring || serverBusy || busyActions > 0) { setClientError("ההודעה לא נשלחה: מתבצעת פעולה או שחזור שיחה. המתינו לסיום או פתחו שיחה חדשה"); return; }
    if (!choice && (attendanceMode || looksLikeAttendance(text))) {
      if (text.length > 12000) { setClientError("רשימת נוכחות מוגבלת ל־12,000 תווים"); return; }
      lock.current = true; attendanceMutation.mutate(text); return;
    }
    if (text.length > 2000) { setClientError("ההודעה לא נשלחה: הודעת צ׳אט מוגבלת ל־2,000 תווים. לרשימת שעות סמנו קליטת נוכחות"); return; }
    setDiagnostic({ stage: "preparing" });
    let id: string, requestId: string;
    try { id = conversationId ?? newAiRequestId(); requestId = newAiRequestId(); }
    catch (error) { setClientError(error instanceof AiClientError ? error.message : "ההודעה לא נשלחה עקב תקלה בדפדפן"); setDiagnostic({ stage: "failed", code: "CLIENT_PREPARATION_FAILED" }); return; }
    lock.current = true;
    const next: Message[] = [...messages, { role: "user", content: text }];
    setConversationId(id);
    try { localStorage.setItem(storageKey, id); } catch { /* Server still persists the conversation if browser storage is unavailable. */ }
    setMessages(next);
    setDraft("");
    setRestoreError("");
    mutation.mutate({ conversationId: id, message: text, requestId, ...(choice ? { selection: { kind: choice.kind, id: choice.id } } : {}) });
  }
  return <section dir="rtl" className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-5 text-right">
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white"><Sparkles className="size-6" /></span><div><h1 className="text-2xl font-semibold tracking-tight">Tayo AI</h1><p className="mt-1 text-sm text-slate-500">העוזר החכם של טאיו • {role === "owner" ? "תפעול וכספים" : "תפעול אירועים"}</p></div></div>
      <button type="button" disabled={mutation.isPending || attendanceMutation.isPending || busyActions > 0 || (!messages.length && !attendanceImports.length && !restoreError && !restoring && !serverBusy)} onClick={() => { generation.current++; setMessages([]); setAttendanceImports([]); setClientError(""); setDiagnostic(null); setRestoreVersion(n => n + 1); attendanceMutation.reset(); setConversationId(null); setRestoreError(""); setRestoring(false); setServerBusy(false); try { localStorage.removeItem(storageKey); } catch {} mutation.reset(); }} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border bg-white px-3 text-sm disabled:opacity-40" aria-label="פתיחת שיחה חדשה"><Trash2 className="size-4" /><span className="hidden sm:inline">שיחה חדשה</span></button>
    </header>
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div role="log" aria-label="שיחה עם Tayo AI" aria-live="polite" aria-busy={mutation.isPending || attendanceMutation.isPending || restoring || serverBusy} className="h-[48dvh] min-h-64 space-y-5 overflow-y-auto overscroll-contain p-4 sm:h-[52dvh] sm:p-6">
        {!messages.length && <div className="grid min-h-48 place-items-center text-center"><div><Bot className="mx-auto mb-4 size-9 text-slate-400" /><h2 className="text-lg font-medium">מה תרצו לדעת על העסק?</h2><p className="mt-2 text-sm leading-6 text-slate-500">שאלו בעברית על אירועים, אולמות ושיבוצים{role === "owner" ? ", וגם על הכנסות ויתרות" : ""}.</p></div></div>}
        {messages.map((message, index) => <article key={index} className={`flex ${message.role === "user" ? "justify-start" : "justify-end"}`}><div className={`min-w-0 max-w-[95%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-7 [overflow-wrap:anywhere] sm:max-w-[88%] ${message.role === "user" ? "bg-slate-950 text-white" : "border border-slate-100 bg-slate-50 text-slate-800"}`}><p className="mb-1 text-xs opacity-60">{message.role === "user" ? "אתם" : "Tayo AI"}</p>{message.content}{message.proposals?.map(proposal => <ConfirmationCard key={proposal.id} proposal={proposal} onBusyChange={busy => setBusyActions(n => Math.max(0, n + (busy ? 1 : -1)))} />)}{message.choices?.length ? <div className="mt-3 flex flex-wrap gap-2" aria-label="אפשרויות לבחירה">{message.choices.map(choice => <button key={`${choice.kind}:${choice.id}`} type="button" disabled={index !== messages.length - 1 || mutation.isPending || attendanceMutation.isPending || serverBusy} onClick={() => send(choice.label, choice)} className="min-h-11 max-w-full whitespace-normal rounded-lg border bg-white px-3 py-2 text-right text-sm">{choice.label}</button>)}</div> : null}</div></article>)}
        {(mutation.isPending || attendanceMutation.isPending || restoring || serverBusy) && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{restoring ? "משחזר את השיחה…" : "בודק את הנתונים ומכין תשובה…"}</p>}
        {attendanceImports.map(item => <article key={item.id}><p className="whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-sm text-white">{item.text}</p><AttendanceCard initial={item.preview} onBusyChange={busy => setBusyActions(n => Math.max(0, n + (busy ? 1 : -1)))} /><button type="button" className="min-h-11 text-sm underline" onClick={() => { setDraft(item.text); setAttendanceMode(true); }}>עריכת הודעת המקור ותאריך האירוע</button></article>)}
        {attendanceMutation.isPending && <p role="status">מפענח רשימת נוכחות ומאתר אירוע קיים…</p>}
        <div ref={end} />
      </div>
      <div className="border-t p-4 sm:p-5">
        {clientError && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{clientError}</p>}
        {restoreError && <div role="alert" className="mb-3 text-sm text-red-700">{restoreError}<button type="button" className="mr-2 min-h-11 underline" onClick={() => { setRestoreError(""); setRestoring(true); setRestoreVersion(n => n + 1); }}>נסה לשחזר שוב</button></div>}
        {mutation.isError && <div role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{mutation.error instanceof Error ? mutation.error.message : "החיבור הופסק או שהבקשה ארכה מדי. נסו שוב"}<button type="button" className="mr-3 min-h-11 underline" onClick={() => { const last = messages.at(-1); if (last?.role === "user") { setDraft(last.content); setMessages(current => current.slice(0, -1)); mutation.reset(); } }}>עריכה וניסיון חוזר</button></div>}
        <label className="mb-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={attendanceMode} onChange={e => setAttendanceMode(e.target.checked)} />קליטת רשימת נוכחות (גם אם חסרות כותרות או שעות)</label>
        {attendanceMutation.isError && <p role="alert" className="mb-2 text-sm text-red-700">{attendanceMutation.error.message}</p>}
        <form onSubmit={event => { event.preventDefault(); send(draft); }} className="flex items-end gap-2">
          <label className="min-w-0 flex-1"><span className="sr-only">השאלה שלך ל־Tayo AI</span><textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={12000} rows={2} disabled={mutation.isPending || attendanceMutation.isPending || restoring || serverBusy || busyActions > 0} placeholder="שאלו שאלה או הדביקו רשימת נוכחות עם אולם ותאריך" className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-base outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-60" /></label>
          <button type="submit" disabled={mutation.isPending || attendanceMutation.isPending || restoring || serverBusy || busyActions > 0 || !draft.trim()} aria-label="שליחת שאלה" className="mb-1 grid size-12 shrink-0 place-items-center rounded-xl bg-slate-950 text-white disabled:opacity-40"><Send className="size-5 rotate-180" /></button>
        </form>
        <p className="mt-2 text-xs leading-5 text-slate-500">כל שינוי מחייב אישור בכרטיס נפרד. ניתן לשחזר את השיחה והטיוטה במשך 24 שעות מהפעילות האחרונה, רק למשתמש ולתפקיד הנוכחיים.</p>
        <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer py-2">אבחון שליחה</summary><p dir="ltr" className="break-all text-left">{AI_TRANSPORT_VERSION} · build: {buildId}</p>{diagnostic && <><p>{diagnostic.stage === "preparing" ? "מכין בקשה בדפדפן" : diagnostic.stage === "sending" ? "מתבצע ניסיון שליחה לשרת" : diagnostic.stage === "received" ? "התקבלה תשובת HTTP מהשרת" : diagnostic.status ? "התקבלה שגיאת HTTP מהשרת" : "לא התקבלה תשובת HTTP"}</p><p dir="ltr" className="break-all text-left">POST /api/ai-assistant · {diagnostic.requestId ?? "no-request-id"}{diagnostic.status ? ` · HTTP ${diagnostic.status}` : ""}{diagnostic.code ? ` · ${diagnostic.code}` : ""}{diagnostic.serverVersion ? ` · server: ${diagnostic.serverVersion}` : ""}</p></>}</details>
      </div>
    </div>
    <div className="flex flex-wrap gap-2" aria-label="שאלות מוצעות">{["תוסיף אירוע למחר", ...suggestions, ...(role === "owner" ? ownerSuggestions : [])].map(question => <button key={question} type="button" disabled={mutation.isPending || attendanceMutation.isPending || restoring || serverBusy || busyActions > 0} onClick={() => send(question)} className="min-h-11 max-w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-right text-sm leading-6 text-slate-600 hover:border-slate-400 hover:text-slate-950 disabled:opacity-40">{question}</button>)}</div>
  </section>;
}
