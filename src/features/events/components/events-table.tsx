"use client";
import { useState } from "react";
import { flexRender, getCoreRowModel, getFilteredRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { CalendarDays, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney, paymentStatusLabels, translateStoredValue } from "@/lib/hebrew";
import type { EventRecord, PaymentStatus } from "../types";

type Props = { events: EventRecord[]; onNew: () => void; onEdit: (event: EventRecord) => void; onDelete: (event: EventRecord) => void };
const statusClass: Record<PaymentStatus, string> = { paid: "bg-emerald-50 text-emerald-700", partial: "bg-amber-50 text-amber-700", unpaid: "bg-slate-100 text-slate-600" };
const revenue = (event: EventRecord) => event.guestCount * event.pricePerGuest;

export function EventsTable({ events, onNew, onEdit, onDelete }: Props) {
  const [search, setSearch] = useState("");
  const columns: ColumnDef<EventRecord>[] = [
    { accessorKey: "eventDate", header: "תאריך", cell: ({ row }) => formatDate(row.original.eventDate) }, { accessorKey: "startTime", header: "שעה" }, { accessorKey: "venueName", header: "אולם" },
    { accessorKey: "clientName", header: "שם איש קשר" }, { accessorKey: "guestCount", header: "מספר אורחים" }, { accessorKey: "packageType", header: "חבילת בר", cell: ({ row }) => translateStoredValue(row.original.packageType) },
    { accessorKey: "paymentStatus", header: "סטטוס תשלום", cell: ({ row }) => <Status event={row.original} /> },
    { id: "revenue", header: "הכנסה צפויה", cell: ({ row }) => formatMoney(revenue(row.original)) },
    { id: "actions", header: "", cell: ({ row }) => <div className="flex justify-end gap-1"><Button type="button" size="icon-xs" variant="ghost" onClick={() => onEdit(row.original)} aria-label={`עריכת ${row.original.clientName}`}><Pencil /></Button><Button type="button" size="icon-xs" variant="ghost" onClick={() => onDelete(row.original)} aria-label={`מחיקת ${row.original.clientName}`}><Trash2 className="text-destructive" /></Button></div> },
  ];
  const table = useReactTable({ data: events, columns, state: { globalFilter: search }, onGlobalFilterChange: setSearch, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), globalFilterFn: "includesString" });
  const rows = table.getRowModel().rows;
  return <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
    <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש אירועים..." aria-label="חיפוש אירועים" className="h-9 w-full rounded-lg border border-input bg-background pr-9 pl-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" /></div><div className="flex gap-2"><Button type="button" variant="outline"><CalendarDays data-icon="inline-start" />לוח שנה</Button><Button type="button" onClick={onNew}><Plus data-icon="inline-start" />אירוע חדש</Button></div></div>
    <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[940px] text-right text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground">{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} className="whitespace-nowrap px-5 py-3.5 font-medium">{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody className="divide-y divide-border">{rows.map((row) => <tr key={row.id} className="hover:bg-muted/30">{row.getVisibleCells().map((cell) => <td key={cell.id} className="whitespace-nowrap px-5 py-4">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>
    <div className="divide-y divide-border md:hidden">{rows.map((row) => { const event = row.original; return <article key={event.id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{event.clientName}</p><p className="mt-1 text-sm text-muted-foreground">{formatDate(event.eventDate)} · {event.startTime}</p></div><Status event={event} /></div><dl className="grid grid-cols-2 gap-2 text-sm"><Item label="אולם" value={event.venueName} /><Item label="הכנסה צפויה" value={formatMoney(revenue(event))} /><Item label="מספר אורחים" value={String(event.guestCount)} /><Item label="חבילת בר" value={translateStoredValue(event.packageType)} /></dl><div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onEdit(event)}><Pencil />עריכה</Button><Button type="button" size="sm" variant="destructive" onClick={() => onDelete(event)}><Trash2 />מחיקה</Button></div></article>; })}</div>
    {!rows.length && <div className="p-12 text-center"><p className="font-medium">לא נמצאו אירועים</p><p className="mt-1 text-sm text-muted-foreground">נסו חיפוש אחר או צרו אירוע חדש.</p></div>}
  </section>;
}
function Status({ event }: { event: EventRecord }) { return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass[event.paymentStatus]}`}>{paymentStatusLabels[event.paymentStatus]}</span>; }
function Item({ label, value }: { label: string; value: string }) { return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate">{value}</dd></div>; }
