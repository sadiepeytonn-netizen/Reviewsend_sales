import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Star } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { STATUS_LABELS, STATUS_TONES, timezoneLabel, type LeadStatus } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { Badge, Button, Card, PageHeader, Select } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { markLeadDnc, setLeadList } from "./actions";
import { NoteForm } from "./note-form";
import { loadLeadContext } from "../../../dialer/actions";
import { PastCalls } from "../../../dialer/lead-panels";
import { formatTime } from "@/lib/time";

type Lead = {
  id: string; business_name: string; contact_name: string | null; phone_e164: string | null; phone_raw: string | null;
  email: string | null; website: string | null; address: string | null; city: string | null; state: string | null;
  category: string | null; google_rating: number | null; review_count: number | null; google_profile_url: string | null;
  lead_source: string | null; import_notes: string | null; timezone: string | null; list: "EAST" | "WEST" | null;
  status: LeadStatus; attempt_count: number; last_called_at: string | null; next_call_at: string; created_at: string;
  owner: { full_name: string } | null;
};
type Note = { id: string; body: string; created_at: string; author: { full_name: string; email: string } | null };

const when = (iso: string) => formatTime(iso);

export default async function LeadPage({ params }: PageProps<"/admin/leads/[id]">) {
  const { id } = await params;
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: leadData }, { data: notesData }] = await Promise.all([
    supabase.from("leads").select("*, owner:profiles!leads_owner_id_fkey(full_name)").eq("id", id).maybeSingle(),
    supabase.from("lead_notes").select("id, body, created_at, author:profiles(full_name, email)").eq("lead_id", id).order("created_at", { ascending: false }),
  ]);
  if (!leadData) notFound();
  const lead = leadData as unknown as Lead;
  const notes = (notesData ?? []) as unknown as Note[];

  const calls = (await loadLeadContext(id))?.calls ?? [];
  const site = lead.website && !/^https?:\/\//i.test(lead.website) ? `https://${lead.website}` : lead.website;

  return (
    <>
      <Link href="/admin/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Leads
      </Link>
      <PageHeader
        title={lead.business_name}
        description={[lead.contact_name, [lead.city, lead.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
        actions={<Badge tone={STATUS_TONES[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <Item label="Phone">{formatPhone(lead.phone_e164) || lead.phone_raw || "—"}</Item>
              <Item label="Email">{lead.email ?? "—"}</Item>
              <Item label="Website">
                {site ? <a href={site} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{lead.website}</a> : "—"}
              </Item>
              <Item label="Address">{[lead.address, lead.city, lead.state].filter(Boolean).join(", ") || "—"}</Item>
              <Item label="Category">{lead.category ?? "—"}</Item>
              <Item label="Google">
                <span className="inline-flex items-center gap-2">
                  {lead.google_rating != null ? (
                    <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{lead.google_rating}</span>
                  ) : "—"}
                  {lead.review_count != null && <span className="text-gray-500">({lead.review_count} reviews)</span>}
                  {lead.google_profile_url && (
                    <a href={lead.google_profile_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                      Profile <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </span>
              </Item>
              <Item label="Time zone">{timezoneLabel(lead.timezone)}</Item>
              <Item label="Lead source">{lead.lead_source ?? "—"}</Item>
              <Item label="Dials so far">{lead.attempt_count}{lead.last_called_at ? ` · last ${when(lead.last_called_at)}` : ""}</Item>
              <Item label="Rep">{lead.owner?.full_name ?? "Shared pool"}</Item>
            </dl>
            {lead.import_notes && (
              <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 ring-1 ring-gray-200">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Notes from the import file</p>
                {lead.import_notes}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-medium text-gray-900">Notes</h2>
            <NoteForm leadId={lead.id} />
            {notes.length > 0 && (
              <ul className="mt-5 space-y-4">
                {notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-gray-200 pl-3">
                    <p className="text-xs text-gray-500">
                      <span className="font-medium text-gray-700">{n.author?.full_name || n.author?.email || "Someone"}</span> · {when(n.created_at)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <PastCalls calls={calls} allowDownload />
          <Card>
            <h2 className="mb-3 font-medium text-gray-900">Dialing list</h2>
            <form action={setLeadList} className="flex gap-2">
              <input type="hidden" name="leadId" value={lead.id} />
              <Select name="list" defaultValue={lead.list ?? ""} aria-label="List" required>
                {!lead.list && <option value="" disabled>Choose…</option>}
                <option value="EAST">EAST (Eastern + Central)</option>
                <option value="WEST">WEST (Mountain + Pacific)</option>
              </Select>
              <Button type="submit" variant="secondary">Save</Button>
            </form>
          </Card>

          {lead.status !== "do_not_call" && lead.phone_e164 && (
            <Card>
              <h2 className="font-medium text-gray-900">Do Not Call</h2>
              <p className="mt-1 mb-3 text-sm text-gray-600">Adds {formatPhone(lead.phone_e164)} to the permanent Do Not Call list. This can&apos;t be undone.</p>
              <form action={markLeadDnc}>
                <input type="hidden" name="leadId" value={lead.id} />
                <ConfirmButton variant="danger" message="Add this number to Do Not Call permanently?">Add to Do Not Call</ConfirmButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-gray-900">{children}</dd>
    </div>
  );
}
