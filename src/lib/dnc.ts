import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Adds numbers (already normalized to +1XXXXXXXXXX) to the permanent Do Not
// Call list. Numbers already on it are left alone. Returns how many were new.
export async function addToDnc(
  phones: string[],
  opts: { reason?: string | null; source: "disposition" | "import" | "manual"; addedBy: string; leadId?: string | null },
): Promise<{ added: number; error?: string }> {
  const unique = [...new Set(phones)];
  if (unique.length === 0) return { added: 0 };
  const supabase = createAdminClient();

  const { data: existing, error: readError } = await supabase.from("dnc_numbers").select("phone_e164").in("phone_e164", unique);
  if (readError) return { added: 0, error: readError.message };
  const already = new Set((existing ?? []).map((r) => r.phone_e164 as string));
  const fresh = unique.filter((p) => !already.has(p));
  if (fresh.length === 0) return { added: 0 };

  const { error } = await supabase.from("dnc_numbers").upsert(
    fresh.map((phone_e164) => ({
      phone_e164,
      reason: opts.reason ?? null,
      source: opts.source,
      added_by: opts.addedBy,
      lead_id: opts.leadId ?? null,
    })),
    { onConflict: "phone_e164", ignoreDuplicates: true },
  );
  if (error) return { added: 0, error: error.message };
  return { added: fresh.length };
}
