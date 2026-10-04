"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { planFromRow, type CommissionPlan } from "@/lib/commission";
import { firstMonthCommission } from "@/lib/commission";
import { recordInvoicePaid } from "@/lib/payments";
import { cents, crmProducts, describeStripeError, stripe, stripeConfig } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CommissionPlanRow } from "@/lib/types";
import type Stripe from "stripe";

const money = z.coerce.number().min(0).max(100_000);

const saleSchema = z.object({
  leadId: z.uuid().nullable(),
  repId: z.uuid().nullable(),
  businessName: z.string().trim().min(1, "Enter the business name."),
  contactName: z.string().trim().min(1, "Enter the client's name."),
  email: z.email("Enter a valid email for the receipt."),
  phone: z.string().trim().max(30).optional(),
  setupFee: money,
  monthlyPrice: money,
  notes: z.string().trim().max(2000).optional(),
});
export type SaleInput = z.input<typeof saleSchema>;

async function limits() {
  const { data } = await createAdminClient().from("settings").select("setup_fee_max, monthly_min, monthly_max").eq("id", 1).single();
  return { setupMax: Number(data?.setup_fee_max ?? 599), monthlyMin: Number(data?.monthly_min ?? 199), monthlyMax: Number(data?.monthly_max ?? 699) };
}

async function planFor(repId: string): Promise<CommissionPlan | null> {
  const { data } = await createAdminClient()
    .from("commission_plans").select("*").eq("rep_id", repId)
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false }).limit(1).maybeSingle();
  return data ? planFromRow(data as CommissionPlanRow) : null;
}

/** Step 1: save the deal (status "pending" until Stripe confirms payment). */
export async function startSale(input: SaleInput): Promise<{ saleId?: string; error?: string }> {
  const me = await requireUser();
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  const l = await limits();
  if (s.setupFee > l.setupMax) return { error: `Setup fee can be at most $${l.setupMax}.` };
  if (s.monthlyPrice < l.monthlyMin || s.monthlyPrice > l.monthlyMax) return { error: `Monthly price must be between $${l.monthlyMin} and $${l.monthlyMax}.` };

  // Reps always credit themselves. An admin can run a payment for any rep.
  let repId = me.id;
  if (me.role === "admin" && s.repId) repId = s.repId;
  if (s.leadId) {
    const { data: lead } = await (await createClient()).from("leads").select("id").eq("id", s.leadId).maybeSingle();
    if (!lead) return { error: "You don't have access to that lead." };
  }

  const { data, error } = await createAdminClient().from("sales").insert({
    lead_id: s.leadId, rep_id: repId, setup_fee: s.setupFee, monthly_price: s.monthlyPrice, source: "stripe",
    status: "pending", plan_snapshot: await planFor(repId), created_by: me.id,
    business_name: s.businessName, contact_name: s.contactName, email: s.email.toLowerCase(), phone: s.phone || null, notes: s.notes || null,
  }).select("id").single();
  if (error) return { error: error.message };
  return { saleId: data.id as string };
}

type SaleRecord = {
  id: string; rep_id: string; created_by: string | null; lead_id: string | null; setup_fee: number; monthly_price: number;
  status: string; business_name: string; contact_name: string; email: string; phone: string | null;
  stripe_subscription_id: string | null; checkout_url: string | null; first_paid_at: string | null;
};

/** Loads a sale the caller may act on: their own, or any sale for an admin. */
async function loadSale(saleId: string): Promise<SaleRecord | null> {
  const me = await requireUser();
  const { data } = await createAdminClient().from("sales").select("*").eq("id", z.uuid().parse(saleId)).maybeSingle();
  const sale = data as SaleRecord | null;
  if (!sale) return null;
  if (me.role !== "admin" && sale.rep_id !== me.id && sale.created_by !== me.id) return null;
  return sale;
}

/** Step 2a: rep types the card in; we charge setup + first month now and start the monthly subscription. */
export async function chargeCard(saleId: string, paymentMethodId: string): Promise<{ ok?: true; error?: string }> {
  const sale = await loadSale(saleId);
  if (!sale) return { error: "Sale not found." };
  if (sale.first_paid_at) return { ok: true };
  if (!stripeConfig().ready) return { error: "Stripe isn't set up yet." };
  const pm = z.string().startsWith("pm_").parse(paymentMethodId);
  const db = createAdminClient();

  try {
    const products = await crmProducts();
    // Idempotency keys: a double-click with the same card can never charge twice.
    const customer = await stripe().customers.create(
      {
        name: sale.contact_name,
        email: sale.email,
        phone: sale.phone ?? undefined,
        description: sale.business_name,
        payment_method: pm,
        invoice_settings: { default_payment_method: pm },
        metadata: { crm_sale_id: sale.id, business_name: sale.business_name },
      },
      { idempotencyKey: `crm-customer-${sale.id}-${pm}` },
    );
    const subscription = await stripe().subscriptions.create(
      {
        customer: customer.id,
        items: [{ price_data: { currency: "usd", product: products.monthly, unit_amount: cents(sale.monthly_price), recurring: { interval: "month" } } }],
        add_invoice_items: Number(sale.setup_fee) > 0
          ? [{ price_data: { currency: "usd", product: products.setup, unit_amount: cents(sale.setup_fee) } }]
          : undefined,
        default_payment_method: pm,
        payment_behavior: "error_if_incomplete",
        metadata: { crm_sale_id: sale.id, rep_id: sale.rep_id },
        expand: ["latest_invoice"],
      },
      { idempotencyKey: `crm-subscription-${sale.id}-${pm}` },
    );
    await db.from("sales").update({ payment_method: "card", stripe_customer_id: customer.id, stripe_subscription_id: subscription.id }).eq("id", sale.id);
    const invoice = subscription.latest_invoice as Stripe.Invoice | null;
    if (invoice && invoice.status === "paid") await recordInvoicePaid(invoice);
    revalidatePath("/payments");
    return { ok: true };
  } catch (err) {
    const message = describeStripeError(err);
    await db.from("sales").update({ last_error: message }).eq("id", sale.id);
    return { error: message };
  }
}

function brandedEmail(clientName: string, businessName: string, url: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#F7F4EC;border-radius:12px;">
    <div style="color:#E3A94C;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">★ ReviewSend</div>
    <h2 style="color:#14171F;margin:0 0 12px;">Hi ${esc(clientName)}, you're almost set up.</h2>
    <p style="color:#4B5563;line-height:1.5;">Tap below to securely add your payment info and get ${esc(businessName)} activated.</p>
    <a href="${url}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#1F6F5C;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Complete Setup</a>
  </div>`;
}

/** Step 2b: a secure Stripe payment page for the client to pay on their own phone (optionally emailed). */
export async function createPaymentLink(saleId: string, sendEmail: boolean): Promise<{ url?: string; emailed?: boolean; error?: string }> {
  const sale = await loadSale(saleId);
  if (!sale) return { error: "Sale not found." };
  if (sale.first_paid_at) return { error: "This sale is already paid." };
  const c = stripeConfig();
  if (!c.ready) return { error: "Stripe isn't set up yet." };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;

  let url = sale.checkout_url;
  if (!url) {
    try {
      const products = await crmProducts();
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        { price_data: { currency: "usd", product: products.monthly, unit_amount: cents(sale.monthly_price), recurring: { interval: "month" } }, quantity: 1 },
      ];
      if (Number(sale.setup_fee) > 0) {
        lineItems.push({ price_data: { currency: "usd", product: products.setup, unit_amount: cents(sale.setup_fee) }, quantity: 1 });
      }
      const session = await stripe().checkout.sessions.create({
        mode: "subscription",
        customer_email: sale.email,
        line_items: lineItems,
        subscription_data: { metadata: { crm_sale_id: sale.id, rep_id: sale.rep_id } },
        metadata: { crm_sale_id: sale.id },
        success_url: `${origin}/pay/thanks`,
        cancel_url: `${origin}/pay/thanks?canceled=1`,
      });
      url = session.url!;
      await createAdminClient().from("sales").update({ payment_method: "link", stripe_checkout_session_id: session.id, checkout_url: url }).eq("id", sale.id);
    } catch (err) {
      return { error: describeStripeError(err) };
    }
  }

  let emailed = false;
  if (sendEmail && c.resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${c.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: c.fromEmail,
        to: sale.email,
        subject: `Complete your ReviewSend signup: ${sale.business_name}`,
        html: brandedEmail(sale.contact_name, sale.business_name, url),
      }),
    }).catch(() => null);
    emailed = Boolean(res?.ok);
  }
  return { url, emailed };
}

/** Polled while waiting for the client to pay through the link. */
export async function getSaleStatus(saleId: string): Promise<{ status?: string; paid?: boolean; error?: string | null }> {
  const sale = await loadSale(saleId);
  if (!sale) return { error: "Sale not found." };
  const { data } = await createAdminClient().from("sales").select("status, first_paid_at, last_error").eq("id", sale.id).single();
  return { status: data?.status, paid: Boolean(data?.first_paid_at), error: data?.last_error };
}

/** Admin: stop a client's subscription (no more charges, no more residuals). */
export async function cancelSubscription(formData: FormData) {
  await requireAdmin();
  const sale = await loadSale(String(formData.get("saleId")));
  if (!sale) return;
  if (sale.stripe_subscription_id) await stripe().subscriptions.cancel(sale.stripe_subscription_id).catch(() => null);
  await createAdminClient().from("sales").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("id", sale.id);
  revalidatePath("/payments");
}

/** Admin backup: record a sale that was paid outside the CRM. Counts immediately. */
export async function recordManualSale(input: SaleInput & { paidOn?: string }): Promise<{ error?: string; ok?: true }> {
  const me = await requireAdmin();
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  const repId = s.repId ?? me.id;
  const plan = await planFor(repId);
  const paidAt = input.paidOn && /^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) ? new Date(`${input.paidOn}T16:00:00Z`).toISOString() : new Date().toISOString();
  const db = createAdminClient();
  const { data, error } = await db.from("sales").insert({
    lead_id: s.leadId, rep_id: repId, setup_fee: s.setupFee, monthly_price: s.monthlyPrice, source: "manual", payment_method: "manual",
    status: "active", plan_snapshot: plan, first_paid_at: paidAt, created_by: me.id,
    business_name: s.businessName, contact_name: s.contactName, email: s.email.toLowerCase(), phone: s.phone || null, notes: s.notes || null,
  }).select("id").single();
  if (error) return { error: error.message };
  if (plan) {
    const c = firstMonthCommission(plan, s.setupFee, s.monthlyPrice);
    await db.from("commissions").insert({
      sale_id: data.id, rep_id: repId, kind: "first_month", period_start: paidAt.slice(0, 10),
      base_amount: c.base, amount: c.amount, explanation: `${c.pct}% of first month (manual sale)`,
    });
  }
  await db.from("events").insert({ type: "sale_paid", rep_id: repId, lead_id: s.leadId, data: { sale_id: data.id, manual: true } });
  if (s.leadId) await db.from("leads").update({ status: "sold", owner_id: repId }).eq("id", s.leadId);
  revalidatePath("/payments");
  return { ok: true };
}

/** Lead search for the payment form (only leads the caller can see). */
export async function searchLeads(q: string) {
  await requireUser();
  const safe = q.replace(/[^a-zA-Z0-9 &'.-]/g, " ").trim();
  const digits = q.replace(/\D/g, "");
  if (safe.length < 2 && digits.length < 3) return [];
  const ors = [`business_name.ilike.%${safe}%`, `contact_name.ilike.%${safe}%`];
  if (digits.length >= 3) ors.push(`phone_e164.like.%${digits}%`);
  const { data } = await (await createClient())
    .from("leads").select("id, business_name, contact_name, email, phone_e164, city, state").or(ors.join(",")).limit(8);
  return data ?? [];
}
