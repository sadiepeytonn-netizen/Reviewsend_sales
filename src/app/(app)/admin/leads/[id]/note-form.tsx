"use client";

import { useActionState } from "react";
import { Alert, Button } from "@/components/ui";
import { addNote, type NoteState } from "./actions";

export function NoteForm({ leadId }: { leadId: string }) {
  const [state, formAction, pending] = useActionState<NoteState, FormData>(addNote, {});
  return (
    <form action={formAction} className="space-y-2">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="leadId" value={leadId} />
      <textarea
        key={state.ok}
        name="body"
        rows={3}
        required
        placeholder="Add a note…"
        className="block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm ring-1 ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-brand-500 focus:outline-none"
      />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Add note"}</Button>
    </form>
  );
}
