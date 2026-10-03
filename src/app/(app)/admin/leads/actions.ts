"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Puts every exhausted (too many no-answers) lead back in the dialing pool.
export async function recycleExhausted() {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.rpc("recycle_exhausted_leads", { p_list: null });
  revalidatePath("/admin/leads");
}
