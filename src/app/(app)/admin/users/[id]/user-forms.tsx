"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import type { Profile } from "@/lib/types";
import { resetPassword, setShareSlug, updateProfile, type ActionState } from "../actions";
import { suggestSlug } from "@/lib/share/slug";
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

/** reviewsend.io/<name>: the address prospects open to watch this person's screen. */
export function ShareSlugForm({ user }: { user: Profile }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(setShareSlug, {});
  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert tone="green">{state.success}</Alert>}
      <input type="hidden" name="userId" value={user.id} />
      <Field label="Link name" htmlFor="slug" hint="Lowercase letters, numbers or dashes. Leave blank to turn screen sharing off for them.">
        <div className="flex items-center rounded-lg ring-1 ring-gray-300 focus-within:ring-2 focus-within:ring-brand-500">
          <span className="pl-3 text-sm text-gray-500">reviewsend.io/</span>
          <input
            id="slug"
            name="slug"
            defaultValue={state.values?.slug ?? user.share_slug ?? ""}
            placeholder={suggestSlug(user.full_name)}
            className="min-w-0 flex-1 rounded-r-lg border-0 bg-transparent py-2 pr-3 text-sm focus:outline-none"
          />
        </div>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save link"}</Button>
    </form>
  );
}
