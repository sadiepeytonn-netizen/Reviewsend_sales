import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPhone } from "@/lib/phone";
import { addDays, zonedMidnight } from "@/lib/stats";
import { formatTime } from "@/lib/time";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { DISPOSITION_LABELS } from "@/lib/leads";

const PAGE_SIZE = 50;

type Row = {
  id: string; started_at: string; duration_seconds: number | null; disposition: string | null; to_number: string;
  rep_id: string; lead: { id: string; business_name: string; contact_name: string | null } | null;
  rep: { full_name: string; email: string } | null;
};

/** Every recorded call, newest first. Reps see their own; admins see everyone's and can download. */
export default async function RecordingsPage({ searchParams }: PageProps<"/recordings">) {
  const me = await requireUser();
  const isAdmin = me.role === "admin";
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const rep = isAdmin ? one(sp.rep) : "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.day)) ? one(sp.day) : "";
  const outcome = one(sp.outcome);
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);

  const supabase = await createClient();
  // Row-level security already limits reps to their own calls.
  let query = supabase
    .from("calls")
    .select(
      "id, started_at, duration_seconds, disposition, to_number, rep_id, lead:leads(id, business_name, contact_name), rep:profiles(full_name, email)",
      { count: "exact" },
    )
    .not("recording_sid", "is", null)
    .is("recording_deleted_at", null)
    .order("started_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (rep) query = query.eq("rep_id", rep);
  if (day) {
    query = query.gte("started_at", zonedMidnight(day).toISOString()).lt("started_at", zonedMidnight(addDays(day, 1)).toISOString());
  }
  if (outcome === "none") query = query.is("disposition", null);
  else if (outcome && outcome in DISPOSITION_LABELS) query = query.eq("disposition", outcome);

  const [{ data, count }, { data: people }] = await Promise.all([
    query,
    isAdmin
      ? supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (p: number) => {
    const params = new URLSearchParams({ rep, day, outcome, page: String(p) });
    for (const [k, v] of [...params]) if (!v || (k === "page" && v === "1")) params.delete(k);
    const s = params.toString();
    return `/recordings${s ? `?${s}` : ""}`;
  };
  const mmss = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—");

  return (
    <>
      <PageHeader
        title="Recordings"
        description={isAdmin ? "Every recorded call, newest first. Kept for 1 year." : "Your recorded calls, newest first. Kept for 1 year."}
      />

      <Card className="mb-4 p-4">
        <form className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,12rem))_auto]" action="/recordings">
          {isAdmin && (
            <Select name="rep" defaultValue={rep} aria-label="Rep">
              <option value="">Everyone</option>
              {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          )}
          <Input type="date" name="day" defaultValue={day} aria-label="Day" />
          <Select name="outcome" defaultValue={outcome} aria-label="Outcome">
            <option value="">All outcomes</option>
            {Object.entries(DISPOSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="none">No outcome picked</option>
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">Show</Button>
            {(rep || day || outcome) && <Link href="/recordings"><Button type="button" variant="ghost">Clear</Button></Link>}
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card className="py-12 text-center text-gray-500">No recordings match.</Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const who = r.lead?.contact_name || r.lead?.business_name || formatPhone(r.to_number);
              return (
                <li key={r.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">
                      {isAdmin && r.lead ? (
                        <Link href={`/admin/leads/${r.lead.id}`} className="hover:underline">{who}</Link>
                      ) : (
                        who
                      )}
                      {r.lead?.contact_name && <span className="font-normal text-gray-500"> · {r.lead.business_name}</span>}
                    </p>
                    <p className="text-sm text-gray-500">
                      {[
                        formatTime(r.started_at),
                        isAdmin ? r.rep?.full_name || r.rep?.email : null,
                        r.disposition ? DISPOSITION_LABELS[r.disposition] ?? r.disposition : "No outcome picked",
                        `talked ${mmss(r.duration_seconds)}`,
                        formatPhone(r.to_number),
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <audio controls preload="none" src={`/api/recordings/${r.id}`} className="h-9 w-full" />
                    {isAdmin && (
                      <a href={`/api/recordings/${r.id}?download=1`} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
                        Download
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
            <span>{total.toLocaleString()} recording{total === 1 ? "" : "s"}</span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                {page > 1 && <Link href={linkFor(page - 1)} className="rounded p-1 hover:bg-gray-100" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Link>}
                <span>Page {page} of {pages}</span>
                {page < pages && <Link href={linkFor(page + 1)} className="rounded p-1 hover:bg-gray-100" aria-label="Next page"><ChevronRight className="h-4 w-4" /></Link>}
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
