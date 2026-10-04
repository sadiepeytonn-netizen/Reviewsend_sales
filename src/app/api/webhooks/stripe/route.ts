import type Stripe from "stripe";
import { linkCheckoutSession, markSaleByInvoice, markSubscriptionCanceled, recordInvoicePaid } from "@/lib/payments";
import { stripe, stripeConfig } from "@/lib/stripe";

// Stripe calls this URL when payments happen. Configure it in Stripe →
// Developers → Webhooks (see docs/SETUP.md, step 6). Events for payments that
// didn't come from the CRM (like the old pay site) are ignored.
export async function POST(req: Request) {
  const { webhookSecret } = stripeConfig();
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, req.headers.get("stripe-signature") ?? "", webhookSecret ?? "");
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "invoice.paid":
        await recordInvoicePaid(event.data.object);
        break;
      case "invoice.payment_failed":
        await markSaleByInvoice(event.data.object, "past_due");
        break;
      case "customer.subscription.deleted":
        await markSubscriptionCanceled(event.data.object);
        break;
      case "checkout.session.completed":
        await linkCheckoutSession(event.data.object);
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry later, which is what we want for a temporary problem.
    console.error("Stripe webhook failed", event.type, (err as Error).message);
    return new Response("Handler error", { status: 500 });
  }
  return Response.json({ received: true });
}
