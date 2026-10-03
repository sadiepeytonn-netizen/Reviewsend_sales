"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; email?: string };

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = schema.safeParse({
    email,
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message, email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "This account hasn't been confirmed yet. Ask your admin to check it in Supabase.", email };
    }
    if (error.code === "user_banned") {
      return { error: "Your account is turned off. Ask your admin to turn it back on.", email };
    }
    return { error: "That email and password don't match. Ask your admin if you need a reset.", email };
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
