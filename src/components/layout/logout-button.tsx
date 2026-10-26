"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";
import type { AppRole } from "@/lib/auth/user";

const roleLabels: Record<AppRole, string> = { owner: "בעלים", manager: "מנהל" };
const logoutError = "לא ניתן להתנתק כרגע. נסה שוב.";

export function LogoutButton({ role }: { role: AppRole }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const inProgress = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    if (inProgress.current) return;
    inProgress.current = true;
    setPending(true);
    setError(null);

    try {
      const { error: signOutError } = await createClient().auth.signOut();
      if (signOutError) throw signOutError;

      // Stop in-flight queries before clearing user data and navigating away.
      await queryClient.cancelQueries();
      queryClient.clear();
      router.replace("/login");
      router.refresh();
    } catch {
      setError(logoutError);
      inProgress.current = false;
      setPending(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="mb-2 px-3 text-xs text-slate-500">תפקיד: {roleLabels[role]}</div>
      <button type="button" onClick={() => void handleLogout()} disabled={pending} aria-busy={pending} className="flex w-full items-center gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60">
        <LogOut aria-hidden="true" className="size-5 shrink-0" />
        <span>{pending ? "מתנתק..." : "התנתקות"}</span>
      </button>
      {error && <p role="alert" className="mt-2 px-3 text-xs leading-5 text-red-700">{error}</p>}
    </div>
  );
}
