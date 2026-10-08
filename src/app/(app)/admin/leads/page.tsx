import Link from "next/link";
import { ChevronLeft, ChevronRight, History, PhoneMissed, Plus, ShieldBan, Upload } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { STATUS_LABELS, STATUS_TONES, type LeadStatus } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { moveList, recycleExhausted } from "./actions";

const PAGE_SIZE = 50;

type InventoryRow = {
  list: "EAST" | "WEST" | null;
  ready_now: number; waiting: number; never_called: number; owned: number; closed: number; total: number;
};
type SourceRow = { lead_source: string; total: number; dialed: number; bad_numbers: number; dnc: number };
type LeadRow = {
  id: string; business_name: string; contact_name: string | null; phone_e164: string | null; city: string | null; state: string | null;
  list: "EAST" | "WEST" | null; status: LeadStatus; attempt_count: number; lead_source: string | null;
  owner: { full_name: string } | null;
  assigned_to?: string | null; // private list (after migration 0009)
};

type PrivateRow = { rep_id: string; ready_now: number; waiting: number; total: number };

export default async function LeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  await requireAdmin();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim();
  const list = one(sp.list);
  const status = one(sp.status);
  const source = one(sp.source);
  const folder = one(sp.folder);
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);

  const supabase = await createClient();
  const [{ data: inv }, { data: sources }, { count: exhausted }, { data: privateData }, { data: people }] = await Promise.all([
    supabase.rpc("lead_inventory"),
    supabase.rpc("lead_source_stats"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "exhausted").is("owner_id", null),
    supabase.rpc("private_list_stats"),
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
  ]);
  // Demo missed folders, per rep (needs migration 0011; hidden until then).
  const { data: missedData } = await supabase.from("leads").select("owner_id").not("missed_since", "is", null);
  const missedByRep = new Map<string, number>();
  for (const r of (missedData ?? []) as { owner_id: string | null }[]) {
    if (r.owner_id) missedByRep.set(r.owner_id, (missedByRep.get(r.owner_id) ?? 0) + 1);
  }
  const privateLists = ((privateData ?? []) as PrivateRow[]).filter((r) => Number(r.total) > 0);
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));
  const inventory = (inv ?? []) as InventoryRow[];
  const sourceStats = (sources ?? []) as SourceRow[];

  let query = supabase
    .from("leads")
    .select("*, owner:profiles!leads_owner_id_fkey(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (list === "EAST" || list === "WEST") query = query.eq("list", list);
  if (list === "none") query = query.is("list", null);
  if (status && status in STATUS_LABELS) query = query.eq("status", status);
  if (source) query = query.eq("lead_source", source);
  if (folder === "missed") query = query.not("missed_since", "is", null);
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
    const params = new URLSearchParams({ q, list, status, source, folder, page: String(page) });
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
            <Link href="/admin/leads/never-reached"><Button variant="secondary"><PhoneMissed className="h-4 w-4" /> Never reached</Button></Link>
            <Link href="/admin/leads/imports"><Button variant="secondary"><History className="h-4 w-4" /> Import history</Button></Link>
            <Link href="/admin/leads/new"><Button variant="secondary"><Plus className="h-4 w-4" /> Add a lead</Button></Link>
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

      {missedByRep.size > 0 && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-gray-900">Demo missed folders</h2>
            <Link href={linkFor({ folder: "missed", page: 1 })} className="text-sm font-medium text-brand-600 hover:underline">See everyone in them →</Link>
          </div>
          <p className="mt-1 text-sm text-gray-500">Missed demos each rep is chasing (their dialer&apos;s DEMO MISSED list, called once a day).</p>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {[...missedByRep.entries()].map(([rep, n]) => (
              <li key={rep} className="rounded-lg bg-gray-50 px-3 py-1.5 ring-1 ring-gray-200">
                <span className="font-medium text-gray-900">{nameOf.get(rep) ?? "Former user"}</span> <span className="text-gray-600">· {n}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {privateLists.length > 0 && (
        <Card className="mt-4">
          <h2 className="font-semibold text-gray-900">Private lists</h2>
          <p className="mt-1 text-sm text-gray-500">Leads uploaded for one person. Only they can call them (their dialer&apos;s MY LIST).</p>
          <ul className="mt-3 divide-y divide-gray-100">
            {privateLists.map((r) => (
              <li key={r.rep_id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-40 font-medium text-gray-900">{nameOf.get(r.rep_id) ?? "Former user"}</span>
                <span className="text-gray-600">
                  {Number(r.ready_now).toLocaleString()} ready · {Number(r.waiting).toLocaleString()} waiting · {Number(r.total).toLocaleString()} total
                </span>
                <form action={moveList} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="from" value={r.rep_id} />
                  <Select name="to" aria-label="Move to" className="w-48" defaultValue="">
                    <option value="">Shared pool (everyone)</option>
                    {(people ?? []).filter((p) => p.id !== r.rep_id).map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                    ))}
                  </Select>
                  <ConfirmButton variant="secondary" message="Move this whole private list? (Leads that are already someone's client stay put.)">
                    Move list
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        </Card>
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

      {folder === "missed" && (
        <div className="mt-6 flex items-center gap-3 text-sm text-gray-700">
          Showing only leads in reps&apos; Demo missed folders.
          <Link href={linkFor({ folder: "", page: 1 })} className="font-medium text-brand-600 hover:underline">Show all leads</Link>
        </div>
      )}

      <Card className="mt-6 overflow-hidden p-0">
        <form className="grid gap-3 border-b border-gray-100 p-4 sm:grid-cols-[1fr_9rem_12rem_auto]" action="/admin/leads">
          {folder && <input type="hidden" name="folder" value={folder} />}
          <Input name="q" defaultValue={q} placeholder="Search business, owner, city, or phone" aria-label="Search" />
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
                      <p className="text-xs font-normal text-gray-500">{l.contact_name ? `Owner: ${l.contact_name}` : "Owner unknown"}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-600">{formatPhone(l.phone_e164)}</td>
                    <td className="hidden px-4 py-2 text-gray-600 md:table-cell">{[l.city, l.state].filter(Boolean).join(", ")}</td>
                    <td className="px-4 py-2">{l.list ? <Badge>{l.list}</Badge> : <Badge tone="amber">None</Badge>}</td>
                    <td className="px-4 py-2"><Badge tone={STATUS_TONES[l.status]}>{STATUS_LABELS[l.status]}</Badge></td>
                    <td className="hidden px-4 py-2 text-gray-600 lg:table-cell">
                      {l.owner?.full_name ?? (l.assigned_to ? <span className="text-violet-700">{nameOf.get(l.assigned_to) ?? "Someone"}&apos;s list</span> : "")}
                    </td>
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
