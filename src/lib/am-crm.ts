import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Connection to the Account Manager CRM (via the ReviewSend server).
//   AM_CRM_HANDOFF_URL  e.g. https://reviewsend-server-production.up.railway.app/handoff
//   AM_CRM_HANDOFF_KEY  the same long secret as HANDOFF_SECRET on the server
// Both go in Vercel → this project → Settings → Environment Variables.

export type SellablePackage = { id: string; name: string; monthly_price: number; description: string | null };

function config() {
  const url = (process.env.AM_CRM_HANDOFF_URL || "").replace(/\/+$/, "");
  const key = process.env.AM_CRM_HANDOFF_KEY || "";
  return { url, key, ready: Boolean(url && key) };
}
export const amCrmReady = () => config().ready;

async function call(path: string, init?: RequestInit, timeoutMs = 15_000) {
  const c = config();
  const res = await fetch(`${c.url}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-handoff-key": c.key, ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Account Manager CRM answered ${res.status}`);
  return data;
}

/** The packages on offer, read from the Account Manager CRM. Empty if it isn't connected or can't be reached. */
export async function sellablePackages(): Promise<SellablePackage[]> {
  if (!config().ready) return [];
  try {
    const { packages } = await call("/packages", undefined, 5_000);
    return (packages ?? []).map((p: SellablePackage) => ({ id: p.id, name: p.name, monthly_price: Number(p.monthly_price), description: p.description ?? null }));
  } catch (err) {
    console.error("Couldn't load packages from the Account Manager CRM", (err as Error).message);
    return [];
  }
}

type HandoffSale = {
  id: string; business_name: string | null; contact_name: string | null; email: string | null; phone: string | null;
  package_id: string | null; setup_fee: number; monthly_price: number; notes: string | null; first_paid_at: string | null;
  stripe_customer_id: string | null; stripe_subscription_id: string | null; handed_off_at: string | null;
  rep: { full_name: string | null; email: string } | null;
};

/**
 * Send a paid sale's new client to the Account Manager CRM. Safe to call again:
 * the Account Manager CRM ignores a sale it already has. Throws if it couldn't
 * be reached or refused the sale, after saving the reason on the sale.
 */
export async function handOffSale(saleId: string): Promise<{ sent: boolean; skipped?: string }> {
  const db = createAdminClient();
  const { data } = await db.from("sales")
    .select("id, business_name, contact_name, email, phone, package_id, setup_fee, monthly_price, notes, first_paid_at, stripe_customer_id, stripe_subscription_id, handed_off_at, rep:profiles!sales_rep_id_fkey(full_name, email)")
    .eq("id", saleId).maybeSingle();
  const sale = data as unknown as HandoffSale | null;
  if (!sale || !sale.first_paid_at) return { sent: false, skipped: "not paid" };
  if (sale.handed_off_at) return { sent: false, skipped: "already sent" };

  const fail = async (reason: string) => {
    await db.from("sales").update({ handoff_error: reason }).eq("id", sale.id);
    throw new Error(reason);
  };
  // Nothing to send (older sales from before packages, or not connected yet): skip quietly.
  if (!sale.package_id) return { sent: false, skipped: "no package" };
  if (!config().ready) return { sent: false, skipped: "not connected" };

  let result: { business_id?: string };
  try {
    result = await call("/sale", {
      method: "POST",
      body: JSON.stringify({
        sale_id: sale.id,
        business_name: sale.business_name,
        contact_name: sale.contact_name,
        email: sale.email,
        phone: sale.phone,
        package_id: sale.package_id,
        monthly_price: Number(sale.monthly_price),
        setup_fee: Number(sale.setup_fee),
        sold_by: sale.rep?.full_name || sale.rep?.email || null,
        notes: sale.notes,
        first_paid_at: sale.first_paid_at,
        stripe_customer_id: sale.stripe_customer_id,
        stripe_subscription_id: sale.stripe_subscription_id,
      }),
    });
  } catch (err) {
    return fail(`Couldn't send to the Account Manager CRM: ${(err as Error).message}`);
  }
  await db.from("sales").update({ handed_off_at: new Date().toISOString(), handoff_error: null, am_business_id: result.business_id ?? null }).eq("id", sale.id);
  return { sent: true };
}
