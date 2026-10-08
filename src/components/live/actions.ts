"use server";

import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowedModes, findConference, twilioClient, type MonitorMode } from "@/lib/twilio";
import { revalidatePath } from "next/cache";

export type LiveRep = {
  rep_id: string;
  name: string;
  status: "offline" | "idle" | "ready" | "on_call" | "wrap_up" | "paused";
  since: string | null;
  /** Set while the rep is on a call that can be listened to. */
  call: { id: string; answered: boolean; owner: string | null; business: string | null; phone: string; leadId: string | null } | null;
};

export type LiveData = { modes: MonitorMode[]; conference: boolean; isAdmin: boolean; reps: LiveRep[] };

/** The floor, for the sidebar's Live section. Only for people allowed to listen in. */
export async function getLive(): Promise<LiveData> {
  const me = await requireUser();
  const modes = allowedModes(me);
  if (!modes.length) return { modes, conference: false, isAdmin: false, reps: [] };

  // Allowed listeners see every rep's status (reps can't read each other's rows directly).
  const supabase = createAdminClient();
  const [{ data: people }, { data: presence }, { data: settings }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").eq("active", true).eq("role", "rep").neq("id", me.id).order("full_name"),
    supabase.from("rep_presence").select("rep_id, status, status_since, last_heartbeat_at, current_call_id"),
    supabase.from("settings").select("conference_calls").eq("id", 1).single(),
  ]);
  const callIds = (presence ?? []).map((p) => p.current_call_id).filter(Boolean) as string[];
  const { data: calls } = callIds.length
    ? await supabase
        .from("calls")
        .select("id, conference, answered_at, ended_at, to_number, lead_id, lead:leads(business_name, contact_name)")
        .in("id", callIds)
    : { data: [] };
  type C = { id: string; conference: boolean; answered_at: string | null; ended_at: string | null; to_number: string; lead_id: string | null; lead: { business_name: string; contact_name: string | null } | null };
  const callById = new Map(((calls ?? []) as unknown as C[]).map((c) => [c.id, c]));
  const byRep = new Map((presence ?? []).map((p) => [p.rep_id, p]));
  const stale = (iso: string | null) => !iso || Date.now() - Date.parse(iso) > 2 * 60_000;

  const reps: LiveRep[] = [];
  for (const person of people ?? []) {
    const p = byRep.get(person.id);
    const offline = !p || p.status === "offline" || stale(p.last_heartbeat_at);
    const c = !offline && p!.status === "on_call" && p!.current_call_id ? callById.get(p!.current_call_id) : undefined;
    reps.push({
      rep_id: person.id,
      name: person.full_name || person.email,
      status: offline ? "offline" : p!.status,
      since: offline ? null : p!.status_since,
      call: c && c.conference && !c.ended_at
        ? {
            id: c.id,
            answered: Boolean(c.answered_at),
            owner: c.lead?.contact_name || null,
            business: c.lead?.business_name || null,
            phone: c.to_number,
            leadId: c.lead_id,
          }
        : null,
    });
  }
  const order = { on_call: 0, wrap_up: 1, ready: 2, paused: 3, idle: 4, offline: 5 } as const;
  reps.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  return { modes, conference: (settings as { conference_calls?: boolean } | null)?.conference_calls === true, isAdmin: me.role === "admin", reps };
}

/** Switch between listen / whisper / barge while already on the call. */
export async function switchMonitor(callId: string, myCallSid: string, mode: MonitorMode): Promise<{ error?: string }> {
  const me = await requireUser();
  const m = z.enum(["listen", "whisper", "barge"]).parse(mode);
  if (!allowedModes(me).includes(m)) return { error: "You aren't allowed to do that." };
  const supabase = createAdminClient();
  const { data: call } = await supabase
    .from("calls")
    .select("id, twilio_call_sid, ended_at")
    .eq("id", z.uuid().parse(callId))
    .maybeSingle();
  if (!call?.twilio_call_sid || call.ended_at) return { error: "That call has ended." };
  try {
    const client = twilioClient();
    // Only ever change your own line on the call.
    const mine = await client.calls(z.string().regex(/^CA[0-9a-f]{32}$/).parse(myCallSid)).fetch();
    if (mine.from !== `client:${me.id}`) return { error: "You aren't allowed to do that." };
    const conf = await findConference(call.id);
    if (!conf) return { error: "That call has ended." };
    await client.conferences(conf).participants(myCallSid).update({
      muted: m === "listen",
      coaching: m === "whisper",
      ...(m === "whisper" ? { callSidToCoach: call.twilio_call_sid } : {}),
    });
    await supabase.from("events").insert({ type: "call_monitored", rep_id: me.id, call_id: call.id, data: { mode: m, switched: true } });
    return {};
  } catch {
    return { error: "Couldn't switch. Try again." };
  }
}

/** Admin: conference calls (listening in works) or direct calls (fallback). */
export async function setConferenceCalls(formData: FormData) {
  await requireAdmin();
  const on = formData.get("on") === "true";
  await createAdminClient().from("settings").update({ conference_calls: on }).eq("id", 1);
  revalidatePath("/admin");
}

/** Admin: calling-hours limit on (8am–8pm in the lead's time zone) or off (any time). */
export async function setCallingHours(formData: FormData) {
  await requireAdmin();
  const on = formData.get("on") === "true";
  await createAdminClient()
    .from("settings")
    .update(on ? { calling_start_hour: 8, calling_end_hour: 20 } : { calling_start_hour: 0, calling_end_hour: 24 })
    .eq("id", 1);
  revalidatePath("/admin");
}
