"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Mark all of a rep's unpaid commission for a month as paid out (or undo). */
export async function setPaidOut(formData: FormData) {
  await requireAdmin();
  const repId = z.uuid().parse(formData.get("repId"));
  const month = z.string().regex(/^\d{4}-\d{2}$/).parse(formData.get("month"));
  const paid = formData.get("paid") === "true";
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const q = createAdminClient()
    .from("commissions")
    .update({ paid_out_at: paid ? new Date().toISOString() : null })
    .eq("rep_id", repId)
    .gte("period_start", start)
    .lt("period_start", end);
  await (paid ? q.is("paid_out_at", null) : q);
  revalidatePath("/admin/commissions");
}
