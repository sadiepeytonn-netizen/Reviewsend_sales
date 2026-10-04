import "server-only";
import type Stripe from "stripe";
import { firstMonthCommission, monthlyResidual, type CommissionPlan } from "@/lib/commission";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

type SaleRow = {
  id: string; rep_id: string; lead_id: string | null; setup_fee: number; monthly_price: number;
  status: string; plan_snapshot: CommissionPlan | null; first_paid_at: string | null;
  stripe_subscription_id: string | null; business_name: string | null;
};

/** The CRM sale an invoice belongs to, or null if it isn't one of ours (e.g. the old pay site's). */
async function saleIdForInvoice(invoice: Stripe.Invoice): Promise<{ saleId: string | null; subscriptionId: string | null }> {
  const details = invoice.parent?.subscription_details;
  const subscriptionId = details ? (typeof details.subscription === "string" ? details.subscription : details.subscription.id) : null;
  let saleId = details?.metadata?.crm_sale_id ?? null;
  // Only look the subscription up if the invoice didn't carry its metadata.
  // (Invoices from the old pay site carry metadata without crm_sale_id: not ours.)
  if (!saleId && subscriptionId && !details?.metadata) {
    const sub = await stripe().subscriptions.retrieve(subscriptionId);
    saleId = sub.metadata?.crm_sale_id ?? null;
  }
  return { saleId, subscriptionId };
}

const periodStart = (invoice: Stripe.Invoice) => new Date(invoice.created * 1000).toISOString().slice(0, 10);

/**
 * Record a paid Stripe invoice. Safe to call more than once for the same
 * invoice (the dialer calls it right after charging, and Stripe's webhook
 * calls it again): commissions are unique per invoice.
 *   - First invoice  → sale becomes "active" (this is when the sale counts),
 *                      lead becomes Sold + owned by the rep, first-month commission.
 *   - Later invoices → monthly residual for the rep, per their plan at the time of sale.
 */
export async function recordInvoicePaid(invoice: Stripe.Invoice): Promise<{ handled: boolean }> {
  const { saleId, subscriptionId } = await saleIdForInvoice(invoice);
  if (!saleId) return { handled: false };

  const db = createAdminClient();
  const { data } = await db.from("sales").select("*").eq("id", saleId).maybeSingle();
  const sale = data as SaleRow | null;
  if (!sale) return { handled: false };

  const plan = sale.plan_snapshot;
  const monthly = Number(sale.monthly_price);
  const setup = Number(sale.setup_fee);
  const isFirst = invoice.billing_reason === "subscription_create" || !sale.first_paid_at;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;

  if (isFirst) {
    const paidAt = sale.first_paid_at ?? new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000).toISOString();
    await db.from("sales").update({
      status: "active",
      first_paid_at: paidAt,
      stripe_subscription_id: sale.stripe_subscription_id ?? subscriptionId,
      stripe_customer_id: customerId,
      last_error: null,
    }).eq("id", sale.id);

    if (plan) {
      const c = firstMonthCommission(plan, setup, monthly);
      await db.from("commissions").upsert(
        {
          sale_id: sale.id, rep_id: sale.rep_id, kind: "first_month", period_start: periodStart(invoice),
          base_amount: c.base, amount: c.amount, stripe_invoice_id: invoice.id,
          explanation: `${c.pct}% of first month ($${setup} setup + $${monthly} monthly)`,
        },
        { onConflict: "stripe_invoice_id", ignoreDuplicates: true },
      );
    }

    if (!sale.first_paid_at) {
      await db.from("events").insert({
        type: "sale_paid", rep_id: sale.rep_id, lead_id: sale.lead_id,
        data: { sale_id: sale.id, setup_fee: setup, monthly_price: monthly, invoice: invoice.id },
      });
      if (sale.lead_id) {
        const { data: lead } = await db.from("leads").select("owner_id").eq("id", sale.lead_id).maybeSingle();
        await db.from("leads").update({
          status: "sold",
          owner_id: lead?.owner_id ?? sale.rep_id,
          claimed_by: null, claimed_at: null, claim_expires_at: null,
        }).eq("id", sale.lead_id);
      }
    }
  } else {
    await db.from("sales").update({ status: "active", last_error: null }).eq("id", sale.id);
    const amount = plan ? monthlyResidual(plan, monthly) : 0;
    if (amount > 0 && (invoice.amount_paid ?? 0) > 0) {
      await db.from("commissions").upsert(
        {
          sale_id: sale.id, rep_id: sale.rep_id, kind: "residual", period_start: periodStart(invoice),
          base_amount: monthly, amount, stripe_invoice_id: invoice.id,
          explanation: plan!.residualKind === "percent"
            ? `${plan!.residualValue}% of $${monthly} monthly`
            : `$${plan!.residualValue} monthly residual`,
        },
        { onConflict: "stripe_invoice_id", ignoreDuplicates: true },
      );
    }
  }
  return { handled: true };
}

export async function markSaleByInvoice(invoice: Stripe.Invoice, status: "past_due") {
  const { saleId } = await saleIdForInvoice(invoice);
  if (!saleId) return;
  await createAdminClient().from("sales").update({ status }).eq("id", saleId).neq("status", "canceled");
}

export async function markSubscriptionCanceled(sub: Stripe.Subscription) {
  const saleId = sub.metadata?.crm_sale_id;
  if (!saleId) return;
  await createAdminClient()
    .from("sales")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", saleId);
}

export async function linkCheckoutSession(session: Stripe.Checkout.Session) {
  const saleId = session.metadata?.crm_sale_id;
  if (!saleId) return;
  const sub = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  await createAdminClient().from("sales").update({ stripe_subscription_id: sub, stripe_customer_id: customer }).eq("id", saleId);
}
