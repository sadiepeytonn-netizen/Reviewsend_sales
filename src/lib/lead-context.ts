import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DialerCall, DialerLead, LeadContext } from "@/app/(app)/dialer/actions";

/** A lead with its notes and calls, read with whichever client the caller has already authorized. */
export async function readLeadContext(supabase: SupabaseClient, leadId: string): Promise<LeadContext | null> {
  const [{ data: lead }, { data: notes }, { data: calls }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", leadId).maybeSingle(),
    supabase.from("lead_notes").select("id, body, created_at, author:profiles(full_name, email)").eq("lead_id", leadId).order("created_at", { ascending: false }),
    supabase.from("calls").select("id, started_at, duration_seconds, disposition, recording_sid, recording_deleted_at, from_number, rep:profiles!calls_rep_id_fkey(full_name)").eq("lead_id", leadId).order("started_at", { ascending: false }).limit(300),
  ]);
  if (!lead) return null;
  type NoteRow = { id: string; body: string; created_at: string; author: { full_name: string; email: string } | null };
  type CallRow = Omit<DialerCall, "rep"> & { rep: { full_name: string } | null };
  return {
    lead: lead as DialerLead,
    notes: ((notes ?? []) as unknown as NoteRow[]).map((n) => ({
      id: n.id, body: n.body, created_at: n.created_at, author: n.author?.full_name || n.author?.email || "Someone",
    })),
    calls: ((calls ?? []) as unknown as CallRow[]).map((c) => ({ ...c, rep: c.rep?.full_name ?? "" })),
  };
}
