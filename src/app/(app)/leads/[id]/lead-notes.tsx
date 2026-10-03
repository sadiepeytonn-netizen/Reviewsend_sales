"use client";

import { useState } from "react";
import { addLeadNote, type DialerNote } from "../../dialer/actions";
import { NotesPanel } from "../../dialer/lead-panels";

export function LeadNotes({ leadId, initial }: { leadId: string; initial: DialerNote[] }) {
  const [notes, setNotes] = useState(initial);
  return (
    <NotesPanel
      notes={notes}
      onAdd={async (body) => {
        const res = await addLeadNote(leadId, body);
        if (res.note) setNotes((n) => [res.note!, ...n]);
        return res;
      }}
    />
  );
}
