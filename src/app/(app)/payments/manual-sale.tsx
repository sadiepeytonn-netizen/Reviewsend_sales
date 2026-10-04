"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { recordManualSale } from "./actions";

/** Admin backup for a sale that was paid some other way. It counts right away. */
export function ManualSaleForm({ reps, onDone }: { reps: { id: string; name: string }[]; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        const res = await recordManualSale({
          leadId: null,
          repId: String(f.get("repId")),
          businessName: String(f.get("businessName")),
          contactName: String(f.get("contactName")),
          email: String(f.get("email")),
          phone: String(f.get("phone") ?? ""),
          setupFee: Number(f.get("setupFee") || 0),
          monthlyPrice: Number(f.get("monthlyPrice") || 0),
          notes: String(f.get("notes") ?? ""),
          paidOn: String(f.get("paidOn") ?? ""),
        });
        setBusy(false);
        if (res.error) setError(res.error);
        else onDone();
      }}
    >
      {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
      <Field label="Business name" htmlFor="m-b"><Input id="m-b" name="businessName" required /></Field>
      <Field label="Client name" htmlFor="m-c"><Input id="m-c" name="contactName" required /></Field>
      <Field label="Email" htmlFor="m-e"><Input id="m-e" name="email" type="email" required /></Field>
      <Field label="Phone" htmlFor="m-p"><Input id="m-p" name="phone" /></Field>
      <Field label="Setup fee" htmlFor="m-s"><Input id="m-s" name="setupFee" type="number" min={0} step="0.01" defaultValue={0} /></Field>
      <Field label="Monthly price" htmlFor="m-m"><Input id="m-m" name="monthlyPrice" type="number" min={0} step="0.01" required /></Field>
      <Field label="Credit to" htmlFor="m-r"><Select id="m-r" name="repId">{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      <Field label="Paid on" htmlFor="m-d"><Input id="m-d" name="paidOn" type="date" /></Field>
      <Field label="Notes" htmlFor="m-n"><Input id="m-n" name="notes" /></Field>
      <p className="text-xs text-gray-500 sm:col-span-2">
        The first-month commission is added now. Monthly residuals only come from Stripe payments, so they won&apos;t be tracked for this one.
      </p>
      <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record sale"}</Button></div>
    </form>
  );
}
