"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getIncomeTaxAdvanceRate, updateIncomeTaxAdvanceRate } from "../services/business-settings-service";
const key = ["business-settings", "income-tax-advance-rate"] as const;
export function useIncomeTaxAdvanceRate(enabled = true) { return useQuery({ queryKey: key, queryFn: getIncomeTaxAdvanceRate, enabled }); }
export function useUpdateIncomeTaxAdvanceRate() { const client = useQueryClient(); return useMutation({ mutationFn: updateIncomeTaxAdvanceRate, onSuccess: () => client.invalidateQueries({ queryKey: key }) }); }
