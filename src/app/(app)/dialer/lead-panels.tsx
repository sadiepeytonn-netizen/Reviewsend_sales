"use client";

import { useState } from "react";
import { ExternalLink, Star } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";
import type { DialerCall, DialerLead, DialerNote } from "./actions";
import { formatTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";

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

export function NotesPanel({
  notes,
  calls = [],
  allowDownload = false,
  onAdd,
}: {
  notes: DialerNote[];
  calls?: DialerCall[];
  allowDownload?: boolean;
  onAdd?: (body: string) => Promise<{ error?: string }>;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Card>
      <h3 className="mb-3 font-medium text-gray-900">Notes &amp; call history</h3>
      {onAdd && (
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
      )}
      <History notes={notes} calls={calls} allowDownload={allowDownload} />
    </Card>
  );
}

const REACHED = new Set(["not_interested", "appointment_set", "demo_completed", "sold", "do_not_call"]);

/** Notes and every call (who, when, outcome, recording), newest first. */
export function History({ notes, calls, allowDownload = false }: { notes: DialerNote[]; calls: DialerCall[]; allowDownload?: boolean }) {
  const items = [
    ...notes.map((n) => ({ kind: "note" as const, at: n.created_at, note: n })),
    ...calls.map((c) => ({ kind: "call" as const, at: c.started_at, call: c })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const reached = calls.some((c) => c.disposition && REACHED.has(c.disposition));

  if (items.length === 0) return <p className="mt-4 text-sm text-gray-500">No notes or calls yet.</p>;
  return (
    <>
      {calls.length > 0 && (
        <p className={`mt-4 text-xs font-medium ${!reached && calls.length >= 5 ? "text-red-700" : "text-gray-500"}`}>
          Called {calls.length} time{calls.length === 1 ? "" : "s"}
          {reached ? "" : " · never reached anyone"}
        </p>
      )}
      <ul className="mt-3 max-h-[32rem] space-y-3 overflow-y-auto">
        {items.map((it) =>
          it.kind === "note" ? (
            <li key={`n${it.note.id}`} className="border-l-2 border-gray-300 pl-3">
              <p className="text-xs text-gray-500"><span className="font-medium text-gray-700">{it.note.author}</span> · {when(it.at)}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-900">{it.note.body}</p>
            </li>
          ) : (
            <li key={`c${it.call.id}`} className="border-l-2 border-gray-100 pl-3">
              <p className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">📞 {it.call.rep || "Someone"} called</span> · {when(it.at)}
              </p>
              <p className="text-sm text-gray-700">
                {it.call.disposition ? DISPOSITION_LABELS[it.call.disposition] ?? it.call.disposition : "No outcome picked"}
                {it.call.duration_seconds ? ` · talked ${Math.floor(it.call.duration_seconds / 60)}:${String(it.call.duration_seconds % 60).padStart(2, "0")}` : ""}
                {it.call.from_number ? <span className="text-gray-400"> · from {formatPhone(it.call.from_number)}</span> : null}
              </p>
              {it.call.recording_sid && it.call.recording_deleted_at && (
                <p className="mt-1 text-xs text-gray-400">Recording deleted (older than 1 year)</p>
              )}
              {it.call.recording_sid && !it.call.recording_deleted_at && (
                <div className="mt-1 flex items-center gap-2">
                  <audio controls preload="none" src={`/api/recordings/${it.call.id}`} className="h-8 w-full" />
                  {allowDownload && (
                    <a href={`/api/recordings/${it.call.id}?download=1`} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">Download</a>
                  )}
                </div>
              )}
            </li>
          ),
        )}
      </ul>
    </>
  );
}
