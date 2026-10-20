import Link from "next/link";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhone } from "@/lib/phone";
import { addDays, zonedMidnight } from "@/lib/stats";
import { formatTime } from "@/lib/time";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { DISPOSITION_LABELS } from "@/lib/leads";
import { StarButton } from "./star-button";

const PAGE_SIZE = 50;

type Row = {
  id: string; started_at: string; duration_seconds: number | null; disposition: string | null; to_number: string;
  rep_id: string; starred_at: string | null; star_note: string | null; lead: { id: string; business_name: string; contact_name: string | null } | null;
  rep: { full_name: string; email: string } | null;
};

/** Every recorded call, newest first. Everyone hears everyone's calls (to learn from); only admins download. */
export default async function RecordingsPage({ searchParams }: PageProps<"/recordings">) {
  const me = await requireUser();
  const isAdmin = me.role === "admin";
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const rep = one(sp.rep);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.day)) ? one(sp.day) : "";
  const outcome = one(sp.outcome);
  const LONG_SECONDS = 180;
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);

  // Everyone signed in may listen to every recording, so this reads past the per-rep rules.
  const supabase = createAdminClient();

  // Folders: Starred (admin's picks for the reps), Over 3 minutes (real conversations), All.
  const countFor = (f: "starred" | "long" | "all") => {
    let q = supabase.from("calls").select("id", { count: "exact", head: true }).not("recording_sid", "is", null).is("recording_deleted_at", null);
    if (rep) q = q.eq("rep_id", rep);
    if (f === "long") q = q.gte("duration_seconds", LONG_SECONDS);
    if (f === "starred") q = q.filter("starred_at", "not.is", null);
    return q;
  };
  const [{ count: starredCount }, { count: longCount }, { count: allCount }] = await Promise.all([
    countFor("starred"),
    countFor("long"),
    countFor("all"),
  ]);
  // Reps open on Starred when there's something there; admins on Over 3 minutes.
  const asked = one(sp.folder);
  const folder: "starred" | "long" | "all" =
    asked === "starred" || asked === "long" || asked === "all" ? asked : !isAdmin && (starredCount ?? 0) > 0 ? "starred" : "long";
  let query = supabase
    .from("calls")
    .select(
      "id, started_at, duration_seconds, disposition, to_number, rep_id, starred_at, star_note, lead:leads(id, business_name, contact_name), rep:profiles!calls_rep_id_fkey(full_name, email)",
      { count: "exact" },
    )
    .not("recording_sid", "is", null)
    .is("recording_deleted_at", null)
    .order(folder === "starred" ? "starred_at" : "started_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (rep) query = query.eq("rep_id", rep);
  if (day) {
    query = query.gte("started_at", zonedMidnight(day).toISOString()).lt("started_at", zonedMidnight(addDays(day, 1)).toISOString());
  }
  if (folder === "long") query = query.gte("duration_seconds", LONG_SECONDS);
  if (folder === "starred") query = query.filter("starred_at", "not.is", null);
  if (outcome === "none") query = query.is("disposition", null);
  else if (outcome && outcome in DISPOSITION_LABELS) query = query.eq("disposition", outcome);

  const [{ data, count }, { data: people }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (p: number, f: string = folder) => {
    const params = new URLSearchParams({ folder: f, rep, day, outcome, page: String(p) });
    for (const [k, v] of [...params]) if (!v || (k === "page" && v === "1")) params.delete(k);
    const s = params.toString();
    return `/recordings${s ? `?${s}` : ""}`;
  };
  const mmss = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—");

  return (
    <>
      <PageHeader
        title="Recordings"
        description={isAdmin ? "Everyone's recorded calls, newest first. Kept for 1 year. Star the great ones for the reps to study." : "Everyone's recorded calls, newest first. Kept for 1 year. Starred calls are the ones to study."}
      />

      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm sm:w-fit">
        {([["starred", "Starred", starredCount], ["long", "Over 3 minutes", longCount], ["all", "All recordings", allCount]] as const).map(([f, label, n]) => (
          <Link
            key={f}
            href={linkFor(1, f)}
            className={`rounded-md px-4 py-1.5 font-semibold ${folder === f ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {f === "starred" && <Star className="-mt-0.5 mr-1 inline h-4 w-4 text-amber-500" fill="currentColor" />}
            {label} <span className="font-normal text-gray-500">({(n ?? 0).toLocaleString()})</span>
          </Link>
        ))}
      </div>

      <Card className="mb-4 p-4">
        <form className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,12rem))_auto]" action="/recordings">
          <input type="hidden" name="folder" value={folder} />
          <Select name="rep" defaultValue={rep} aria-label="Rep">
            <option value="">Everyone</option>
            {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
          </Select>
          <Input type="date" name="day" defaultValue={day} aria-label="Day" />
          <Select name="outcome" defaultValue={outcome} aria-label="Outcome">
            <option value="">All outcomes</option>
            {Object.entries(DISPOSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="none">No outcome picked</option>
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">Show</Button>
            {(rep || day || outcome) && (
              <Link href={`/recordings?folder=${folder}`}><Button type="button" variant="ghost">Clear</Button></Link>
            )}
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card className="py-12 text-center text-gray-500">
          {folder === "starred"
            ? isAdmin
              ? "Nothing starred yet. Click the star next to a great call so the reps can learn from it."
              : "Nothing starred yet."
            : folder === "long"
              ? "No recorded calls over 3 minutes match."
              : "No recordings match."}
        </Card>
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
                    {r.starred_at && r.star_note && (
                      <p className="mt-0.5 text-sm text-amber-800">
                        <Star className="-mt-0.5 mr-1 inline h-3.5 w-3.5 text-amber-500" fill="currentColor" />
                        {r.star_note}
                      </p>
                    )}
                    <p className="text-sm text-gray-500">
                      {[
                        formatTime(r.started_at),
                        r.rep?.full_name || r.rep?.email,
                        r.disposition ? DISPOSITION_LABELS[r.disposition] ?? r.disposition : "No outcome picked",
                        `talked ${mmss(r.duration_seconds)}`,
                        formatPhone(r.to_number),
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin ? (
                      <StarButton callId={r.id} starred={Boolean(r.starred_at)} note={r.star_note} />
                    ) : (
                      r.starred_at && <Star className="h-5 w-5 shrink-0 text-amber-500" fill="currentColor" aria-label="Starred" />
                    )}
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
