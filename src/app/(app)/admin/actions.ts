"use server";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { zonedDay, zonedMidnight } from "@/lib/stats";

export type FloorRow = {
  rep_id: string;
  name: string;
  status: "offline" | "idle" | "ready" | "on_call" | "wrap_up" | "paused";
  pause_reason: string | null;
  list: string | null;
  since: string | null;
  lead: string | null;
  dials_today: number;
};

/** Who's doing what right now. A rep whose page stopped checking in for 2+ minutes counts as offline. */
export async function getFloor(): Promise<FloorRow[]> {
  await requireAdmin();
  const supabase = await createClient();
  const today = zonedMidnight(zonedDay(new Date())).toISOString();
  const [{ data: reps }, { data: presence }, { data: calls }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").eq("active", true).eq("role", "rep").order("full_name"),
    supabase.from("rep_presence").select("rep_id, status, pause_reason, list, status_since, last_heartbeat_at, lead:leads!rep_presence_current_lead_id_fkey(business_name)"),
    supabase.from("calls").select("rep_id").gte("started_at", today),
  ]);
  const dials = new Map<string, number>();
  for (const c of calls ?? []) dials.set(c.rep_id, (dials.get(c.rep_id) ?? 0) + 1);

  type P = { rep_id: string; status: FloorRow["status"]; pause_reason: string | null; list: string | null; status_since: string; last_heartbeat_at: string | null; lead: { business_name: string } | null };
  const byRep = new Map(((presence ?? []) as unknown as P[]).map((p) => [p.rep_id, p]));
  const stale = (iso: string | null) => !iso || Date.now() - Date.parse(iso) > 2 * 60_000;

  return (reps ?? []).map((r) => {
    const p = byRep.get(r.id);
    const offline = !p || p.status === "offline" || stale(p.last_heartbeat_at);
    return {
      rep_id: r.id,
      name: r.full_name || r.email,
      status: offline ? "offline" : p!.status,
      pause_reason: offline ? null : p!.pause_reason,
      list: offline ? null : p!.list,
      since: offline ? p?.last_heartbeat_at ?? null : p!.status_since,
      lead: offline ? null : p!.lead?.business_name ?? null,
      dials_today: dials.get(r.id) ?? 0,
    };
  });
}
