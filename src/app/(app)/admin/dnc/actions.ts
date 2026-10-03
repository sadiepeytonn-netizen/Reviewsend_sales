"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { addToDnc } from "@/lib/dnc";
import { normalizePhone } from "@/lib/phone";

export type DncResult = { error?: string; added?: number; already?: number; invalid?: number; ok?: number };

export async function addDncNumbers(rawNumbers: string[], reason: string | null, source: "manual" | "import"): Promise<DncResult> {
  const me = await requireAdmin();
  if (!Array.isArray(rawNumbers) || rawNumbers.length > 5000) return { error: "Too many numbers at once." };

  const valid: string[] = [];
  let invalid = 0;
  for (const raw of rawNumbers) {
    const phone = normalizePhone(raw);
    if (phone) valid.push(phone);
    else if (String(raw ?? "").trim()) invalid++;
  }
  const unique = [...new Set(valid)];
  const res = await addToDnc(unique, { reason: reason?.trim() || null, source, addedBy: me.id });
  if (res.error) return { error: res.error };

  revalidatePath("/admin/dnc");
  revalidatePath("/admin/leads");
  return { added: res.added, already: unique.length - res.added, invalid, ok: Date.now() };
}

export async function addOneDnc(_prev: DncResult, formData: FormData): Promise<DncResult> {
  const phone = String(formData.get("phone") ?? "");
  if (!normalizePhone(phone)) return { error: "That isn't a valid US phone number." };
  return addDncNumbers([phone], String(formData.get("reason") ?? ""), "manual");
}
