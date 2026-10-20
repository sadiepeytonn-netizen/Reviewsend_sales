import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Reps can pick or change the outcome of their own calls from the last 7 days (the database enforces it). */
export const FIX_DAYS = 7;

/** `settled`: a call with no end time after 30 minutes is over. `fixFrom`: oldest call a rep may still fix. */
export function outcomeWindow() {
  const now = Date.now();
  return {
    settled: new Date(now - 30 * 60_000).toISOString(),
    fixFrom: new Date(now - FIX_DAYS * 86_400_000).toISOString(),
  };
}

/** How many of this rep's finished calls from the last 7 days still have no outcome. */
export async function countMissingOutcomes(db: SupabaseClient, repId: string): Promise<number> {
  const { settled, fixFrom } = outcomeWindow();
  const { count } = await db
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("rep_id", repId)
    .is("disposition", null)
    .gte("started_at", fixFrom)
    .or(`ended_at.not.is.null,started_at.lt.${settled}`);
  return count ?? 0;
}
