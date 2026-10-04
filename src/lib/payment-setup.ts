import "server-only";
import { createClient } from "@/lib/supabase/server";
import { stripeConfig } from "@/lib/stripe";
import type { Profile } from "@/lib/types";

/** Everything the payment screen needs, for the Payments page and the dialer. */
export async function paymentSetup(me: Profile) {
  const supabase = await createClient();
  const isAdmin = me.role === "admin";
  const [{ data: settings }, { data: reps }] = await Promise.all([
    supabase.from("settings").select("onboarding_url, setup_fee_max, monthly_min, monthly_max").eq("id", 1).maybeSingle(),
    isAdmin
      ? supabase.from("profiles").select("id, full_name, email, role").eq("active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string; role: string }[] }),
  ]);
  const c = stripeConfig();
  return {
    isAdmin,
    ready: c.ready,
    missing: c.missing,
    publishableKey: c.publishableKey ?? null,
    emailEnabled: Boolean(c.resendKey),
    onboardingUrl: settings?.onboarding_url ?? "https://calendly.com/support-reviewsend/30min",
    limits: {
      setupMax: Number(settings?.setup_fee_max ?? 599),
      monthlyMin: Number(settings?.monthly_min ?? 199),
      monthlyMax: Number(settings?.monthly_max ?? 699),
    },
    reps: isAdmin
      ? (reps ?? []).map((r) => ({ id: r.id, name: `${r.full_name || r.email}${r.role === "admin" ? " (admin)" : ""}` }))
      : [{ id: me.id, name: me.full_name || me.email }],
    defaultRepId: me.id,
  };
}
export type PaymentSetup = Awaited<ReturnType<typeof paymentSetup>>;
