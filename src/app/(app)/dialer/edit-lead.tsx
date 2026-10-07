"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { editLead, type DialerLead, type LeadEdit } from "./actions";

type Editable = Pick<
  DialerLead,
  "id" | "business_name" | "contact_name" | "phone_e164" | "email" | "website" | "address" | "city" | "state" | "category" | "google_profile_url"
>;

const FIELDS: { key: keyof LeadEdit; label: string; type?: string; wide?: boolean }[] = [
  { key: "contact_name", label: "Owner's name" },
  { key: "business_name", label: "Business name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email", type: "email" },
  { key: "website", label: "Website" },
  { key: "category", label: "Category / industry" },
  { key: "address", label: "Street address", wide: true },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "google_profile_url", label: "Google profile link", wide: true },
];

/** "Edit" button + form for fixing a lead's details. Pages refresh after saving; the dialer gets the new lead back. */
export function EditLeadButton({
  lead,
  onSaved,
  label = "Edit",
}: {
  lead: Editable;
  onSaved?: (lead: DialerLead) => void;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const initial: LeadEdit = {
    contact_name: lead.contact_name ?? "",
    business_name: lead.business_name ?? "",
    phone: lead.phone_e164 ? formatPhone(lead.phone_e164) : "",
    email: lead.email ?? "",
    website: lead.website ?? "",
    category: lead.category ?? "",
    address: lead.address ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    google_profile_url: lead.google_profile_url ?? "",
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" /> {label}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30 p-4" onClick={() => setOpen(false)}>
          <Card className="mx-auto my-6 max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Edit lead</h2>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const input = Object.fromEntries(FIELDS.map(({ key }) => [key, String(f.get(key) ?? "")])) as LeadEdit;
                setSaving(true);
                const res = await editLead(lead.id, input);
                setSaving(false);
                if (res.error || !res.lead) return setProblem(res.error ?? "Couldn't save.");
                setProblem(null);
                setOpen(false);
                onSaved?.(res.lead);
                router.refresh();
              }}
            >
              {FIELDS.map(({ key, label: l, type, wide }) => (
                <div key={key} className={wide ? "sm:col-span-2" : ""}>
                  <Field label={l} htmlFor={`el-${key}`}>
                    <Input
                      id={`el-${key}`}
                      name={key}
                      type={type}
                      defaultValue={initial[key]}
                      required={key === "business_name" || key === "phone"}
                      inputMode={key === "phone" ? "tel" : undefined}
                    />
                  </Field>
                </div>
              ))}
              <p className="text-xs text-gray-500 sm:col-span-2">
                Changing the phone number updates the time zone and EAST/WEST list. Every change is saved in the lead&apos;s notes.
              </p>
              {problem && <div className="sm:col-span-2"><Alert>{problem}</Alert></div>}
              <div className="flex gap-3 sm:col-span-2">
                <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
