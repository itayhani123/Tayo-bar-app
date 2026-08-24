"use client";
import Link from "next/link";
import { useEvents } from "@/features/events/hooks";
import { salesStatusLabels } from "@/features/events/types";
import { translateStoredValue } from "@/lib/hebrew";
const active = new Set(["lead", "contacted", "proposal_sent", "waiting"]);
export function LeadsPage() {
  const query = useEvents(false);
  if (query.isLoading) return <p className="text-muted-foreground">טוען לידים...</p>;
  if (query.isError) return <p className="text-destructive">לא ניתן לטעון את הלידים.</p>;
  const leads = (query.data ?? []).filter((event) => event.salesStatus && active.has(event.salesStatus));
  return <div className="mx-auto max-w-7xl space-y-6"><div><p className="text-sm text-muted-foreground">מכירות</p><h2 className="mt-1 text-2xl font-semibold">לידים / CRM</h2></div>{!leads.length ? <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">אין לידים פעילים.</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{leads.map((lead) => { const followUp = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null; const today = new Date(); const sameDay = followUp && followUp.toDateString() === today.toDateString(); const overdue = followUp && followUp < today && !sameDay; return <Link key={lead.id} href={`/events?event=${lead.id}`} className={`rounded-xl border bg-card p-5 shadow-sm transition hover:border-primary ${overdue ? "border-red-500 bg-red-50/50" : sameDay ? "border-amber-500 bg-amber-50/50" : "border-border"}`}><div className="flex justify-between gap-3"><h3 className="font-semibold">{lead.clientName}</h3><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{salesStatusLabels[lead.salesStatus!]}</span></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><Item label="טלפון" value={lead.clientPhone || "—"}/><Item label="תאריך אירוע" value={lead.eventDate}/><Item label="אולם" value={lead.venueName}/><Item label="סוג אירוע" value={translateStoredValue(lead.eventType)}/><Item label="מספר אורחים" value={String(lead.guestCount)}/><Item label="מקור ליד" value={lead.leadSource || "—"}/><Item label="מעקב הבא" value={followUp ? followUp.toLocaleString("he-IL") : "—"}/></dl></Link>; })}</div>}</div>;
}
function Item({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5">{value}</dd></div>; }
