"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string };

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireUser();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 10) return { error: "Use at least 10 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      error:
        error.code === "same_password"
          ? "Pick a password different from the temporary one."
          : `Couldn't change the password: ${error.message}`,
    };
  }

  // Reps can't edit their own profile row (so they can't change their role),
  // so this flag is cleared with the server's full-access client.
  await createAdminClient()
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", profile.id);

  redirect("/");
}
