"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { searchLeads } from "../payments/actions";
import { bookAppointment } from "./actions";

type Found = Awaited<ReturnType<typeof searchLeads>>[number];

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "New appointment" panel opened by clicking an empty spot on the calendar. */
export function NewAppointment({
  start,
  isAdmin,
  reps,
  defaultRepId,
  onClose,
  onSaved,
}: {
  start: Date;
  isAdmin: boolean;
  reps: { id: string; name: string }[];
  defaultRepId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [when, setWhen] = useState(() => toLocalInput(start));
  const [minutes, setMinutes] = useState(30);
  const [repId, setRepId] = useState(defaultRepId);
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Search as the rep types (business, owner, or phone).
  useEffect(() => {
    if (picked) return;
    const t = setTimeout(async () => setResults(query.trim().length >= 2 ? await searchLeads(query) : []), 250);
    return () => clearTimeout(t);
  }, [query, picked]);

  async function submit(form: HTMLFormElement) {
    setProblem(null);
    const f = new FormData(form);
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) return setProblem("Pick a date and time.");
    if (tab === "existing" && !picked) return setProblem("Search for the lead and pick it from the list.");
    setSaving(true);
    const res = await bookAppointment({
      leadId: tab === "existing" ? picked!.id : null,
      newLead:
        tab === "new"
          ? {
              ownerName: String(f.get("ownerName") ?? ""),
              businessName: String(f.get("businessName") ?? ""),
              phone: String(f.get("phone") ?? ""),
              email: String(f.get("email") ?? ""),
            }
          : null,
      repId: isAdmin && repId ? repId : null,
      startIso: date.toISOString(),
      minutes,
    });
    setSaving(false);
    if (res.error) return setProblem(res.error);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/30 p-4 sm:items-center" onClick={onClose}>
      <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">New appointment</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(e.currentTarget);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label="Date and time" htmlFor="na-when">
              <Input id="na-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
            </Field>
            <Field label="Length" htmlFor="na-len">
              <Select id="na-len" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </Select>
            </Field>
          </div>
          {isAdmin && (
            <Field label="Rep" htmlFor="na-rep">
              <Select id="na-rep" value={repId} onChange={(e) => setRepId(e.target.value)}>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
          )}

          <div className="flex rounded-lg bg-gray-100 p-1 text-sm">
            {([["existing", "Lead already in the CRM"], ["new", "New client"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`flex-1 rounded-md px-3 py-1.5 font-semibold ${tab === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "existing" ? (
            picked ? (
              <div className="flex items-start justify-between gap-3 rounded-lg bg-brand-50 p-3 ring-1 ring-brand-200">
                <div>
                  <p className="font-semibold text-gray-900">{picked.contact_name || "Owner unknown"}</p>
                  <p className="text-sm text-gray-700">{picked.business_name}</p>
                  <p className="text-sm text-gray-500">{formatPhone(picked.phone_e164)}</p>
                </div>
                <Button type="button" variant="ghost" onClick={() => setPicked(null)}>Change</Button>
              </div>
            ) : (
              <div>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search business, owner, or phone" aria-label="Search leads" autoFocus />
                {results.length > 0 && (
                  <ul className="mt-2 max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg ring-1 ring-gray-200">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => setPicked(r)} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50">
                          <span className="font-medium text-gray-900">{r.business_name}</span>
                          <span className="block text-xs text-gray-500">
                            {[r.contact_name ? `Owner: ${r.contact_name}` : null, formatPhone(r.phone_e164), [r.city, r.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim().length >= 2 && results.length === 0 && (
                  <p className="mt-2 text-sm text-gray-500">
                    No match{isAdmin ? "" : " in your leads"}.{" "}
                    <button type="button" className="text-brand-700 underline" onClick={() => setTab("new")}>Enter it as a new client</button>
                    {" "}(if the phone number is already in the CRM, it&apos;s matched, not duplicated).
                  </p>
                )}
              </div>
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Owner's name" htmlFor="na-owner"><Input id="na-owner" name="ownerName" /></Field>
              <Field label="Business name" htmlFor="na-biz"><Input id="na-biz" name="businessName" required /></Field>
              <Field label="Phone" htmlFor="na-phone"><Input id="na-phone" name="phone" inputMode="tel" required /></Field>
              <Field label="Email (optional)" htmlFor="na-email"><Input id="na-email" name="email" type="email" /></Field>
              <p className="text-xs text-gray-500 sm:col-span-2">If this phone number is already a lead, the appointment goes on that lead (no duplicates).</p>
            </div>
          )}

          {problem && <Alert>{problem}</Alert>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>{saving ? "Booking…" : "Book appointment"}</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
          <p className="text-xs text-gray-500">Booked from the calendar, so it doesn&apos;t count toward &quot;appointments set&quot;. Only Appointment set outcomes on the dialer count.</p>
        </form>
      </Card>
    </div>
  );
}
