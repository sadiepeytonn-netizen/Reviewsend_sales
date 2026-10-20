"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readLeadContext } from "@/lib/lead-context";
import type { LeadContext } from "../dialer/actions";

const FRIENDLY: Record<string, string> = {
  not_your_call: "That's someone else's call. Only an admin can change it.",
  call_too_old: "That call is more than 7 days old. Ask an admin to change it.",
  call_in_progress: "That call is still going. Pick the outcome when it ends.",
  outcome_locked: "Do Not Call and Sold outcomes can't be changed.",
  no_lead: "This number was never saved as a lead, so only No answer, Owner not available or Bad number fit.",
  lead_called_since: "This lead has been called again since. Book the appointment from the newest call instead.",
  appointment_time_required: "Pick a date and time for the appointment.",
  appointment_in_past: "That appointment time is in the past.",
  call_not_found: "That call no longer exists.",
};

const schema = z.object({
  callId: z.uuid(),
  disposition: z.enum(["no_answer", "owner_unavailable", "not_interested", "appointment_set", "demo_completed", "sold", "do_not_call", "bad_number"]),
  note: z.string().max(5000).optional(),
  appointmentStart: z.iso.datetime({ offset: true }).nullable().optional(),
  appointmentMinutes: z.number().int().min(5).max(480).nullable().optional(),
});

/** Pick (or change) a call's outcome after the fact. The database decides who may (own calls, 7 days; admins any). */
export async function changeCallOutcome(input: z.infer<typeof schema>): Promise<{ error?: string }> {
  await requireUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Something's missing. Check the form." };
  const d = parsed.data;
  const { error } = await (await createClient()).rpc("change_call_outcome", {
    p_call: d.callId,
    p_disposition: d.disposition,
    p_note: d.note ?? null,
    p_appt_start: d.appointmentStart ?? null,
    p_appt_minutes: d.appointmentMinutes ?? null,
  });
  if (error) {
    const key = Object.keys(FRIENDLY).find((k) => error.message.includes(k));
    return { error: key ? FRIENDLY[key] : `Couldn't save: ${error.message}` };
  }
  revalidatePath("/calls");
  revalidatePath("/recordings");
  return {};
}

/** The lead behind one of my calls (any call, for admins): details, notes and call history. */
export async function getCallLead(callId: string): Promise<{ context?: LeadContext; canCall?: boolean; error?: string }> {
  const me = await requireUser();
  if (!z.uuid().safeParse(callId).success) return { error: "Call not found." };
  const db = createAdminClient();
  const { data: call } = await db.from("calls").select("rep_id, lead_id").eq("id", callId).maybeSingle();
  if (!call || (call.rep_id !== me.id && me.role !== "admin")) return { error: "Call not found." };
  if (!call.lead_id) return { error: "This number was never saved as a lead." };
  const context = await readLeadContext(db, call.lead_id);
  if (!context) return { error: "That lead no longer exists." };
  return { context, canCall: me.role === "admin" || context.lead.owner_id === me.id };
}
