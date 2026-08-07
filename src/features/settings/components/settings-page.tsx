"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIncomeTaxAdvanceRate, useUpdateIncomeTaxAdvanceRate } from "../hooks/use-business-settings";
import { taxAdvanceSchema } from "../validation";
import { WhatsAppSettingsCard } from "./whatsapp-settings-card";

export function SettingsPage({ isManager }: { isManager: boolean }) {
  const query = useIncomeTaxAdvanceRate(!isManager);
  const mutation = useUpdateIncomeTaxAdvanceRate();
  const [notice, setNotice] = useState("");
  const form = useForm<{ rate: number }>({ resolver: zodResolver(taxAdvanceSchema), defaultValues: { rate: 3.2 } });
  useEffect(() => { if (query.data !== undefined) form.reset({ rate: query.data }); }, [form, query.data]);

  if (isManager) return <div className="mx-auto max-w-3xl"><h2 className="text-2xl font-semibold">הגדרות</h2><p className="mt-3 text-sm text-muted-foreground">אין הגדרות זמינות לתפקיד זה.</p></div>;
  if (query.isLoading) return <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin" /></div>;

  return <div className="mx-auto max-w-3xl space-y-6"><div><h2 className="text-2xl font-semibold">הגדרות</h2><p className="mt-2 text-sm text-muted-foreground">הגדרות פיננסיות כלליות לעסק.</p></div><form className="rounded-xl border border-border bg-card p-6 shadow-sm" onSubmit={form.handleSubmit(async ({ rate }) => { try { await mutation.mutateAsync(rate); setNotice("ההגדרה נשמרה בהצלחה."); } catch { form.setError("rate", { message: "לא ניתן לשמור את ההגדרה." }); } })}><label className="block text-sm font-medium">מקדמת מס הכנסה (%)<input type="number" min="0" max="100" step="0.01" className="mt-1.5 h-10 w-full max-w-xs rounded-lg border border-input bg-background px-3" {...form.register("rate", { valueAsNumber: true })} /></label>{form.formState.errors.rate && <p className="mt-1 text-xs text-destructive">{form.formState.errors.rate.message}</p>}<p className="mt-3 text-xs text-muted-foreground">החישוב הוא הערכה ניהולית ואינו תחליף לחישוב רואה חשבון.</p><div className="mt-5 flex items-center gap-3"><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "שומר..." : "שמירה"}</Button>{notice && <span className="text-sm text-emerald-700">{notice}</span>}</div></form><WhatsAppSettingsCard /></div>;
}
