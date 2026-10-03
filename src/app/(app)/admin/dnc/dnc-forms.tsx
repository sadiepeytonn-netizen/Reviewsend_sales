"use client";

import { useActionState, useState } from "react";
import Papa from "papaparse";
import { Alert, Button, Field, Input } from "@/components/ui";
import { addDncNumbers, addOneDnc, type DncResult } from "./actions";

function summary(r: DncResult) {
  const parts = [`${r.added ?? 0} added`];
  if (r.already) parts.push(`${r.already} already on the list`);
  if (r.invalid) parts.push(`${r.invalid} not valid US numbers`);
  return parts.join(", ") + ".";
}

export function AddDncForm() {
  const [state, formAction, pending] = useActionState<DncResult, FormData>(addOneDnc, {});
  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="green">{summary(state)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <Field label="Phone number" htmlFor="phone">
          <Input id="phone" name="phone" required placeholder="(954) 555-0123" />
        </Field>
        <Field label="Reason (optional)" htmlFor="reason">
          <Input id="reason" name="reason" placeholder="Asked not to be called" />
        </Field>
        <Button
          type="submit"
          disabled={pending}
          onClick={(e) => {
            if (!window.confirm("Add this number to Do Not Call permanently? This can't be undone.")) e.preventDefault();
          }}
        >
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}

export function UploadDncForm() {
  const [result, setResult] = useState<DncResult | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(file: File) {
    setResult(null);
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: async (parsed) => {
        const rows = parsed.data;
        // Use a column whose header mentions "phone"; otherwise the first column.
        const header = rows[0]?.map((h) => String(h).toLowerCase()) ?? [];
        const col = Math.max(0, header.findIndex((h) => h.includes("phone")));
        const numbers = rows.map((r) => r[col]).filter(Boolean);
        if (!window.confirm(`Add up to ${numbers.length.toLocaleString()} numbers to Do Not Call permanently?`)) return;

        setBusy(true);
        const total: DncResult = { added: 0, already: 0, invalid: 0 };
        for (let i = 0; i < numbers.length; i += 2000) {
          const r = await addDncNumbers(numbers.slice(i, i + 2000), "Uploaded list", "import");
          if (r.error) {
            setResult({ ...total, error: r.error });
            setBusy(false);
            return;
          }
          total.added! += r.added ?? 0;
          total.already! += r.already ?? 0;
          total.invalid! += r.invalid ?? 0;
        }
        // The header row itself counts as one "invalid" number.
        if (col >= 0 && header[col]?.includes("phone")) total.invalid = Math.max(0, (total.invalid ?? 0) - 1);
        setResult({ ...total, ok: Date.now() });
        setBusy(false);
      },
    });
  }

  return (
    <div className="space-y-3">
      {result?.error && <Alert>{result.error}</Alert>}
      {result?.ok && <Alert tone="green">{summary(result)}</Alert>}
      <p className="text-sm text-gray-600">
        A CSV with one phone number per row. If there&apos;s a column named &quot;Phone&quot;, that one is used; otherwise the first column.
      </p>
      <label className="inline-flex">
        <span className={`inline-flex cursor-pointer items-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50 ${busy ? "opacity-50" : ""}`}>
          {busy ? "Uploading…" : "Choose CSV file"}
        </span>
        <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
    </div>
  );
}
