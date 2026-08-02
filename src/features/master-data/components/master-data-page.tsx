"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateMasterData, useDeleteMasterData, useMasterData, useUpdateMasterData } from "../hooks/use-master-data";
import type { MasterDataInput, MasterDataKind, MasterDataRecord } from "../types";
import { masterDataConfig } from "../types";
import { masterDataSchema } from "../validation";

export function MasterDataPage({ kind }: { kind: MasterDataKind }) {
  const config = masterDataConfig[kind];
  const query = useMasterData(kind);
  const [editing, setEditing] = useState<MasterDataRecord | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<MasterDataRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (query.isLoading) return <Loading title={config.title} />;
  if (query.isError) return <State title={config.title} message="Unable to load this master data. Check your permissions and try again." />;
  return <div className="mx-auto max-w-5xl space-y-6"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-muted-foreground">Settings</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">{config.title}</h2><p className="mt-2 text-sm text-muted-foreground">{config.description}</p></div><Button type="button" onClick={() => setEditing(null)}><Plus data-icon="inline-start" />New {config.singular}</Button></header>{notice && <div role="status" className="fixed bottom-5 right-5 z-60 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-lg">{notice}</div>}<MasterDataTable data={query.data ?? []} onEdit={setEditing} onDelete={setDeleting} />{editing !== undefined && <MasterDataForm kind={kind} record={editing} onClose={() => setEditing(undefined)} onSuccess={(message) => setNotice(message)} />}{deleting && <DeleteDialog kind={kind} record={deleting} onClose={() => setDeleting(null)} onSuccess={(message) => setNotice(message)} />}</div>;
}

function MasterDataTable({ data, onEdit, onDelete }: { data: MasterDataRecord[]; onEdit: (row: MasterDataRecord) => void; onDelete: (row: MasterDataRecord) => void }) {
  const columns: ColumnDef<MasterDataRecord>[] = [{ accessorKey: "name", header: "Name" }, { accessorKey: "createdAt", header: "Created", cell: ({ row }) => new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(row.original.createdAt)) }, { id: "actions", header: "", cell: ({ row }) => <div className="flex justify-end gap-1"><Button type="button" size="icon-xs" variant="ghost" onClick={() => onEdit(row.original)} aria-label={`Edit ${row.original.name}`}><Pencil /></Button><Button type="button" size="icon-xs" variant="ghost" onClick={() => onDelete(row.original)} aria-label={`Delete ${row.original.name}`}><Trash2 className="text-destructive" /></Button></div> }];
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  if (!data.length) return <State title="No records yet" message="Create your first record to make it available across the ERP." />;
  return <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><table className="w-full text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground">{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th className="px-5 py-3.5 font-medium" key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody className="divide-y divide-border">{table.getRowModel().rows.map((row) => <tr key={row.id} className="hover:bg-muted/30">{row.getVisibleCells().map((cell) => <td className="px-5 py-4" key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>;
}

function MasterDataForm({ kind, record, onClose, onSuccess }: { kind: MasterDataKind; record: MasterDataRecord | null; onClose: () => void; onSuccess: (message: string) => void }) {
  const config = masterDataConfig[kind]; const create = useCreateMasterData(kind); const update = useUpdateMasterData(kind); const form = useForm<MasterDataInput>({ resolver: zodResolver(masterDataSchema), defaultValues: { name: record?.name ?? "" } }); const saving = create.isPending || update.isPending;
  const submit = async (input: MasterDataInput) => { try { if (record) await update.mutateAsync({ id: record.id, input }); else await create.mutateAsync(input); onSuccess(`${config.singular} ${record ? "updated" : "created"} successfully.`); onClose(); } catch { form.setError("name", { message: "Unable to save. This name may already exist." }); } };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true"><form onSubmit={form.handleSubmit(submit)} className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl"><div className="flex items-center justify-between"><h3 className="font-semibold">{record ? `Edit ${config.singular}` : `New ${config.singular}`}</h3><Button type="button" variant="ghost" size="icon" onClick={onClose}><X /></Button></div><label className="mt-5 block text-sm font-medium">Name<input autoFocus className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-3 focus:ring-ring/20" {...form.register("name")} /></label>{form.formState.errors.name && <p className="mt-1 text-xs text-destructive">{form.formState.errors.name.message}</p>}<div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button></div></form></div>;
}

function DeleteDialog({ kind, record, onClose, onSuccess }: { kind: MasterDataKind; record: MasterDataRecord; onClose: () => void; onSuccess: (message: string) => void }) { const mutation = useDeleteMasterData(kind); const singular = masterDataConfig[kind].singular; const remove = async () => { try { await mutation.mutateAsync(record.id); onSuccess(`${singular} deleted successfully.`); onClose(); } catch { onClose(); } }; return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl"><h3 className="font-semibold">Delete {singular}?</h3><p className="mt-2 text-sm text-muted-foreground">This permanently removes “{record.name}”. Records already using it may be affected.</p><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" variant="destructive" disabled={mutation.isPending} onClick={remove}>{mutation.isPending ? "Deleting..." : "Delete"}</Button></div></div></div>; }
function Loading({ title }: { title: string }) { return <div className="grid min-h-80 place-items-center"><span className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading {title.toLowerCase()}...</span></div>; }
function State({ title, message }: { title: string; message: string }) { return <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border bg-card p-8 text-center"><div><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{message}</p></div></div>; }
