import "server-only";
import { createClient } from "@/lib/supabase/server";
import { stripeConfig } from "@/lib/stripe";
import { amCrmReady, sellablePackages } from "@/lib/am-crm";
import type { Profile } from "@/lib/types";

/** Everything the payment screen needs, for the Payments page and the dialer. */
export async function paymentSetup(me: Profile) {
  const supabase = await createClient();
  const isAdmin = me.role === "admin";
  const [{ data: settings }, { data: reps }, packages] = await Promise.all([
    supabase.from("settings").select("onboarding_url, monthly_min, monthly_max").eq("id", 1).maybeSingle(),
    isAdmin
      ? supabase.from("profiles").select("id, full_name, email, role").eq("active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string; role: string }[] }),
    sellablePackages(),
  ]);
  const c = stripeConfig();
  return {
    isAdmin,
    ready: c.ready,
    missing: c.missing,
    publishableKey: c.publishableKey ?? null,
    emailEnabled: Boolean(c.resendKey),
    onboardingUrl: settings?.onboarding_url ?? "https://calendly.com/support-reviewsend/30min",
    packages,
    handoffReady: amCrmReady(),
    limits: {
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
