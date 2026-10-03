"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { signIn, type FormState } from "./actions";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(signIn, {});

  return (
    <form action={formAction} className="space-y-4">
      {notice && <Alert tone="amber">{notice}</Alert>}
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus defaultValue={state.email} />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
