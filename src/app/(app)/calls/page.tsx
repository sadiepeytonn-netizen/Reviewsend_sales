import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhone } from "@/lib/phone";
import { addDays, zonedMidnight } from "@/lib/stats";
import { formatTime } from "@/lib/time";
import { Alert, Badge, Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { DISPOSITION_LABELS } from "@/lib/leads";
import { FIX_DAYS, countMissingOutcomes, outcomeWindow } from "@/lib/call-outcomes";
import { OpenLeadButton, OutcomeButton } from "./row-actions";

const PAGE_SIZE = 50;
const LOCKED = new Set(["do_not_call", "sold"]);

type Row = {
  id: string; started_at: string; ended_at: string | null; duration_seconds: number | null; disposition: string | null;
  to_number: string; rep_id: string; recording_sid: string | null; recording_deleted_at: string | null; manual: boolean;
  lead: { id: string; business_name: string; contact_name: string | null; timezone: string | null } | null;
  rep: { full_name: string; email: string } | null;
};

/** Every call a rep has made (admins: everyone's), newest first, with Open lead and Pick / Change outcome. */
export default async function CallsPage({ searchParams }: PageProps<"/calls">) {
  const me = await requireUser();
  const isAdmin = me.role === "admin";
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const rep = isAdmin ? one(sp.rep) : me.id;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.day)) ? one(sp.day) : "";
  const outcome = one(sp.outcome);
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);

  // Signed in above; reps are limited to their own calls below.
  const db = createAdminClient();
  const { settled, fixFrom } = outcomeWindow();

  let query = db
    .from("calls")
    .select(
      "id, started_at, ended_at, duration_seconds, disposition, to_number, rep_id, recording_sid, recording_deleted_at, manual, lead:leads(id, business_name, contact_name, timezone), rep:profiles!calls_rep_id_fkey(full_name, email)",
      { count: "exact" },
    )
    .order("started_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (rep) query = query.eq("rep_id", rep);
  if (day) query = query.gte("started_at", zonedMidnight(day).toISOString()).lt("started_at", zonedMidnight(addDays(day, 1)).toISOString());
  if (outcome === "none") query = query.is("disposition", null);
  else if (outcome && outcome in DISPOSITION_LABELS) query = query.eq("disposition", outcome);

  const [{ data, count }, missing, { data: people }] = await Promise.all([
    query,
    countMissingOutcomes(db, me.id), // my calls still missing an outcome (the reminder at the top)
    isAdmin
      ? db.from("profiles").select("id, full_name, email").eq("active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkFor = (p: number, o: string = outcome) => {
    const params = new URLSearchParams({ rep: isAdmin ? rep : "", day, outcome: o, page: String(p) });
    for (const [k, v] of [...params]) if (!v || (k === "page" && v === "1")) params.delete(k);
    const s = params.toString();
    return `/calls${s ? `?${s}` : ""}`;
  };
  const mmss = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "0:00");
  const canFix = (r: Row) =>
    !LOCKED.has(r.disposition ?? "") &&
    (r.ended_at !== null || r.started_at < settled) &&
    (isAdmin || (r.rep_id === me.id && r.started_at >= fixFrom));

  return (
    <>
      <PageHeader
        title="Call history"
        description={
          isAdmin
            ? "Every call, newest first. Open the lead, or pick / change a call's outcome (any call)."
            : `All your calls, newest first. You can pick or change the outcome of calls from the last ${FIX_DAYS} days.`
        }
      />

      {missing > 0 && outcome !== "none" && (
        <div className="mb-4">
          <Alert tone="amber">
            You have <b>{missing}</b> call{missing === 1 ? "" : "s"} without an outcome. They don&apos;t count as contacts or earn
            points until you pick one.{" "}
            <Link href={`/calls?outcome=none${isAdmin ? `&rep=${me.id}` : ""}`} className="font-semibold underline">Show them</Link>
          </Alert>
        </div>
      )}

      <Card className="mb-4 p-4">
        <form className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,12rem))_auto]" action="/calls">
          {isAdmin && (
            <Select name="rep" defaultValue={rep} aria-label="Rep">
              <option value="">Everyone</option>
              {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </Select>
          )}
          <Input type="date" name="day" defaultValue={day} aria-label="Day" />
          <Select name="outcome" defaultValue={outcome} aria-label="Outcome">
            <option value="">All outcomes</option>
            <option value="none">No outcome picked</option>
            {Object.entries(DISPOSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">Show</Button>
            {((isAdmin && rep) || day || outcome) && (
              <Link href="/calls"><Button type="button" variant="ghost">Clear</Button></Link>
            )}
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card className="py-12 text-center text-gray-500">{outcome === "none" ? "No calls missing an outcome. Nice!" : "No calls match."}</Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const who = r.lead?.contact_name || r.lead?.business_name || formatPhone(r.to_number);
              const hasRecording = r.recording_sid && !r.recording_deleted_at;
              return (
                <li key={r.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">
                      {who}
                      {r.lead?.contact_name && <span className="font-normal text-gray-500"> · {r.lead.business_name}</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                      {r.disposition ? (
                        <Badge tone={LOCKED.has(r.disposition) ? "red" : "gray"}>{DISPOSITION_LABELS[r.disposition] ?? r.disposition}</Badge>
                      ) : (
                        <Badge tone="amber">No outcome picked</Badge>
                      )}
                      <span>
                        {[
                          formatTime(r.started_at),
                          isAdmin ? r.rep?.full_name || r.rep?.email : null,
                          `talked ${mmss(r.duration_seconds)}`,
                          formatPhone(r.to_number),
                          r.manual ? "keypad" : null,
                        ].filter(Boolean).join(" · ")}
                      </span>
                    </p>
                    {hasRecording && <audio controls preload="none" src={`/api/recordings/${r.id}`} className="mt-2 h-8 w-full max-w-md" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.lead &&
                      (isAdmin ? (
                        <Link href={`/admin/leads/${r.lead.id}`}><Button variant="secondary">Open lead</Button></Link>
                      ) : (
                        <OpenLeadButton callId={r.id} />
                      ))}
                    {canFix(r) && (
                      <OutcomeButton callId={r.id} missing={!r.disposition} who={who} leadTimezone={r.lead?.timezone ?? null} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
            <span>{total.toLocaleString()} call{total === 1 ? "" : "s"}</span>
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
