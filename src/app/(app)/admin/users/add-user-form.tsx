"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { createUser, type ActionState } from "./actions";
import { TempPasswordNotice } from "./temp-password-notice";

export function AddUserForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createUser, {});

  return (
    <div className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.tempPassword && <TempPasswordNotice email={state.email} password={state.tempPassword} />}
      <form action={formAction} className="grid gap-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
        <Field label="Full name" htmlFor="fullName">
          <Input id="fullName" name="fullName" required placeholder="Ryan Smith" defaultValue={state.values?.fullName} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" required placeholder="ryan@reviewsend.io" defaultValue={state.values?.email} />
        </Field>
        <Field label="Role" htmlFor="role">
          <Select id="role" name="role" key={state.values?.role} defaultValue={state.values?.role ?? "rep"}>
            <option value="rep">Sales rep</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add user"}
        </Button>
      </form>
    </div>
  );
}
