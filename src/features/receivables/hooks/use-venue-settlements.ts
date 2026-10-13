"use client";
import { useQuery } from "@tanstack/react-query";
import type { VenueSettlement } from "../utils/venue-settlements";

export async function settlementRequest<T>(input?: object): Promise<T> {
  const response = await fetch("/api/venue-settlements", input ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  } : { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "לא ניתן לטעון סגירות");
  return body;
}
export function useVenueSettlements() {
  return useQuery({ queryKey: ["venue-settlements"], queryFn: () => settlementRequest<VenueSettlement[]>() });
}
