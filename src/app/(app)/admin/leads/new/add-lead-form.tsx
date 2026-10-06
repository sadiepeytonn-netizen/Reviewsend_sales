"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { addLead, type AddLeadState } from "../actions";

export function AddLeadForm() {
  const [state, action, pending] = useActionState<AddLeadState, FormData>(addLead, {});
  const v = state.values ?? {};
  const field = (name: string, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label} htmlFor={`al-${name}`}>
      <Input id={`al-${name}`} name={name} defaultValue={v[name] ?? ""} {...props} />
    </Field>
  );
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {field("contact_name", "Owner's name", { autoFocus: true })}
      {field("business_name", "Business name", { required: true })}
      {field("phone", "Phone", { required: true, inputMode: "tel", placeholder: "(954) 555-1234" })}
      {field("email", "Email", { type: "email" })}
      {field("website", "Website")}
      {field("category", "Category / industry", { placeholder: "e.g. Dentist" })}
      {field("address", "Street address")}
      {field("city", "City")}
      {field("state", "State", { placeholder: "FL" })}
      {field("google_profile_url", "Google profile link")}
      <div className="sm:col-span-2">{field("import_notes", "Notes")}</div>
      {state.error && <div className="sm:col-span-2"><Alert>{state.error}</Alert></div>}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add lead"}</Button>
      </div>
    </form>
  );
}
