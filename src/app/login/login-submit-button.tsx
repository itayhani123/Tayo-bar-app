"use client";
import { useFormStatus } from "react-dom";

export function LoginSubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="w-full rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-3 focus:ring-slate-300 disabled:opacity-60">{pending ? "מתחבר..." : "התחברות"}</button>;
}
