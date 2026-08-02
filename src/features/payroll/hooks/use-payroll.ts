"use client";
import { useQuery } from "@tanstack/react-query";
import { getMonthlyPayroll } from "../services/payroll-service";

export function useMonthlyPayroll(month: string) { return useQuery({ queryKey: ["payroll", month], queryFn: () => getMonthlyPayroll(month) }); }
