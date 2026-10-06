"use client";

import { useState } from "react";
import { addLeadNote, type DialerCall, type DialerNote } from "../../dialer/actions";
import { NotesPanel } from "../../dialer/lead-panels";

export function LeadNotes({
  leadId,
  initial,
  calls,
  allowDownload,
}: {
  leadId: string;
  initial: DialerNote[];
  calls: DialerCall[];
  allowDownload: boolean;
}) {
  const [notes, setNotes] = useState(initial);
  return (
    <NotesPanel
      notes={notes}
      calls={calls}
      allowDownload={allowDownload}
      onAdd={async (body) => {
        const res = await addLeadNote(leadId, body);
        if (res.note) setNotes((n) => [res.note!, ...n]);
        return res;
      }}
    />
  );
}
