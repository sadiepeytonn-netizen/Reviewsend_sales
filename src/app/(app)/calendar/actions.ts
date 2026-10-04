"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type CalendarAppointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "showed" | "missed" | "canceled" | "rescheduled";
  rep_id: string;
  rep_name: string;
  lead: { id: string; business_name: string; contact_name: string | null; phone_e164: string | null; city: string | null; state: string | null } | null;
};

type Row = Omit<CalendarAppointment, "rep_name"> & { rep: { full_name: string; email: string } | null };

const SELECT =
  "id, starts_at, ends_at, status, rep_id, lead:leads(id, business_name, contact_name, phone_e164, city, state), rep:profiles!appointments_rep_id_fkey(full_name, email)";

const toAppt = (r: Row): CalendarAppointment => ({
  id: r.id, starts_at: r.starts_at, ends_at: r.ends_at, status: r.status, rep_id: r.rep_id, lead: r.lead,
  rep_name: r.rep?.full_name || r.rep?.email || "",
});

const FRIENDLY: Record<string, string> = {
  not_your_appointment: "That appointment belongs to someone else.",
  appointment_not_found: "That appointment no longer exists.",
  appointment_in_past: "Pick a time in the future.",
};
const friendly = (m?: string) => FRIENDLY[Object.keys(FRIENDLY).find((k) => m?.includes(k)) ?? ""] ?? `Something went wrong: ${m}`;

/** Appointments between two times. Reps only ever get their own (row-level security). */
export async function getAppointments(fromIso: string, toIso: string, repId?: string | null): Promise<CalendarAppointment[]> {
  await requireUser();
  const from = z.iso.datetime({ offset: true }).parse(fromIso);
  const to = z.iso.datetime({ offset: true }).parse(toIso);
  const supabase = await createClient();
  let q = supabase
    .from("appointments")
    .select(SELECT)
    .neq("status", "rescheduled")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at");
  if (repId) q = q.eq("rep_id", z.uuid().parse(repId));
  const { data } = await q;
  return ((data ?? []) as unknown as Row[]).map(toAppt);
}

/** Past appointments nobody has marked Showed / Demo missed yet. */
export async function getNeedsOutcome(repId?: string | null): Promise<CalendarAppointment[]> {
  const me = await requireUser();
  const supabase = await createClient();
  let q = supabase
    .from("appointments")
    .select(SELECT)
    .eq("status", "scheduled")
    .lt("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .limit(50);
  // Reps: their own. Admins: everyone's, or one rep when filtering.
  if (repId) q = q.eq("rep_id", z.uuid().parse(repId));
  else if (me.role !== "admin") q = q.eq("rep_id", me.id);
  const { data } = await q;
  return ((data ?? []) as unknown as Row[]).map(toAppt);
}

export async function setOutcome(appointmentId: string, status: "scheduled" | "showed" | "missed" | "canceled"): Promise<{ error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_appointment_outcome", {
    p_appointment: z.uuid().parse(appointmentId),
    p_status: z.enum(["scheduled", "showed", "missed", "canceled"]).parse(status),
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return {};
}

export async function reschedule(appointmentId: string, startIso: string, minutes: number): Promise<{ error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_appointment", {
    p_appointment: z.uuid().parse(appointmentId),
    p_start: z.iso.datetime({ offset: true }).parse(startIso),
    p_minutes: z.number().int().min(5).max(480).parse(minutes),
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/calendar");
  return {};
}

export async function resetCalendarLink(): Promise<{ token?: string; error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reset_calendar_token");
  if (error) return { error: friendly(error.message) };
  revalidatePath("/calendar");
  return { token: data as string };
}
