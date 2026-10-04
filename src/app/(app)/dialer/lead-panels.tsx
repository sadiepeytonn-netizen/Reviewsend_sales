"use client";

import { useState } from "react";
import { ExternalLink, Star } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";
import type { DialerCall, DialerLead, DialerNote } from "./actions";
import { formatTime } from "@/lib/time";

const when = (iso: string) => formatTime(iso);

export const DISPOSITION_LABELS: Record<string, string> = {
  no_answer: "No answer",
  not_interested: "Not interested",
  appointment_set: "Appointment set",
  demo_completed: "Demo completed",
  sold: "Sold",
  do_not_call: "Do Not Call",
  bad_number: "Bad number",
};

export function LeadDetails({ lead }: { lead: DialerLead }) {
  const site = lead.website && !/^https?:\/\//i.test(lead.website) ? `https://${lead.website}` : lead.website;
  const rows: [string, React.ReactNode][] = [
    [
      "Google",
      <span key="g" className="inline-flex flex-wrap items-center gap-2">
        {lead.google_rating != null ? (
          <span className="inline-flex items-center gap-1 font-medium">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {lead.google_rating}
          </span>
        ) : "No rating"}
        <span className="text-gray-500">{lead.review_count != null ? `${lead.review_count} reviews` : ""}</span>
        {lead.google_profile_url && (
          <a href={lead.google_profile_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
            Profile <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </span>,
    ],
    ["Category", lead.category ?? "—"],
    ["Website", site ? <a href={site} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{lead.website}</a> : "—"],
    ["Email", lead.email ?? "—"],
    ["Address", [lead.address, lead.city, lead.state].filter(Boolean).join(", ") || "—"],
  ];
  return (
    <Card>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="mt-0.5 text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
      {lead.import_notes && (
        <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 ring-1 ring-gray-200">{lead.import_notes}</p>
      )}
    </Card>
  );
}

export function NotesPanel({ notes, onAdd }: { notes: DialerNote[]; onAdd: (body: string) => Promise<{ error?: string }> }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Card>
      <h3 className="mb-3 font-medium text-gray-900">Notes</h3>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const res = await onAdd(body);
          setSaving(false);
          if (res.error) setError(res.error);
          else {
            setBody("");
            setError(null);
          }
        }}
      >
        {error && <Alert>{error}</Alert>}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Add a note…"
          className="block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm ring-1 ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-brand-500 focus:outline-none"
        />
        <Button type="submit" variant="secondary" disabled={saving || !body.trim()}>{saving ? "Saving…" : "Add note"}</Button>
      </form>
      {notes.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No notes yet.</p>
      ) : (
        <ul className="mt-4 max-h-96 space-y-3 overflow-y-auto">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-gray-200 pl-3">
              <p className="text-xs text-gray-500"><span className="font-medium text-gray-700">{n.author}</span> · {when(n.created_at)}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-900">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PastCalls({ calls, allowDownload = false }: { calls: DialerCall[]; allowDownload?: boolean }) {
  if (calls.length === 0) return null;
  return (
    <Card>
      <h3 className="mb-3 font-medium text-gray-900">Past calls</h3>
      <ul className="space-y-3 text-sm">
        {calls.map((c) => (
          <li key={c.id}>
            <p className="text-gray-900">
              {when(c.started_at)} · {c.disposition ? DISPOSITION_LABELS[c.disposition] ?? c.disposition : "No outcome"}
              {c.duration_seconds ? ` · ${Math.floor(c.duration_seconds / 60)}:${String(c.duration_seconds % 60).padStart(2, "0")}` : ""}
            </p>
            {c.rep && <p className="text-xs text-gray-500">{c.rep}</p>}
            {c.recording_sid && c.recording_deleted_at && (
              <p className="mt-1 text-xs text-gray-400">Recording deleted (older than 1 year)</p>
            )}
            {c.recording_sid && !c.recording_deleted_at && (
              <div className="mt-1 flex items-center gap-2">
                <audio controls preload="none" src={`/api/recordings/${c.id}`} className="h-8 w-full" />
                {allowDownload && (
                  <a href={`/api/recordings/${c.id}?download=1`} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">Download</a>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
