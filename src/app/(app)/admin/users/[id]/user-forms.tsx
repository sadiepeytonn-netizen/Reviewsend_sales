"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import type { Profile } from "@/lib/types";
import { resetPassword, updateProfile, type ActionState } from "../actions";
import { TempPasswordNotice } from "../temp-password-notice";

export function ProfileForm({ user }: { user: Profile }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateProfile, {});
  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert tone="green">{state.success}</Alert>}
      <input type="hidden" name="userId" value={user.id} />
      <Field label="Full name" htmlFor="fullName">
        <Input id="fullName" name="fullName" defaultValue={user.full_name} required />
      </Field>
      <Field label="Role" htmlFor="role">
        <Select id="role" name="role" defaultValue={user.role === "admin" ? "admin" : "rep"}>
          <option value="rep">Sales rep</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(resetPassword, {});
  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={(e) => {
        if (!confirm("Reset this person's password? Their current password will stop working.")) e.preventDefault();
      }}
    >
      {state.error && <Alert>{state.error}</Alert>}
      {state.tempPassword && <TempPasswordNotice email={state.email} password={state.tempPassword} />}
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm text-gray-600">
        Makes a new temporary password. They&apos;ll pick their own the next time they sign in.
      </p>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Resetting…" : "Reset password"}
      </Button>
    </form>
  );
}
