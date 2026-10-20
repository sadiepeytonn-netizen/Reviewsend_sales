"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Admin stars (or un-stars) a recording for the reps to study, with an optional note on why. */
export async function setRecordingStar(callId: string, starred: boolean, note?: string): Promise<{ error?: string }> {
  const me = await requireAdmin();
  const id = z.uuid().safeParse(callId);
  if (!id.success) return { error: "Recording not found." };
  const { error } = await createAdminClient()
    .from("calls")
    .update(
      starred
        ? { starred_at: new Date().toISOString(), starred_by: me.id, star_note: note?.trim().slice(0, 500) || null }
        : { starred_at: null, starred_by: null, star_note: null },
    )
    .eq("id", id.data);
  if (error) return { error: "Couldn't save the star." };
  revalidatePath("/recordings");
  return {};
}
