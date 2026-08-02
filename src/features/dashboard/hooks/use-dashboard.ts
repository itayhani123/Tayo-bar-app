"use client";
import { useQuery } from "@tanstack/react-query";
import { getDashboardData } from "../services/dashboard-service";
export function useDashboard(month: string) { return useQuery({ queryKey: ["dashboard", month], queryFn: () => getDashboardData(month) }); }
