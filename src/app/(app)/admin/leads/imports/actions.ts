"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Removes leads this import ADDED that nobody has touched yet (never dialed,
// not owned, still "new"). Blanks it filled in on existing leads stay filled.
export async function undoImport(formData: FormData) {
  await requireAdmin();
  const batchId = z.uuid().parse(formData.get("batchId"));
  const supabase = createAdminClient();

  const { data: removed } = await supabase
    .from("leads")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("status", "new")
    .eq("attempt_count", 0)
    .is("owner_id", null)
    .is("last_called_at", null)
    .select("id");

  await supabase
    .from("import_batches")
    .update({ undone_at: new Date().toISOString(), undone_count: removed?.length ?? 0 })
    .eq("id", batchId);

  revalidatePath("/admin/leads/imports");
  revalidatePath("/admin/leads");
}
