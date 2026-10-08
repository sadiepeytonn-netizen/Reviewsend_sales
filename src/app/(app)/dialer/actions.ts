"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { twilioConfig, voiceToken } from "@/lib/twilio";
import type { LeadStatus } from "@/lib/leads";

export type DialerLead = {
  id: string; business_name: string; contact_name: string | null; phone_e164: string | null;
  email: string | null; website: string | null; address: string | null; city: string | null; state: string | null;
  category: string | null; google_rating: number | null; review_count: number | null; google_profile_url: string | null;
  import_notes: string | null; timezone: string | null; list: "EAST" | "WEST" | null; status: LeadStatus;
  attempt_count: number; last_called_at: string | null; owner_id: string | null;
  /** In the owner's Demo Missed folder since (migration 0011). */
  missed_since?: string | null;
};
export type DialerNote = { id: string; body: string; created_at: string; author: string };
export type DialerCall = {
  id: string; started_at: string; duration_seconds: number | null; disposition: string | null;
  recording_sid: string | null; recording_deleted_at: string | null; from_number: string | null; rep: string;
};
export type LeadContext = { lead: DialerLead; notes: DialerNote[]; calls: DialerCall[] };

const FRIENDLY: Record<string, string> = {
  not_allowed: "Your account can't do that. Try signing in again.",
  not_your_lead: "This lead isn't yours anymore. It may have timed out. Loading the next one.",
  do_not_call: "This number is on the Do Not Call list and can't be dialed.",
  outside_calling_hours: "It's outside calling hours where this lead is (8am–8pm their time).",
  no_phone: "This lead has no phone number.",
  lead_not_found: "That lead no longer exists.",
  appointment_time_required: "Pick a date and time for the appointment.",
  appointment_in_past: "That appointment time is in the past.",
  pause_reason_required: "Pick a reason for the pause.",
  call_not_found: "Couldn't match that call. Try again.",
  save_lead_first: "Save this number as a lead first (business name), then pick the outcome.",
  business_name_required: "Enter the business name.",
};

function friendly(message: string | undefined): string {
  const key = Object.keys(FRIENDLY).find((k) => message?.includes(k));
  return key ? FRIENDLY[key] : `Something went wrong: ${message ?? "unknown error"}`;
}

export async function getVoiceToken(): Promise<{ token?: string; identity?: string; error?: string }> {
  const me = await requireUser();
  const c = twilioConfig();
  if (!c.ready) return { error: `Calling isn't set up yet (missing ${c.missing.join(", ")}).` };
  return { token: voiceToken(me.id), identity: me.id };
}

export async function loadLeadContext(leadId: string): Promise<LeadContext | null> {
  await requireUser();
  if (!z.uuid().safeParse(leadId).success) return null;
  const supabase = await createClient();
  const [{ data: lead }, { data: notes }, { data: calls }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", leadId).maybeSingle(),
    supabase.from("lead_notes").select("id, body, created_at, author:profiles(full_name, email)").eq("lead_id", leadId).order("created_at", { ascending: false }),
    supabase.from("calls").select("id, started_at, duration_seconds, disposition, recording_sid, recording_deleted_at, from_number, rep:profiles(full_name)").eq("lead_id", leadId).order("started_at", { ascending: false }).limit(300),
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

/** Next lead: shared EAST / WEST pool, the rep's private list ("MINE"), or their Demo Missed folder ("MISSED"). */
export async function claimNext(list: "EAST" | "WEST" | "MINE" | "MISSED"): Promise<{ context?: LeadContext | null; error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const l = z.enum(["EAST", "WEST", "MINE", "MISSED"]).parse(list);
  const { data, error } = await supabase.rpc(
    "claim_next_lead",
    l === "MINE" ? { p_mine: true } : l === "MISSED" ? { p_missed: true } : { p_list: l },
  );
  if (error) return { error: friendly(error.message) };
  if (!data) return { context: null };
  return { context: await loadLeadContext((data as { id: string }).id) };
}

export async function releaseLead(leadId: string) {
  await requireUser();
  const supabase = await createClient();
  await supabase.rpc("release_lead", { p_lead: leadId });
}

export async function heartbeat() {
  await requireUser();
  const supabase = await createClient();
  await supabase.rpc("presence_heartbeat");
}

const presenceSchema = z.object({
  status: z.enum(["idle", "ready", "on_call", "wrap_up", "paused", "offline"]),
  reason: z.enum(["lunch", "break", "meeting", "training", "other"]).nullable().optional(),
  list: z.enum(["EAST", "WEST", "MINE", "MISSED"]).nullable().optional(),
});

export async function setPresence(input: z.infer<typeof presenceSchema>): Promise<{ error?: string }> {
  await requireUser();
  const p = presenceSchema.parse(input);
  const supabase = await createClient();
  const list = p.list === "EAST" || p.list === "WEST" ? p.list : null; // private lists aren't EAST/WEST
  const { error } = await supabase.rpc("set_presence", { p_status: p.status, p_reason: p.reason ?? null, p_list: list });
  return error ? { error: friendly(error.message) } : {};
}

/** Conference calls are on unless the admin switched back to direct calls. */
async function conferenceOn(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("settings").select("conference_calls").eq("id", 1).maybeSingle();
  return (data as { conference_calls?: boolean } | null)?.conference_calls === true;
}

export type StartedCall = { callId?: string; conference?: boolean; error?: string };

export async function startCall(leadId: string): Promise<StartedCall> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_call", { p_lead: z.uuid().parse(leadId) });
  if (error) return { error: friendly(error.message) };
  return { callId: (data as { call_id: string }).call_id, conference: await conferenceOn(supabase) };
}

const disposeSchema = z.object({
  leadId: z.uuid(),
  callId: z.uuid().nullable(),
  disposition: z.enum(["no_answer", "not_interested", "appointment_set", "demo_completed", "sold", "do_not_call", "bad_number"]),
  note: z.string().max(5000).optional(),
  appointmentStart: z.iso.datetime({ offset: true }).nullable().optional(),
  appointmentMinutes: z.number().int().min(5).max(480).nullable().optional(),
});

export async function dispose(input: z.infer<typeof disposeSchema>): Promise<{ error?: string; status?: string }> {
  await requireUser();
  const parsed = disposeSchema.safeParse(input);
  if (!parsed.success) return { error: "Something's missing. Check the form." };
  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dispose_lead", {
    p_lead: d.leadId,
    p_disposition: d.disposition,
    p_call: d.callId,
    p_note: d.note ?? null,
    p_appt_start: d.appointmentStart ?? null,
    p_appt_minutes: d.appointmentMinutes ?? null,
  });
  if (error) return { error: friendly(error.message) };
  return { status: (data as { status: string }).status };
}

export async function addLeadNote(leadId: string, body: string): Promise<{ note?: DialerNote; error?: string }> {
  const me = await requireUser();
  const text = body.trim();
  if (!text) return { error: "Type a note first." };
  if (text.length > 5000) return { error: "That note is too long." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_notes")
    .insert({ lead_id: z.uuid().parse(leadId), author_id: me.id, body: text })
    .select("id, body, created_at")
    .single();
  if (error) return { error: "Couldn't save the note." };
  return { note: { ...data, author: me.full_name || me.email } };
}

// ---------------------------------------------------------------------------
// Keypad (manual) dialing
// ---------------------------------------------------------------------------

export type LookupResult =
  | { status: "lead"; phone: string; context: LeadContext }
  | { status: "new"; phone: string }
  | { status: "blocked"; error: string };

/** What is this number? Pool leads get held for the caller; others' clients are blocked. */
export async function lookupNumber(raw: string): Promise<LookupResult> {
  await requireUser();
  const { normalizePhone } = await import("@/lib/phone");
  const phone = normalizePhone(raw);
  if (!phone) return { status: "blocked", error: "That isn't a valid US phone number." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lookup_number", { p_phone: phone });
  if (error) return { status: "blocked", error: friendly(error.message) };
  const r = data as { status: string; lead_id?: string };
  if (r.status === "dnc") return { status: "blocked", error: "That number is on the Do Not Call list." };
  if (r.status === "other_rep") return { status: "blocked", error: "That number belongs to another rep (their client or private list)." };
  if (r.status === "busy") return { status: "blocked", error: "Another rep has that lead on their dialer right now." };
  if (r.status === "lead" && r.lead_id) {
    const context = await loadLeadContext(r.lead_id);
    if (context) return { status: "lead", phone, context };
  }
  return { status: "new", phone };
}

export async function startManualCall(phone: string, leadId: string | null): Promise<StartedCall> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_manual_call", { p_phone: phone, p_lead: leadId });
  if (error) return { error: friendly(error.message) };
  return { callId: (data as { call_id: string }).call_id, conference: await conferenceOn(supabase) };
}

/** After a keypad call to an unknown number: save it as a lead (never a duplicate). */
export async function saveCallAsLead(input: {
  callId: string | null; phone: string; businessName: string; ownerName: string; email?: string;
}): Promise<{ context?: LeadContext; error?: string }> {
  await requireUser();
  const { locate, listForTimezone } = await import("@/lib/phone");
  if (!input.businessName.trim()) return { error: "Enter the business name." };
  const where = locate(input.phone);
  const supabase = await createClient();
  const { data: leadId, error } = await supabase.rpc("find_or_create_lead", {
    p_phone: input.phone,
    p_business: input.businessName,
    p_owner: input.ownerName,
    p_email: input.email ?? "",
    p_city: "",
    p_state: where.state ?? "",
    p_timezone: where.timezone ?? "",
    p_list: listForTimezone(where.timezone),
  });
  if (error) {
    if (error.message.includes("other_rep")) return { error: "That number belongs to another rep's client." };
    return { error: friendly(error.message) };
  }
  if (input.callId) {
    const { error: linkError } = await supabase.rpc("link_call_to_lead", { p_call: input.callId, p_lead: leadId as string });
    if (linkError) return { error: friendly(linkError.message) };
  }
  const context = await loadLeadContext(leadId as string);
  return context ? { context } : { error: "Saved, but couldn't load the lead." };
}

/** Fill in or fix the business owner's name. */
export async function setOwnerName(leadId: string, name: string): Promise<{ error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_owner_name", { p_lead: z.uuid().parse(leadId), p_name: name.slice(0, 200) });
  return error ? { error: friendly(error.message) } : {};
}

/** Keypad call to an unknown number that reached nobody: record it without making a lead. */
export async function closeManualCall(callId: string, disposition: "no_answer" | "bad_number"): Promise<{ error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_manual_call", {
    p_call: z.uuid().parse(callId),
    p_disposition: z.enum(["no_answer", "bad_number"]).parse(disposition),
  });
  return error ? { error: friendly(error.message) } : {};
}

// ---------------------------------------------------------------------------
// Conference calls (needed for listening in)
// ---------------------------------------------------------------------------

/** Has the prospect picked up / hung up? (Conference calls connect the rep right away.) */
export async function getCallProgress(callId: string): Promise<{ answered: boolean; ended: boolean; fromNumber: string | null }> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("calls").select("answered_at, ended_at, from_number").eq("id", z.uuid().parse(callId)).maybeSingle();
  return { answered: Boolean(data?.answered_at), ended: Boolean(data?.ended_at), fromNumber: data?.from_number ?? null };
}

/** Keypad tones for phone menus on a conference call. */
export async function sendCallDigits(callId: string, digits: string): Promise<{ error?: string }> {
  const me = await requireUser();
  const { findConference, twilioClient } = await import("@/lib/twilio");
  const { appOrigin } = await import("@/lib/origin");
  const supabase = await createClient();
  const { data: call } = await supabase
    .from("calls")
    .select("id, rep_id, prospect_call_sid, ended_at")
    .eq("id", z.uuid().parse(callId))
    .maybeSingle();
  if (!call || call.rep_id !== me.id || !call.prospect_call_sid || call.ended_at) return { error: "The call has ended." };
  const d = digits.replace(/[^0-9*#]/g, "").slice(0, 20);
  if (!d) return {};
  try {
    const conf = await findConference(call.id);
    if (!conf) return { error: "The call has ended." };
    await twilioClient()
      .conferences(conf)
      .participants(call.prospect_call_sid)
      .update({ announceUrl: `${await appOrigin()}/api/webhooks/twilio/digits?d=${encodeURIComponent(d)}` });
    return {};
  } catch {
    return { error: "Couldn't send the keypad tones." };
  }
}

// ---------------------------------------------------------------------------
// Editing a lead (anyone who can see it)
// ---------------------------------------------------------------------------

const EDITABLE = {
  business_name: "Business",
  contact_name: "Owner",
  phone_e164: "Phone",
  email: "Email",
  website: "Website",
  address: "Address",
  city: "City",
  state: "State",
  category: "Category",
  google_profile_url: "Google link",
} as const;

export type LeadEdit = { [K in Exclude<keyof typeof EDITABLE, "phone_e164">]: string } & { phone: string };

/**
 * Fix a lead's details (wrong business on a number, new owner name, etc.). Reps can edit
 * any lead they can see; admins any lead. Every change is written to the lead's notes.
 */
export async function editLead(leadId: string, input: LeadEdit): Promise<{ lead?: DialerLead; error?: string }> {
  const me = await requireUser();
  const id = z.uuid().parse(leadId);
  const supabase = await createClient();
  // Row-level security decides who may edit: if you can see it, you can fix it.
  const { data: current } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (!current) return { error: "You can't edit this lead." };
  const lead = current as DialerLead & Record<string, unknown>;

  const { normalizePhone, normalizeState, locate, listForTimezone, formatPhone } = await import("@/lib/phone");
  const clean = (v: string | undefined, max = 300) => {
    const t = (v ?? "").trim().slice(0, max);
    return t || null;
  };
  const business = clean(input.business_name, 200);
  if (!business) return { error: "Enter the business name." };
  const phone = normalizePhone(input.phone);
  if (!phone) return { error: "That isn't a valid US phone number." };
  const email = clean(input.email, 200)?.toLowerCase() ?? null;
  if (email && !z.email().safeParse(email).success) return { error: "That email doesn't look right." };
  const stateRaw = clean(input.state, 40);
  const state = stateRaw ? normalizeState(stateRaw) ?? stateRaw.toUpperCase().slice(0, 2) : null;

  const next: Record<string, string | null> = {
    business_name: business,
    contact_name: clean(input.contact_name, 200),
    phone_e164: phone,
    email,
    website: clean(input.website),
    address: clean(input.address),
    city: clean(input.city, 100),
    state,
    category: clean(input.category, 100),
    google_profile_url: clean(input.google_profile_url, 500),
  };

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const update: Record<string, unknown> = { ...next };
  if (phone !== lead.phone_e164) {
    const [{ data: dnc }, { data: dupe }] = await Promise.all([
      db.from("dnc_numbers").select("phone_e164").eq("phone_e164", phone).maybeSingle(),
      db.from("leads").select("id").eq("phone_e164", phone).neq("id", id).maybeSingle(),
    ]);
    if (dnc) return { error: "That number is on the Do Not Call list." };
    if (dupe) return { error: "That number already belongs to another lead in the CRM." };
    // New number, new place: work out the time zone and EAST/WEST list again.
    const where = locate(phone, state);
    update.phone_raw = input.phone.trim();
    update.timezone = where.timezone ?? lead.timezone;
    update.list = listForTimezone(where.timezone) ?? lead.list;
    if (!state && where.state) update.state = where.state;
  }

  const changes: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(EDITABLE) as (keyof typeof EDITABLE)[]) {
    const before = (lead[k] as string | null) ?? null;
    const after = (update[k] as string | null) ?? null;
    if ((before ?? "") !== (after ?? "")) changes[k] = [before, after];
  }
  if (Object.keys(changes).length === 0) return { lead: lead as DialerLead };

  const { data: saved, error } = await db.from("leads").update(update).eq("id", id).select("*").single();
  if (error) {
    if (error.message.includes("name_city")) return { error: "Another lead already has this business name and city." };
    if (error.message.includes("phone")) return { error: "That number already belongs to another lead in the CRM." };
    return { error: `Couldn't save: ${error.message}` };
  }

  // A visible trail on the lead, plus the permanent event log.
  const show = (k: string, v: unknown) => (v == null || v === "" ? "(blank)" : k === "phone_e164" ? formatPhone(String(v)) : String(v));
  const lines = Object.entries(changes).map(([k, [a, b]]) => `${EDITABLE[k as keyof typeof EDITABLE]}: ${show(k, a)} → ${show(k, b)}`);
  await Promise.all([
    db.from("lead_notes").insert({ lead_id: id, author_id: me.id, body: `✏️ Edited\n${lines.join("\n")}` }),
    db.from("events").insert({ type: "lead_edited", rep_id: me.id, lead_id: id, data: { changes } }),
  ]);
  return { lead: saved as DialerLead };
}

// ---------------------------------------------------------------------------
// Demo Missed folder
// ---------------------------------------------------------------------------

export type MissedRow = Pick<
  DialerLead,
  "id" | "business_name" | "contact_name" | "phone_e164" | "email" | "website" | "address" | "city" | "state" | "category"
  | "google_profile_url" | "last_called_at" | "timezone"
> & { missed_since: string };

/** Everyone in my Demo Missed folder (admins: pass a rep to see theirs). */
export async function getMissedFolder(repId?: string): Promise<{ rows: MissedRow[]; error?: string }> {
  const me = await requireUser();
  const owner = me.role === "admin" && repId ? z.uuid().parse(repId) : me.id;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id, business_name, contact_name, phone_e164, email, website, address, city, state, category, google_profile_url, last_called_at, timezone, missed_since")
    .eq("owner_id", owner)
    .not("missed_since", "is", null)
    .order("missed_since", { ascending: true });
  if (error) return { rows: [], error: "The Demo Missed folder needs the latest database update (0011)." };
  return { rows: (data ?? []) as MissedRow[] };
}

export async function removeFromMissed(leadId: string): Promise<{ error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_from_missed", { p_lead: z.uuid().parse(leadId) });
  return error ? { error: friendly(error.message) } : {};
}
