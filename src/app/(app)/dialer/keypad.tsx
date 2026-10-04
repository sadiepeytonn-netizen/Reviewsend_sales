"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Delete, Pencil, Phone, Search, UserRound } from "lucide-react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { setOwnerName, type DialerLead } from "./actions";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

/** "Dial a number": a fold-out keypad for calling any number by hand. */
export function KeypadPanel({
  busy,
  disabled,
  defaultOpen = false,
  onDial,
}: {
  busy: boolean;
  disabled?: string;
  defaultOpen?: boolean;
  onDial: (raw: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState("");
  const digits = value.replace(/\D/g, "");

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-gray-900"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Dial a number
      </button>
      {open && (
        <form
          className="space-y-3 border-t border-gray-100 px-5 pb-5 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (digits.length >= 10 && !disabled) onDial(value);
          }}
        >
          <div className="flex gap-2">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="(954) 555-1234"
              inputMode="tel"
              aria-label="Phone number"
              className="font-mono text-lg"
            />
            <button
              type="button"
              onClick={() => setValue((v) => v.slice(0, -1))}
              className="rounded-lg px-2 text-gray-500 hover:bg-gray-100"
              aria-label="Delete last digit"
            >
              <Delete className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setValue((v) => v + k)}
                className="rounded-lg bg-gray-100 py-2 text-lg font-semibold text-gray-800 hover:bg-gray-200"
              >
                {k}
              </button>
            ))}
          </div>
          {disabled && <p className="text-sm text-amber-700">{disabled}</p>}
          <Button type="submit" disabled={busy || digits.length < 10 || Boolean(disabled)} className="w-full bg-green-600 hover:bg-green-700">
            <Phone className="h-4 w-4" /> Call {digits.length >= 10 ? formatPhone(value) : ""}
          </Button>
          <p className="text-xs text-gray-500">
            If the number is already a lead, it opens with its notes. If it&apos;s new, you&apos;ll save it as a lead after the call.
          </p>
        </form>
      )}
    </div>
  );
}

/** Copy the number and search it on Google (reps look up the business before calling). */
export function PhoneTools({ phone }: { phone: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!phone) return null;
  const pretty = formatPhone(phone);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(pretty);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked: nothing to do */
          }
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy number"}
      </Button>
      <a
        href={`https://www.google.com/search?q=${encodeURIComponent(`"${pretty}"`)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
      >
        <Search className="h-4 w-4" /> Google it
      </a>
    </div>
  );
}

/** The business owner's name, front and center, editable right on the dialer. */
export function OwnerName({ lead, onSaved }: { lead: DialerLead; onSaved: (name: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(lead.contact_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await setOwnerName(lead.id, value);
    setSaving(false);
    if (res.error) return setError(res.error);
    setError(null);
    setEditing(false);
    onSaved(value.trim() || null);
  }

  if (editing || !lead.contact_name) {
    return (
      <div className={`rounded-lg p-3 ${lead.contact_name ? "bg-gray-50" : "bg-amber-50 ring-1 ring-amber-200"}`}>
        {!lead.contact_name && !editing && (
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <UserRound className="h-4 w-4" /> Owner&apos;s name missing. Find it and add it here.
          </p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (!editing) setEditing(true);
            }}
            placeholder="Owner's name"
            aria-label="Owner's name"
            className="max-w-xs"
          />
          <Button type="submit" disabled={saving || (!value.trim() && !lead.contact_name)}>Save</Button>
          {editing && lead.contact_name && (
            <Button type="button" variant="ghost" onClick={() => { setEditing(false); setValue(lead.contact_name ?? ""); }}>Cancel</Button>
          )}
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <UserRound className="h-6 w-6 text-brand-600" />
      <span className="text-3xl font-bold tracking-tight text-gray-900">{lead.contact_name}</span>
      <button onClick={() => setEditing(true)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Edit owner's name">
        <Pencil className="h-4 w-4" />
      </button>
    </div>
  );
}

/** After a keypad call to a number that isn't in the CRM: save it as a lead, or skip. */
export function SaveNewNumber({
  phone,
  busy,
  hadCall,
  onSave,
  onSkip,
}: {
  phone: string;
  busy: boolean;
  hadCall: boolean;
  onSave: (input: { businessName: string; ownerName: string; email?: string }) => Promise<{ error?: string }>;
  onSkip: (d: "no_answer" | "bad_number") => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Card>
      <h3 className="text-lg font-semibold text-gray-900">Save this number as a lead</h3>
      <p className="mt-1 text-sm text-gray-500">Then you&apos;ll pick the outcome like any other call.</p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const res = await onSave({
            ownerName: String(f.get("ownerName") ?? ""),
            businessName: String(f.get("businessName") ?? ""),
            email: String(f.get("email") ?? ""),
          });
          setProblem(res.error ?? null);
        }}
      >
        <Field label="Owner's name" htmlFor="nn-owner"><Input id="nn-owner" name="ownerName" autoFocus /></Field>
        <Field label="Business name" htmlFor="nn-biz"><Input id="nn-biz" name="businessName" required /></Field>
        <Field label="Phone" htmlFor="nn-phone"><Input id="nn-phone" value={formatPhone(phone)} readOnly className="bg-gray-50" /></Field>
        <Field label="Email (optional)" htmlFor="nn-email"><Input id="nn-email" name="email" type="email" /></Field>
        {problem && <div className="sm:col-span-2"><Alert>{problem}</Alert></div>}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy}>Save lead</Button>
          <span className="text-sm text-gray-500">or, if you didn&apos;t reach the business:</span>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onSkip("no_answer")}>
            {hadCall ? "No answer" : "Cancel"}, don&apos;t save
          </Button>
          {hadCall && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onSkip("bad_number")}>Wrong number</Button>
          )}
        </div>
      </form>
    </Card>
  );
}
