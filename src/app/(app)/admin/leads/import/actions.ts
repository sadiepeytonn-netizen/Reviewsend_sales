"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { cleanRow, type MappedRow } from "@/lib/import/clean";
import { createAdminClient } from "@/lib/supabase/admin";

export type RowOutcome = { i: number; outcome: "inserted" | "merged" | "dnc" | "invalid"; reason?: string };

export async function startImport(input: { fileName: string; leadSource: string; totalRows: number; assignedTo?: string | null }) {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      fileName: z.string().min(1).max(255),
      leadSource: z.string().trim().min(1, "Enter where these leads came from.").max(100),
      totalRows: z.number().int().min(1).max(100_000),
      assignedTo: z.uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data, error } = await createAdminClient()
    .from("import_batches")
    .insert({
      file_name: parsed.data.fileName,
      lead_source: parsed.data.leadSource,
      total_rows: parsed.data.totalRows,
      uploaded_by: admin.id,
      // A person's private list (new leads only; see migration 0009).
      ...(parsed.data.assignedTo ? { assigned_to: parsed.data.assignedTo } : {}),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { batchId: data.id as string };
}

// Rows arrive in chunks so big files show progress and stay under size limits.
export async function importChunk(batchId: string, rows: MappedRow[]): Promise<{ error?: string; outcomes?: RowOutcome[] }> {
  await requireAdmin();
  if (!z.uuid().safeParse(batchId).success || !Array.isArray(rows) || rows.length > 1000) {
    return { error: "Bad import request." };
  }

  const cleaned = rows.map(cleanRow);
  const { data, error } = await createAdminClient().rpc("import_lead_rows", {
    p_batch_id: batchId,
    p_rows: cleaned,
  });
  if (error) return { error: error.message };

  // The database reports invalid rows by position; add back the reason.
  const outcomes = (data as RowOutcome[]).map((o) => ({ ...o, reason: o.reason ?? cleaned[o.i]?.invalid_reason }));
  return { outcomes };
}

export async function finishImport() {
  await requireAdmin();
  revalidatePath("/admin/leads");
  revalidatePath("/admin/leads/imports");
}
