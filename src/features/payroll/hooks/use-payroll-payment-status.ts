"use client";
import { useEffect, useState } from "react";

const storageKey = "tayo-payroll-paid";
type PaidState = Record<string, string[]>;

export function usePayrollPaymentStatus(month: string) {
  const [state, setState] = useState<PaidState>({});
  useEffect(() => { try { const saved = window.localStorage.getItem(storageKey); if (saved) setState(JSON.parse(saved) as PaidState); } catch { setState({}); } }, []);
  const paidIds = new Set(state[month] ?? []);
  const setPaid = (employeeId: string, paid: boolean) => setState((current) => { const next = { ...current, [month]: paid ? [...new Set([...(current[month] ?? []), employeeId])] : (current[month] ?? []).filter((id) => id !== employeeId) }; window.localStorage.setItem(storageKey, JSON.stringify(next)); return next; });
  return { paidIds, setPaid };
}
