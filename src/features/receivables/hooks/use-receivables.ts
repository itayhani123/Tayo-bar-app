"use client";
import { useQuery } from "@tanstack/react-query";
import { listReceivables } from "../services/receivables-service";
export function useReceivables() { return useQuery({ queryKey: ["receivables"], queryFn: listReceivables }); }
