import Link from "next/link";
import { ChevronLeft, ChevronRight, History, ShieldBan, Upload } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { STATUS_LABELS, STATUS_TONES, type LeadStatus } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { recycleExhausted } from "./actions";

const PAGE_SIZE = 50;

type InventoryRow = {
  list: "EAST" | "WEST" | null;
  ready_now: number; waiting: number; never_called: number; owned: number; closed: number; total: number;
};
type SourceRow = { lead_source: string; total: number; dialed: number; bad_numbers: number; dnc: number };
type LeadRow = {
  id: string; business_name: string; phone_e164: string | null; city: string | null; state: string | null;
  list: "EAST" | "WEST" | null; status: LeadStatus; attempt_count: number; lead_source: string | null;
  owner: { full_name: string } | null;
};

export default async function LeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  await requireAdmin();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim();
  const list = one(sp.list);
  const status = one(sp.status);
  const source = one(sp.source);
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);

  const supabase = await createClient();
  const [{ data: inv }, { data: sources }, { count: exhausted }] = await Promise.all([
    supabase.rpc("lead_inventory"),
    supabase.rpc("lead_source_stats"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "exhausted").is("owner_id", null),
  ]);
  const inventory = (inv ?? []) as InventoryRow[];
  const sourceStats = (sources ?? []) as SourceRow[];

  let query = supabase
    .from("leads")
    .select("id, business_name, phone_e164, city, state, list, status, attempt_count, lead_source, owner:profiles!leads_owner_id_fkey(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (list === "EAST" || list === "WEST") query = query.eq("list", list);
  if (list === "none") query = query.is("list", null);
  if (status && status in STATUS_LABELS) query = query.eq("status", status);
  if (source) query = query.eq("lead_source", source);
  if (q) {
    // Keep only characters that are safe inside a search filter.
    const safe = q.replace(/[^a-zA-Z0-9 &'.-]/g, " ").trim();
    const digits = q.replace(/\D/g, "");
    const ors = [`business_name.ilike.%${safe}%`, `city.ilike.%${safe}%`, `contact_name.ilike.%${safe}%`];
    if (digits.length >= 3) ors.push(`phone_e164.like.%${digits}%`);
    if (safe || digits.length >= 3) query = query.or(ors.join(","));
  }

  const { data, count } = await query;
  const leads = (data ?? []) as unknown as LeadRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const linkFor = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams({ q, list, status, source, page: String(page) });
    for (const [k, v] of Object.entries(overrides)) params.set(k, String(v));
    for (const [k, v] of [...params]) if (!v || (k === "page" && v === "1")) params.delete(k);
    const s = params.toString();
    return `/admin/leads${s ? `?${s}` : ""}`;
  };

  const byList = (l: "EAST" | "WEST") => inventory.find((r) => r.list === l);
  const noList = inventory.find((r) => r.list === null);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Everything in the system, and what's left to call."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/dnc"><Button variant="secondary"><ShieldBan className="h-4 w-4" /> Do Not Call</Button></Link>
            <Link href="/admin/leads/imports"><Button variant="secondary"><History className="h-4 w-4" /> Import history</Button></Link>
            <Link href="/admin/leads/import"><Button><Upload className="h-4 w-4" /> Import leads</Button></Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {(["EAST", "WEST"] as const).map((l) => {
          const r = byList(l);
          return (
            <Card key={l}>
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold text-gray-900">{l} list</h2>
                <span className="text-xs text-gray-500">{l === "EAST" ? "Eastern + Central" : "Mountain, Pacific, Alaska, Hawaii"}</span>
              </div>
              <p className="mt-3 text-3xl font-semibold text-gray-900">{(r?.ready_now ?? 0).toLocaleString()}</p>
              <p className="text-sm text-gray-500">ready to call now</p>
              <dl className="mt-4 grid grid-cols-4 gap-2 text-sm">
                <Mini label="Waiting for retry" value={r?.waiting} />
                <Mini label="Never called" value={r?.never_called} />
                <Mini label="Owned by reps" value={r?.owned} />
                <Mini label="Total" value={r?.total} />
              </dl>
            </Card>
          );
        })}
      </div>

      {noList && noList.total > 0 && (
        <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          {noList.total.toLocaleString()} lead{noList.total === 1 ? "" : "s"} couldn&apos;t be placed on EAST or WEST (unknown area code and no state).{" "}
          <Link href={linkFor({ list: "none", page: 1 })} className="font-medium underline">Review them</Link> and set the list by hand.
        </div>
      )}

      {(exhausted ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-200">
          <span>
            <b>{(exhausted ?? 0).toLocaleString()}</b> lead{exhausted === 1 ? "" : "s"} hit the no-answer limit and left the pool.
          </span>
          <form action={recycleExhausted}>
            <ConfirmButton variant="secondary" message="Put all exhausted leads back in the dialing pool (attempt count resets)?">
              Recycle them
            </ConfirmButton>
          </form>
        </div>
      )}

      {sourceStats.length > 0 && (
        <Card className="mt-6 overflow-hidden p-0">
          <h2 className="px-6 pt-5 font-medium text-gray-900">Lead sources</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-2 font-medium">Source</th>
                <th className="px-6 py-2 text-right font-medium">Leads</th>
                <th className="px-6 py-2 text-right font-medium">Dialed</th>
                <th className="px-6 py-2 text-right font-medium">Bad numbers</th>
                <th className="px-6 py-2 text-right font-medium">Bad-number rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sourceStats.map((s) => (
                <tr key={s.lead_source}>
                  <td className="px-6 py-2 font-medium text-gray-900">
                    <Link href={linkFor({ source: s.lead_source, page: 1 })} className="hover:underline">{s.lead_source}</Link>
                  </td>
                  <td className="px-6 py-2 text-right">{Number(s.total).toLocaleString()}</td>
                  <td className="px-6 py-2 text-right">{Number(s.dialed).toLocaleString()}</td>
                  <td className="px-6 py-2 text-right">{Number(s.bad_numbers).toLocaleString()}</td>
                  <td className="px-6 py-2 text-right">
                    {Number(s.dialed) > 0 ? `${Math.round((Number(s.bad_numbers) / Number(s.dialed)) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-6 overflow-hidden p-0">
        <form className="grid gap-3 border-b border-gray-100 p-4 sm:grid-cols-[1fr_9rem_12rem_auto]" action="/admin/leads">
          <Input name="q" defaultValue={q} placeholder="Search business, contact, city, or phone" aria-label="Search" />
          <Select name="list" defaultValue={list} aria-label="List">
            <option value="">All lists</option>
            <option value="EAST">EAST</option>
            <option value="WEST">WEST</option>
            <option value="none">No list</option>
          </Select>
          <Select name="status" defaultValue={status} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {source && <input type="hidden" name="source" value={source} />}
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {source && (
          <div className="border-b border-gray-100 px-4 py-2 text-sm text-gray-600">
            Source: <b>{source}</b> · <Link href={linkFor({ source: "", page: 1 })} className="text-brand-600 hover:underline">clear</Link>
          </div>
        )}

        {leads.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-gray-500">
            {total === 0 && !q && !list && !status && !source ? (
              <>No leads yet. <Link href="/admin/leads/import" className="font-medium text-brand-600 hover:underline">Import a CSV</Link> to get started.</>
            ) : "No leads match those filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Business</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Location</th>
                  <th className="px-4 py-2 font-medium">List</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="hidden px-4 py-2 font-medium lg:table-cell">Rep</th>
                  <th className="hidden px-4 py-2 text-right font-medium lg:table-cell">Dials</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">
                      <Link href={`/admin/leads/${l.id}`} className="hover:underline">{l.business_name}</Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-600">{formatPhone(l.phone_e164)}</td>
                    <td className="hidden px-4 py-2 text-gray-600 md:table-cell">{[l.city, l.state].filter(Boolean).join(", ")}</td>
                    <td className="px-4 py-2">{l.list ? <Badge>{l.list}</Badge> : <Badge tone="amber">None</Badge>}</td>
                    <td className="px-4 py-2"><Badge tone={STATUS_TONES[l.status]}>{STATUS_LABELS[l.status]}</Badge></td>
                    <td className="hidden px-4 py-2 text-gray-600 lg:table-cell">{l.owner?.full_name ?? ""}</td>
                    <td className="hidden px-4 py-2 text-right text-gray-600 lg:table-cell">{l.attempt_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
          <span>{total.toLocaleString()} lead{total === 1 ? "" : "s"}</span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              {page > 1 && <Link href={linkFor({ page: page - 1 })} className="rounded p-1 hover:bg-gray-100" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Link>}
              <span>Page {page} of {pages}</span>
              {page < pages && <Link href={linkFor({ page: page + 1 })} className="rounded p-1 hover:bg-gray-100" aria-label="Next page"><ChevronRight className="h-4 w-4" /></Link>}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function Mini({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{Number(value ?? 0).toLocaleString()}</dd>
    </div>
  );
}
