"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { DEFAULT_PLAN } from "@/lib/commission";
import { temporaryPassword } from "@/lib/passwords";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = {
  error?: string;
  success?: string;
  tempPassword?: string;
  email?: string;
  // What was typed, so the form keeps it after an error
  values?: Record<string, string>;
};

const roleSchema = z.enum(["rep", "admin"]);

function planRow(repId: string, createdBy: string, plan = DEFAULT_PLAN) {
  return {
    rep_id: repId,
    created_by: createdBy,
    first_month_pct_with_setup: plan.firstMonthPctWithSetup,
    first_month_pct_without_setup: plan.firstMonthPctWithoutSetup,
    residual_kind: plan.residualKind,
    residual_value: plan.residualValue,
    small_deal_max_monthly: plan.smallDealMaxMonthly,
    small_deal_first_month_pct: plan.smallDealFirstMonthPct,
    small_deal_gets_residual: plan.smallDealGetsResidual,
  };
}

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const values = {
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? "rep"),
  };
  const parsed = z
    .object({
      fullName: z.string().trim().min(1, "Enter the person's name."),
      email: z.email("Enter a valid email address."),
      role: roleSchema,
    })
    .safeParse({
      fullName: formData.get("fullName"),
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      role: formData.get("role"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  const { fullName, email, role } = parsed.data;
  const password = temporaryPassword();
  const supabase = createAdminClient();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    return {
      error: error?.code === "email_exists" ? "Someone with that email already exists." : `Couldn't add user: ${error?.message}`,
      values,
    };
  }

  // The database creates every new login as a turned-off rep; switch this
  // one on since an admin added them.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName, role, active: true, must_change_password: true })
    .eq("id", data.user.id);
  if (profileError) return { error: `User was created but couldn't be set up: ${profileError.message}`, values };

  if (role === "rep") {
    await supabase.from("commission_plans").insert(planRow(data.user.id, admin.id));
  }

  revalidatePath("/admin/users");
  return { success: `${fullName} was added.`, tempPassword: password, email };
}

export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const userId = z.uuid().parse(formData.get("userId"));
  const password = temporaryPassword();
  const supabase = createAdminClient();

  const { data, error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) return { error: `Couldn't reset the password: ${error.message}` };

  await supabase.from("profiles").update({ must_change_password: true }).eq("id", userId);
  revalidatePath(`/admin/users/${userId}`);
  return { success: "Password reset.", tempPassword: password, email: data.user.email };
}

export async function setActive(formData: FormData) {
  const admin = await requireAdmin();
  const userId = z.uuid().parse(formData.get("userId"));
  const active = formData.get("active") === "true";
  if (userId === admin.id) return; // never lock yourself out

  const supabase = createAdminClient();
  // A ban signs them out everywhere and blocks logging in; the profile flag
  // blocks their data access even if a session is still open.
  await supabase.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  await supabase.from("profiles").update({ active }).eq("id", userId);

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ userId: z.uuid(), fullName: z.string().trim().min(1, "Enter a name."), role: roleSchema })
    .safeParse({ userId: formData.get("userId"), fullName: formData.get("fullName"), role: formData.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { userId, fullName, role } = parsed.data;
  if (userId === admin.id && role !== "admin") return { error: "You can't remove your own admin access." };

  const supabase = createAdminClient();
  const { error } = await supabase.from("profiles").update({ full_name: fullName, role }).eq("id", userId);
  if (error) return { error: error.message };

  if (role === "rep") {
    const { count } = await supabase
      .from("commission_plans")
      .select("id", { count: "exact", head: true })
      .eq("rep_id", userId);
    if (!count) await supabase.from("commission_plans").insert(planRow(userId, admin.id));
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { success: "Saved." };
}

const pct = z.coerce.number().min(0, "Percent can't be negative.").max(100, "Percent can't be over 100.");

export async function saveCommissionPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      userId: z.uuid(),
      firstMonthPctWithSetup: pct,
      firstMonthPctWithoutSetup: pct,
      residualKind: z.enum(["none", "flat", "percent"]),
      residualValue: z.coerce.number().min(0),
      smallDealMaxMonthly: z.coerce.number().min(0),
      smallDealFirstMonthPct: pct,
      smallDealGetsResidual: z.boolean(),
    })
    .safeParse({
      userId: formData.get("userId"),
      firstMonthPctWithSetup: formData.get("firstMonthPctWithSetup"),
      firstMonthPctWithoutSetup: formData.get("firstMonthPctWithoutSetup"),
      residualKind: formData.get("residualKind"),
      residualValue: formData.get("residualValue") || 0,
      smallDealMaxMonthly: formData.get("smallDealMaxMonthly"),
      smallDealFirstMonthPct: formData.get("smallDealFirstMonthPct"),
      smallDealGetsResidual: formData.get("smallDealGetsResidual") === "on",
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { userId, ...plan } = parsed.data;
  if (plan.residualKind === "percent" && plan.residualValue > 100) {
    return { error: "A percent residual can't be over 100%." };
  }

  // Always a new row: past sales keep the plan that applied when they were made.
  const { error } = await createAdminClient().from("commission_plans").insert(planRow(userId, admin.id, plan));
  if (error) return { error: error.message };

  revalidatePath(`/admin/users/${userId}`);
  return { success: "New plan saved. It applies to sales from now on." };
}

const coachingSchema = z.object({
  userId: z.uuid(),
  field: z.enum(["can_listen", "can_whisper", "can_barge"]),
  value: z.enum(["true", "false"]),
});

/** Turn a rep's listen / whisper / barge permission on or off. */
export async function setCoaching(formData: FormData) {
  await requireAdmin();
  const p = coachingSchema.parse({ userId: formData.get("userId"), field: formData.get("field"), value: formData.get("value") });
  const supabase = createAdminClient();
  await supabase.from("profiles").update({ [p.field]: p.value === "true" }).eq("id", p.userId);
  revalidatePath(`/admin/users/${p.userId}`);
}
