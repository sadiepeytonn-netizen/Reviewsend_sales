"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cleanRow } from "@/lib/import/clean";
import { zonedDay, zonedMidnight } from "@/lib/stats";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Puts every exhausted (too many no-answers) lead back in the dialing pool.
export async function recycleExhausted() {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.rpc("recycle_exhausted_leads", { p_list: null });
  revalidatePath("/admin/leads");
}

export type AddLeadState = { error?: string; values?: Record<string, string> };

const ADD_FIELDS = ["contact_name", "business_name", "phone", "email", "website", "address", "city", "state", "category", "google_profile_url", "import_notes"] as const;

/**
 * Adds one lead by hand. It goes through the same checks as a CSV import (valid phone,
 * Do Not Call, duplicates fill in blanks, time zone and EAST/WEST list), filed under a
 * daily "Added by hand" import so it shows in Import history.
 */
export async function addLead(_prev: AddLeadState, formData: FormData): Promise<AddLeadState> {
  const me = await requireAdmin();
  const values = Object.fromEntries(ADD_FIELDS.map((k) => [k, String(formData.get(k) ?? "").trim()]));
  const row = cleanRow(values);
  if (row.invalid_reason) return { error: row.invalid_reason, values };

  const db = createAdminClient();
  const today = zonedMidnight(zonedDay(new Date())).toISOString();
  const { data: existing } = await db
    .from("import_batches")
    .select("id, total_rows")
    .eq("file_name", "Added by hand")
    .gte("created_at", today)
    .limit(1)
    .maybeSingle();
  let batchId = existing?.id as string | undefined;
  if (!batchId) {
    const { data, error } = await db
      .from("import_batches")
      .insert({ file_name: "Added by hand", lead_source: "Manual", total_rows: 0, uploaded_by: me.id })
      .select("id")
      .single();
    if (error) return { error: error.message, values };
    batchId = data.id as string;
  }

  const { data, error } = await db.rpc("import_lead_rows", { p_batch_id: batchId, p_rows: [row] });
  if (error) return { error: error.message, values };
  await db.from("import_batches").update({ total_rows: (existing?.total_rows ?? 0) + 1 }).eq("id", batchId);

  const outcome = (data as { outcome: string; lead_id?: string; reason?: string }[])[0];
  if (outcome?.outcome === "dnc") return { error: "That number is on the Do Not Call list.", values };
  if (outcome?.outcome === "invalid") return { error: outcome.reason ?? "Check the phone number.", values };
  revalidatePath("/admin/leads");
  redirect(`/admin/leads/${outcome.lead_id}?${outcome.outcome === "merged" ? "merged" : "added"}=1`);
}

/** Move everything on one person's private list to another person, or into the shared pool. */
export async function moveList(formData: FormData) {
  await requireAdmin();
  const { z } = await import("zod");
  const from = z.uuid().parse(formData.get("from"));
  const toRaw = String(formData.get("to") ?? "");
  const to = toRaw ? z.uuid().parse(toRaw) : null;
  if (to === from) return;
  const supabase = await createClient();
  await supabase.rpc("reassign_list", { p_from: from, p_to: to });
  revalidatePath("/admin/leads");
}

/** Take leads out of dialing for good (they stay in the CRM so re-imports don't bring them back). */
export async function removeLeads(formData: FormData) {
  await requireAdmin();
  const { z } = await import("zod");
  const ids = formData.getAll("id").map((v) => z.uuid().parse(v));
  if (!ids.length) return;
  const supabase = await createClient();
  await supabase.rpc("remove_leads", { p_ids: ids });
  revalidatePath("/admin/leads");
  revalidatePath("/admin/leads/never-reached");
}
