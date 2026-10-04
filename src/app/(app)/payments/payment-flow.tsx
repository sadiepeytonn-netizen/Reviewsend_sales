"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeCardElement } from "@stripe/stripe-js";
import { CheckCircle2, Copy, CreditCard, Mail, Search } from "lucide-react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { chargeCard, createPaymentLink, getSaleStatus, searchLeads, startSale } from "./actions";

export type PrefillLead = {
  id: string;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  phone_e164: string | null;
};

type Step = "details" | "pay" | "paid";
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

let stripePromise: Promise<Stripe | null> | null = null;

/**
 * The whole payment while the client is on the phone:
 *   1. deal details  2. card or payment link  3. paid → book onboarding.
 * Used on the Payments page and inside the dialer (so the call stays connected).
 */
export function PaymentFlow({
  lead,
  isAdmin,
  reps,
  defaultRepId,
  publishableKey,
  emailEnabled,
  onboardingUrl,
  limits,
  onDone,
}: {
  lead?: PrefillLead | null;
  isAdmin: boolean;
  reps: { id: string; name: string }[];
  defaultRepId: string;
  publishableKey: string | null;
  emailEnabled: boolean;
  onboardingUrl: string;
  limits: { setupMax: number; monthlyMin: number; monthlyMax: number };
  onDone?: () => void;
}) {
  const [step, setStep] = useState<Step>("details");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saleId, setSaleId] = useState<string | null>(null);

  const [picked, setPicked] = useState<PrefillLead | null>(lead ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(PrefillLead & { city: string | null; state: string | null })[]>([]);
  const [form, setForm] = useState({
    businessName: lead?.business_name ?? "",
    contactName: lead?.contact_name ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone_e164 ? formatPhone(lead.phone_e164) : "",
    setupFee: "",
    monthlyPrice: "",
    notes: "",
    repId: defaultRepId,
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setup = Number(form.setupFee || 0);
  const monthly = Number(form.monthlyPrice || 0);

  const [method, setMethod] = useState<"card" | "link">("card");
  const [link, setLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const cardElRef = useRef<StripeCardElement | null>(null);

  // Lead search
  useEffect(() => {
    if (picked || query.trim().length < 2) return;
    const t = setTimeout(async () => setResults((await searchLeads(query)) as typeof results), 250);
    return () => clearTimeout(t);
  }, [query, picked]);

  // Mount Stripe's secure card box (card numbers never touch our servers).
  useEffect(() => {
    if (step !== "pay" || method !== "card" || !publishableKey || !cardRef.current) return;
    let card: StripeCardElement | null = null;
    let cancelled = false;
    (async () => {
      stripePromise ??= loadStripe(publishableKey);
      const s = await stripePromise.catch(() => null);
      if (!s && !cancelled) {
        stripePromise = null;
        setError("Couldn't load Stripe's secure card form. Check the internet connection and try again, or use a payment link.");
        return;
      }
      if (!s || cancelled || !cardRef.current) return;
      stripeRef.current = s;
      card = s.elements().create("card", { style: { base: { fontSize: "16px", color: "#111827" } } });
      card.mount(cardRef.current);
      cardElRef.current = card;
    })();
    return () => {
      cancelled = true;
      card?.destroy();
      cardElRef.current = null;
    };
  }, [step, method, publishableKey]);

  // While waiting on a payment link, check every 3 seconds.
  useEffect(() => {
    if (step !== "pay" || method !== "link" || !link || !saleId) return;
    const t = setInterval(async () => {
      const s = await getSaleStatus(saleId);
      if (s.paid) setStep("paid");
    }, 3000);
    return () => clearInterval(t);
  }, [step, method, link, saleId]);

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (monthly < limits.monthlyMin || monthly > limits.monthlyMax) return setError(`Monthly price must be between ${usd(limits.monthlyMin)} and ${usd(limits.monthlyMax)}.`);
    if (setup > limits.setupMax) return setError(`Setup fee can be at most ${usd(limits.setupMax)}.`);
    setBusy(true);
    const res = await startSale({
      leadId: picked?.id ?? null,
      repId: isAdmin ? form.repId : null,
      businessName: form.businessName,
      contactName: form.contactName,
      email: form.email,
      phone: form.phone,
      setupFee: setup,
      monthlyPrice: monthly,
      notes: form.notes,
    });
    setBusy(false);
    if (res.error || !res.saleId) return setError(res.error ?? "Couldn't start the payment.");
    setSaleId(res.saleId);
    setStep("pay");
  }

  async function charge() {
    if (!saleId || !stripeRef.current || !cardElRef.current) return;
    setError(null);
    setBusy(true);
    const { paymentMethod, error: pmError } = await stripeRef.current.createPaymentMethod({
      type: "card",
      card: cardElRef.current,
      billing_details: { name: form.contactName, email: form.email },
    });
    if (pmError || !paymentMethod) {
      setBusy(false);
      return setError(pmError?.message ?? "Check the card details.");
    }
    const res = await chargeCard(saleId, paymentMethod.id).catch(() => ({ error: "Couldn't reach the payment server. Check the connection and try again." }) as { error: string });
    setBusy(false);
    if (res.error) return setError(res.error);
    setStep("paid");
  }

  async function makeLink(sendEmail: boolean) {
    if (!saleId) return;
    setError(null);
    setBusy(true);
    const res = await createPaymentLink(saleId, sendEmail).catch(
      () => ({ error: "Couldn't reach the payment server. Check the connection and try again." }) as { error: string; url?: string; emailed?: boolean },
    );
    setBusy(false);
    if (res.error || !res.url) return setError(res.error ?? "Couldn't create the link.");
    setLink(res.url);
    setEmailed(Boolean(res.emailed));
    if (sendEmail && !res.emailed) setError("The email couldn't be sent. Copy the link and send it yourself.");
  }

  const calendly = (() => {
    try {
      const u = new URL(onboardingUrl);
      u.searchParams.set("name", form.contactName);
      u.searchParams.set("email", form.email);
      u.searchParams.set("a1", form.businessName);
      u.searchParams.set("hide_gdpr_banner", "1");
      return u.toString();
    } catch {
      return onboardingUrl;
    }
  })();

  const steps = ["Deal", "Payment", "Onboarding"];
  const stepIndex = step === "details" ? 0 : step === "pay" ? 1 : 2;

  return (
    <div className="space-y-5">
      <ol className="flex gap-2 text-xs">
        {steps.map((s, i) => (
          <li key={s} className={`flex-1 rounded-full px-3 py-1.5 text-center font-medium ${i === stepIndex ? "bg-brand-600 text-white" : i < stepIndex ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
            {i < stepIndex ? "✓ " : `${i + 1}. `}{s}
          </li>
        ))}
      </ol>

      {error && <Alert>{error}</Alert>}

      {step === "details" && (
        <form onSubmit={submitDetails} className="space-y-4">
          {!lead && (
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">Client</p>
              {picked ? (
                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm ring-1 ring-gray-200">
                  <span><b>{picked.business_name}</b> {picked.phone_e164 ? `· ${formatPhone(picked.phone_e164)}` : ""}</span>
                  <button type="button" className="text-gray-500 hover:underline" onClick={() => setPicked(null)}>Change</button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-gray-400" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a lead by business, name, or phone, or fill in a new client below" className="pl-9" aria-label="Search leads" />
                  {results.length > 0 && query.trim().length >= 2 && (
                    <ul className="absolute z-10 mt-1 w-full rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-gray-200">
                      {results.map((r) => (
                        <li key={r.id}>
                          <button type="button" className="w-full px-3 py-2 text-left hover:bg-gray-50"
                            onClick={() => {
                              setPicked(r);
                              setForm((f) => ({ ...f, businessName: r.business_name, contactName: r.contact_name ?? f.contactName, email: r.email ?? f.email, phone: r.phone_e164 ? formatPhone(r.phone_e164) : f.phone }));
                              setResults([]);
                            }}>
                            <b>{r.business_name}</b> <span className="text-gray-500">{[formatPhone(r.phone_e164), [r.city, r.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" htmlFor="pf-business"><Input id="pf-business" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} required /></Field>
            <Field label="Client name" htmlFor="pf-contact"><Input id="pf-contact" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} required /></Field>
            <Field label="Email (for the receipt)" htmlFor="pf-email"><Input id="pf-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required /></Field>
            <Field label="Phone" htmlFor="pf-phone"><Input id="pf-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label={`Setup fee ($0–$${limits.setupMax})`} htmlFor="pf-setup" hint="Enter 0 to waive it.">
              <Input id="pf-setup" type="number" min={0} max={limits.setupMax} step="0.01" value={form.setupFee} onChange={(e) => set("setupFee", e.target.value)} placeholder="0" />
            </Field>
            <Field label={`Monthly price ($${limits.monthlyMin}–$${limits.monthlyMax})`} htmlFor="pf-monthly">
              <Input id="pf-monthly" type="number" min={limits.monthlyMin} max={limits.monthlyMax} step="0.01" value={form.monthlyPrice} onChange={(e) => set("monthlyPrice", e.target.value)} placeholder="299" required />
            </Field>
            {isAdmin && (
              <Field label="Credit this sale to" htmlFor="pf-rep" hint="The sale and commission go to this person.">
                <Select id="pf-rep" value={form.repId} onChange={(e) => set("repId", e.target.value)}>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Notes (optional)" htmlFor="pf-notes"><Input id="pf-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>

          {monthly > 0 && (
            <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700 ring-1 ring-brand-100">
              Charged today: <b>{usd(setup + monthly)}</b>{setup > 0 ? ` (${usd(setup)} setup + ${usd(monthly)} first month)` : ""}, then <b>{usd(monthly)}/month</b> automatically.
            </div>
          )}
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Continue to payment"}</Button>
        </form>
      )}

      {step === "pay" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            <b>{form.businessName}</b>: {usd(setup + monthly)} today, then {usd(monthly)}/month.
          </p>
          <div className="flex rounded-lg bg-gray-100 p-1 text-sm">
            <button onClick={() => setMethod("card")} className={`flex-1 rounded-md px-3 py-1.5 font-medium ${method === "card" ? "bg-white shadow-sm" : "text-gray-500"}`}>
              <CreditCard className="mr-1 inline h-4 w-4" /> Enter card now
            </button>
            <button onClick={() => setMethod("link")} className={`flex-1 rounded-md px-3 py-1.5 font-medium ${method === "link" ? "bg-white shadow-sm" : "text-gray-500"}`}>
              <Mail className="mr-1 inline h-4 w-4" /> Payment link
            </button>
          </div>

          {method === "card" ? (
            publishableKey ? (
              <div className="space-y-3">
                <div ref={cardRef} className="rounded-lg bg-white px-3 py-3 ring-1 ring-gray-300" />
                <p className="text-xs text-gray-500">Read the card number, expiry, CVV, and ZIP from the client. Card details go straight to Stripe.</p>
                <Button onClick={charge} disabled={busy} className="bg-green-600 hover:bg-green-700">
                  {busy ? "Charging…" : `Charge ${usd(setup + monthly)} & start subscription`}
                </Button>
              </div>
            ) : (
              <Alert tone="amber">Card payments aren&apos;t set up yet (Stripe settings missing).</Alert>
            )
          ) : (
            <div className="space-y-3">
              {!link ? (
                <div className="flex flex-wrap gap-2">
                  {emailEnabled && <Button onClick={() => makeLink(true)} disabled={busy}><Mail className="h-4 w-4" /> Email the link to {form.email}</Button>}
                  <Button variant="secondary" onClick={() => makeLink(false)} disabled={busy}>Create link to copy</Button>
                </div>
              ) : (
                <>
                  {emailed && <Alert tone="green">Emailed to {form.email}. Ask the client to open it now.</Alert>}
                  <div className="flex gap-2">
                    <Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Payment link" />
                    <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>
                      <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> Waiting for the client to pay… this updates by itself.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {step === "paid" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-green-50 px-4 py-3 text-green-900 ring-1 ring-green-200">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
            <div>
              <p className="font-semibold">Paid ✓ {usd(setup + monthly)}</p>
              <p className="text-sm">{form.businessName} is signed up at {usd(monthly)}/month. Now book their onboarding call before you hang up.</p>
            </div>
          </div>
          <iframe src={calendly} title="Book onboarding" className="h-[640px] w-full rounded-lg ring-1 ring-gray-200" />
          {onDone && <Button variant="secondary" onClick={onDone}>Done</Button>}
        </div>
      )}
    </div>
  );
}
