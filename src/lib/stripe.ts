import "server-only";
import Stripe from "stripe";

// Stripe settings live in Vercel environment variables (see docs/SETUP.md, step 6).
export function stripeConfig() {
  const c = {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    productIds: (process.env.STRIPE_PRODUCT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    resendKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.PAYMENT_FROM_EMAIL || "ReviewSend <billing@reviewsend.io>",
  };
  const missing = [
    !c.secretKey && "STRIPE_SECRET_KEY",
    !c.publishableKey && "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    !c.webhookSecret && "STRIPE_WEBHOOK_SECRET",
    c.productIds.length === 0 && "STRIPE_PRODUCT_IDS",
  ].filter(Boolean) as string[];
  return { ...c, missing, ready: missing.length === 0 };
}

// Pinned to the API version chosen for the webhook in the Stripe dashboard, so
// API responses and webhook events have the same shape. (The library's own
// default can be newer than what the account offers.)
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(stripeConfig().secretKey!, {
      apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    });
  }
  return client;
}

let productCache: { monthly: string; setup: string } | null = null;

/**
 * The two products every CRM sale is filed under. Whichever product's name
 * mentions "setup" is the setup fee; the other is the monthly plan. With only
 * one product, both lines use it.
 */
export async function crmProducts(): Promise<{ monthly: string; setup: string }> {
  if (productCache) return productCache;
  const ids = stripeConfig().productIds;
  const products = await Promise.all(ids.map((id) => stripe().products.retrieve(id)));
  const setup = products.find((p) => /setup/i.test(p.name)) ?? products[0];
  const monthly = products.find((p) => p.id !== setup.id) ?? products[0];
  productCache = { monthly: monthly.id, setup: setup.id };
  return productCache;
}

/** A Stripe error in words a rep can read to the client (from the old pay site). */
export function describeStripeError(err: unknown): string {
  const e = err as { raw?: { decline_code?: string; code?: string; message?: string }; decline_code?: string; code?: string; message?: string };
  const raw = e?.raw ?? e;
  const code = raw?.decline_code || raw?.code;
  const map: Record<string, string> = {
    insufficient_funds: "Card declined: insufficient funds.",
    incorrect_cvc: "Card declined: the security code (CVV) is incorrect.",
    invalid_cvc: "Card declined: the security code (CVV) is incorrect.",
    incorrect_number: "Card declined: the card number is incorrect.",
    invalid_number: "Card declined: the card number is invalid.",
    expired_card: "Card declined: this card has expired.",
    card_declined: "Card declined by the bank. Ask the client to call their bank, or try another card.",
    generic_decline: "Card declined by the bank. Ask the client to call their bank, or try another card.",
    do_not_honor: "Card declined by the bank. Ask the client to call their bank, or try another card.",
    processing_error: "A processing error occurred. Try again.",
    incorrect_zip: "Card declined: the billing ZIP code doesn't match.",
    authentication_required: "The bank wants the client to confirm this payment. Send them the payment link instead.",
  };
  const type = (err as { type?: string })?.type;
  if (type === "StripeConnectionError" || type === "StripeAPIError" || /Invalid JSON|ECONN|network/i.test(raw?.message ?? "")) {
    return "Couldn't reach Stripe just now. Wait a moment and try again.";
  }
  if (type === "StripeAuthenticationError") return "Stripe rejected the CRM's key. Check STRIPE_SECRET_KEY in Vercel.";
  return (code && map[code]) || raw?.message || "Card declined. Try again or use a different card.";
}

export const cents = (dollars: number) => Math.round(Number(dollars) * 100);
