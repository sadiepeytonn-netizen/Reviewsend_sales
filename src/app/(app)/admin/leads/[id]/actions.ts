"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { addToDnc } from "@/lib/dnc";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type NoteState = { error?: string; ok?: number };

export async function addNote(_prev: NoteState, formData: FormData): Promise<NoteState> {
  const me = await requireUser();
  const leadId = z.uuid().safeParse(formData.get("leadId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!leadId.success) return { error: "Missing lead." };
  if (!body) return { error: "Type a note first." };
  if (body.length > 5000) return { error: "That note is too long." };

  // Runs as the logged-in user, so the database only allows notes on leads they can see.
  const supabase = await createClient();
  const { error } = await supabase.from("lead_notes").insert({ lead_id: leadId.data, author_id: me.id, body });
  if (error) return { error: "Couldn't save the note." };

  revalidatePath(`/admin/leads/${leadId.data}`);
  return { ok: Date.now() };
}

export async function setLeadList(formData: FormData) {
  await requireAdmin();
  const leadId = z.uuid().parse(formData.get("leadId"));
  const list = z.enum(["EAST", "WEST"]).parse(formData.get("list"));
  await createAdminClient().from("leads").update({ list }).eq("id", leadId);
  revalidatePath(`/admin/leads/${leadId}`);
  revalidatePath("/admin/leads");
}

export async function markLeadDnc(formData: FormData) {
  const me = await requireAdmin();
  const leadId = z.uuid().parse(formData.get("leadId"));
  const { data: lead } = await createAdminClient().from("leads").select("phone_e164").eq("id", leadId).single();
  if (lead?.phone_e164) {
    await addToDnc([lead.phone_e164], { source: "manual", reason: "Marked by admin", addedBy: me.id, leadId });
  }
  revalidatePath(`/admin/leads/${leadId}`);
  revalidatePath("/admin/leads");
}
