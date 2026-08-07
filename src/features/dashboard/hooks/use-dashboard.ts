"use client";
import { useQuery } from "@tanstack/react-query";
import { getDashboardData } from "../services/dashboard-service";
export function useDashboard(month: string, includePayments = true) { return useQuery({ queryKey: ["dashboard", month, includePayments], queryFn: () => getDashboardData(month, includePayments) }); }
