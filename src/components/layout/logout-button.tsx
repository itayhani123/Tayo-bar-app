"use client";

import { useActionState } from "react";
import { logout, type LogoutState } from "@/lib/auth/actions";
import { Icon } from "@/components/ui/icon";
import type { AppRole } from "@/lib/auth/user";

const initialState: LogoutState = { error: null };
const roleLabels: Record<AppRole, string> = { owner: "בעלים", manager: "מנהל" };

export function LogoutButton({ role }: { role: AppRole }) {
  const [state, action, pending] = useActionState(logout, initialState);
  return <div className="mt-4 border-t border-slate-200 pt-4"><div className="mb-2 px-3 text-xs text-slate-500">תפקיד: {roleLabels[role]}</div><form action={action}><button type="submit" disabled={pending} className="flex w-full items-center gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"><Icon name="logout" className="size-5 shrink-0" /><span>{pending ? "מתנתק..." : "התנתקות"}</span></button></form>{state.error && <p role="alert" className="mt-2 px-3 text-xs leading-5 text-red-700">{state.error}</p>}</div>;
}
