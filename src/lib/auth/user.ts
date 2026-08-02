import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Validates the current request's access token before rendering protected UI. */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    redirect("/login");
  }

  return claims;
}
