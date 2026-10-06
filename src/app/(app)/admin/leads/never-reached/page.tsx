import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPhone } from "@/lib/phone";
import { STATUS_LABELS, STATUS_TONES, type LeadStatus } from "@/lib/leads";
import { formatTime } from "@/lib/time";
import { Alert, Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { removeLeads } from "../actions";
import { SelectAll } from "./select-all";

type Row = {
  id: string; business_name: string; contact_name: string | null; phone_e164: string | null;
  status: LeadStatus; calls: number; last_called: string | null; assigned_to: string | null;
};

export default async function NeverReachedPage({ searchParams }: PageProps<"/admin/leads/never-reached">) {
  await requireAdmin();
  const sp = await searchParams;
  const min = Math.min(500, Math.max(2, Number.parseInt(String(sp.min ?? "10"), 10) || 10));
  const supabase = await createClient();
  const [{ data, error }, { data: people }] = await Promise.all([
    supabase.rpc("never_reached_leads", { p_min_calls: min }),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const rows = (data ?? []) as Row[];
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));

  return (
    <>
      <Link href="/admin/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Leads
      </Link>
      <PageHeader
        title="Never reached"
        description="Leads called again and again without one real conversation (only no answers, voicemails, or bad numbers). Remove them so reps stop dialing them."
      />
      {error && <Alert tone="amber">This needs the latest database update (0009). See docs/SETUP.md.</Alert>}

      <Card className="mb-4 p-4">
        <form className="flex flex-wrap items-center gap-3 text-sm" action="/admin/leads/never-reached">
          <label htmlFor="min" className="text-gray-700">Called at least</label>
          <Input id="min" name="min" type="number" min={2} max={500} defaultValue={min} className="w-24" />
          <span className="text-gray-700">times, never reached</span>
          <Button type="submit" variant="secondary">Show</Button>
        </form>
      </Card>

      {!error && rows.length === 0 && <Card className="py-12 text-center text-gray-500">No leads match. Nice.</Card>}

      {rows.length > 0 && (
        <form action={removeLeads}>
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-sm">
              <SelectAll />
              <ConfirmButton variant="danger" message="Remove the checked leads from dialing? They stay in the CRM (with their history) but nobody will be given them again.">
                Remove checked from dialing
              </ConfirmButton>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="w-10 px-4 py-2" />
                  <th className="px-4 py-2 font-medium">Business</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="px-4 py-2 text-right font-medium">Calls</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Last called</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2"><input type="checkbox" name="id" value={r.id} defaultChecked aria-label={`Select ${r.business_name}`} /></td>
                    <td className="px-4 py-2">
                      <Link href={`/admin/leads/${r.id}`} className="font-medium text-gray-900 hover:underline">{r.business_name}</Link>
                      <p className="text-xs text-gray-500">
                        {[r.contact_name ? `Owner: ${r.contact_name}` : null, r.assigned_to ? `${nameOf.get(r.assigned_to) ?? "Someone"}'s list` : null].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-600">{formatPhone(r.phone_e164)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900">{r.calls}</td>
                    <td className="hidden px-4 py-2 text-gray-600 md:table-cell">{r.last_called ? formatTime(r.last_called) : ""}</td>
                    <td className="hidden px-4 py-2 md:table-cell"><Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </form>
      )}
    </>
  );
}
