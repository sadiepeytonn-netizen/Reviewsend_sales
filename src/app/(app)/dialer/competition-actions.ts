"use server";

import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { callPoints, competitionWeek, emptyTally, rank, totalPoints, type Tally } from "@/lib/competition";

export type BoardRow = { rep_id: string; name: string; points: number; place: number; isMe: boolean; tally: Tally | null };
export type Celebration = { id: string; text: string };
export type CompetitionData = {
  week: string;
  isAdmin: boolean;
  board: BoardRow[];
  celebrations: Celebration[];
  cursor: string;
};

/**
 * This week's points for every rep, plus any new appointments / sales to celebrate since `since`.
 * Reps see only each other's points; their own breakdown (and admins, everyone's) comes along too.
 */
export async function getCompetition(since: string | null): Promise<CompetitionData> {
  const me = await requireUser();
  const isAdmin = me.role === "admin";
  const cursor = new Date().toISOString();
  const week = competitionWeek();
  const from = week.from.toISOString();
  const to = week.to.toISOString();

  // Reps can't read each other's calls, so totals are worked out here and only points go back.
  const db = createAdminClient();
  const { data: reps } = await db.from("profiles").select("id, full_name, email").eq("active", true).eq("role", "rep");
  const repIds = (reps ?? []).map((r) => r.id);
  if (!repIds.length) return { week: week.label, isAdmin, board: [], celebrations: [], cursor };

  const [{ data: calls }, { data: dispos }, { data: showed }, { data: sales }] = await Promise.all([
    db.from("calls").select("rep_id, disposition, duration_seconds").in("rep_id", repIds).gte("started_at", from).lt("started_at", to),
    db.from("events").select("id, rep_id, lead_id, occurred_at, data").eq("type", "disposition").in("rep_id", repIds).gte("occurred_at", from).lt("occurred_at", to).order("occurred_at"),
    db.from("appointments").select("rep_id, lead_id").eq("status", "showed").in("rep_id", repIds).gte("starts_at", from).lt("starts_at", to),
    db.from("sales").select("id, rep_id, first_paid_at").in("rep_id", repIds).gte("first_paid_at", from).lt("first_paid_at", to),
  ]);

  type Dispo = { id: number; rep_id: string; lead_id: string | null; occurred_at: string; data: { disposition?: string } };
  const events = (dispos ?? []) as Dispo[];
  const apptEvents = events.filter((e) => e.data?.disposition === "appointment_set" && e.lead_id);

  // An appointment counts only the first time a lead is ever booked (re-books after a no-show don't).
  const apptLeads = [...new Set(apptEvents.map((e) => e.lead_id!))];
  const { data: earlier } = apptLeads.length
    ? await db.from("events").select("lead_id").eq("type", "disposition").in("lead_id", apptLeads).lt("occurred_at", from).filter("data->>disposition", "eq", "appointment_set")
    : { data: [] };
  const bookedBefore = new Set((earlier ?? []).map((e) => e.lead_id));

  const tallies = new Map(repIds.map((id) => [id, emptyTally()]));
  for (const c of calls ?? []) {
    const t = tallies.get(c.rep_id)!;
    const p = callPoints(c.disposition, c.duration_seconds);
    t.contacts += p.contact;
    t.talkPoints += p.talk;
    if (p.contact) t.talkSeconds += c.duration_seconds ?? 0;
  }
  for (const e of apptEvents) {
    if (bookedBefore.has(e.lead_id)) continue;
    bookedBefore.add(e.lead_id); // later re-books this week don't count either
    tallies.get(e.rep_id)!.appointments += 1;
  }
  const demos = new Set<string>();
  for (const a of showed ?? []) demos.add(`${a.rep_id}|${a.lead_id}`);
  for (const e of events) if (e.data?.disposition === "demo_completed" && e.lead_id) demos.add(`${e.rep_id}|${e.lead_id}`);
  for (const key of demos) tallies.get(key.split("|")[0])!.demos += 1;
  for (const s of sales ?? []) tallies.get(s.rep_id)!.sales += 1;

  const names = new Map((reps ?? []).map((r) => [r.id, r.full_name || r.email]));
  const board = rank(
    repIds.map((id) => ({ rep_id: id, name: names.get(id)!, points: totalPoints(tallies.get(id)!), isMe: id === me.id })),
  )
    .map((r) => ({ ...r, tally: r.isMe || isAdmin ? tallies.get(r.rep_id)! : null }))
    .sort((a, b) => a.place - b.place || a.name.localeCompare(b.name));

  // Pop-ups: new dialer appointments and newly paid sales since the last check.
  const celebrations: Celebration[] = [];
  const sinceMs = since ? Date.parse(since) : NaN;
  if (!Number.isNaN(sinceMs)) {
    const who = (id: string) => (id === me.id ? "You" : names.get(id) ?? "Someone");
    for (const e of apptEvents) {
      if (Date.parse(e.occurred_at) > sinceMs) celebrations.push({ id: `a${e.id}`, text: `${who(e.rep_id)} just set an appointment!` });
    }
    for (const s of sales ?? []) {
      if (s.first_paid_at && Date.parse(s.first_paid_at) > sinceMs) celebrations.push({ id: `s${s.id}`, text: `${who(s.rep_id)} just made a sale!` });
    }
  }
  return { week: week.label, isAdmin, board, celebrations, cursor };
}
