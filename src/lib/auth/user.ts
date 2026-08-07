import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "owner" | "manager";
export type UserProfile = { id: string; role: AppRole };

export const requireCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id, role").eq("id", authData.user.id).single();
  if (profileError || !profile || (profile.role !== "owner" && profile.role !== "manager")) throw new Error("Unauthorized: user profile or role is missing");
  return { user: authData.user, profile: profile as UserProfile, role: profile.role as AppRole };
});

export async function requireUser() { return (await requireCurrentUser()).user; }
export async function requireOwner() { const current = await requireCurrentUser(); if (current.role !== "owner") redirect("/dashboard"); return current; }
export async function assertOwner() { const current = await requireCurrentUser(); if (current.role !== "owner") throw new Error("Unauthorized"); return current; }
