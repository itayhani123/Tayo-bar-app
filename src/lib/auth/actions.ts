"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LogoutState = { error: string | null };

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("יש להזין אימייל וסיסמה")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent("פרטי ההתחברות שגויים")}`);
  }

  redirect("/dashboard");
}

export async function logout(_previousState: LogoutState, _formData: FormData): Promise<LogoutState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) return { error: "לא ניתן להתנתק כרגע. נסה שוב." };

  revalidatePath("/", "layout");
  redirect("/login");
}
