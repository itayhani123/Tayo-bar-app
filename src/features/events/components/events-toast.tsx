"use client";

import { useEffect } from "react";

export function EventsToast({ kind, message, onDismiss }: { kind: "success" | "error"; message: string; onDismiss: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onDismiss, 5000); return () => window.clearTimeout(timer); }, [onDismiss]);
  return <div role="status" className={`fixed bottom-5 right-5 z-60 flex max-w-sm items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm shadow-lg ${kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}><span>{message}</span><button type="button" onClick={onDismiss} className="text-current opacity-70 hover:opacity-100" aria-label="Dismiss notification">×</button></div>;
}
