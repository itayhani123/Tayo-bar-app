"use client";

import { useState } from "react";
import { flexRender, getCoreRowModel, getFilteredRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { CalendarDays, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EventRecord, PaymentStatus } from "../types";

type EventsTableProps = { events: EventRecord[]; onNew: () => void; onEdit: (event: EventRecord) => void; onDelete: (event: EventRecord) => void };

const statusClass: Record<PaymentStatus, string> = { paid: "bg-emerald-50 text-emerald-700", partial: "bg-amber-50 text-amber-700", unpaid: "bg-slate-100 text-slate-600" };
const statusLabel: Record<PaymentStatus, string> = { paid: "Paid", partial: "Partial", unpaid: "Unpaid" };
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });
const revenue = (event: EventRecord) => event.guestCount * event.pricePerGuest;

export function EventsTable({ events, onNew, onEdit, onDelete }: EventsTableProps) {
  const [search, setSearch] = useState("");
  const columns: ColumnDef<EventRecord>[] = [
    { accessorKey: "eventDate", header: "Date" }, { accessorKey: "startTime", header: "Time" }, { accessorKey: "venueName", header: "Venue" },
    { accessorKey: "clientName", header: "Client" }, { accessorKey: "guestCount", header: "Guests" }, { accessorKey: "packageType", header: "Package" },
    { accessorKey: "paymentStatus", header: "Payment Status", cell: ({ row }) => <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass[row.original.paymentStatus]}`}>{statusLabel[row.original.paymentStatus]}</span> },
    { id: "revenue", header: "Revenue", cell: ({ row }) => currency.format(revenue(row.original)) },
    { id: "actions", header: "", cell: ({ row }) => <div className="flex justify-end gap-1"><Button type="button" size="icon-xs" variant="ghost" onClick={() => onEdit(row.original)} aria-label={`Edit ${row.original.clientName}`}><Pencil /></Button><Button type="button" size="icon-xs" variant="ghost" onClick={() => onDelete(row.original)} aria-label={`Delete ${row.original.clientName}`}><Trash2 className="text-destructive" /></Button></div> },
  ];
  const table = useReactTable({ data: events, columns, state: { globalFilter: search }, onGlobalFilterChange: setSearch, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), globalFilterFn: "includesString" });
  const rows = table.getRowModel().rows;

  return <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
    <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events..." aria-label="Search events" className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" /></div>
      <div className="flex gap-2"><Button type="button" variant="outline"><CalendarDays data-icon="inline-start" />Calendar</Button><Button type="button" onClick={onNew}><Plus data-icon="inline-start" />New Event</Button></div>
    </div>
    <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[940px] text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground">{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} className="whitespace-nowrap px-5 py-3.5 font-medium">{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody className="divide-y divide-border">{rows.map((row) => <tr key={row.id} className="hover:bg-muted/30">{row.getVisibleCells().map((cell) => <td key={cell.id} className="whitespace-nowrap px-5 py-4">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>
    <div className="divide-y divide-border md:hidden">{rows.map((row) => { const event = row.original; return <article key={event.id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-foreground">{event.clientName}</p><p className="mt-1 text-sm text-muted-foreground">{event.eventDate} · {event.startTime}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass[event.paymentStatus]}`}>{statusLabel[event.paymentStatus]}</span></div><dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><div><dt className="text-muted-foreground">Venue</dt><dd className="mt-0.5 truncate">{event.venueName}</dd></div><div><dt className="text-muted-foreground">Revenue</dt><dd className="mt-0.5">{currency.format(revenue(event))}</dd></div><div><dt className="text-muted-foreground">Guests</dt><dd className="mt-0.5">{event.guestCount}</dd></div><div><dt className="text-muted-foreground">Package</dt><dd className="mt-0.5">{event.packageType}</dd></div></dl><div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onEdit(event)}><Pencil data-icon="inline-start" />Edit</Button><Button type="button" size="sm" variant="destructive" onClick={() => onDelete(event)}><Trash2 data-icon="inline-start" />Delete</Button></div></article>; })}</div>
    {!rows.length && <div className="p-12 text-center"><p className="font-medium text-foreground">No events found</p><p className="mt-1 text-sm text-muted-foreground">Try another search or create a new event.</p></div>}
  </section>;
}
