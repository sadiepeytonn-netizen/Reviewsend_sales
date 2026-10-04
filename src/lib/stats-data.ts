import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalize, resolveRange, teamTotals, type RepStats } from "@/lib/stats";
import type { DailyRow } from "@/components/stats/trend-chart";

type Params = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads the date range from the URL and loads per-rep stats + daily trend. */
export async function loadStats(searchParams: Params, repId?: string) {
  const range = resolveRange(one(searchParams.range), one(searchParams.from), one(searchParams.to));
  // A one-day view still shows a trend for the last 14 days.
  const trendFrom = range.fromDay === range.toDay ? addDaysLocal(range.toDay, -13) : range.fromDay;
  const supabase = await createClient();
  const [{ data: rows, error }, { data: daily }] = await Promise.all([
    supabase.rpc("rep_stats", { p_from: range.from.toISOString(), p_to: range.to.toISOString() }),
    supabase.rpc("daily_stats", { p_from: trendFrom, p_to: range.toDay, p_rep: repId ?? null }),
  ]);
  // Most likely cause: the step 5 database update hasn't been run yet. Show the
  // page with a message instead of crashing it.
  const setupError = error
    ? error.code === "PGRST202" || /function .*does not exist|Could not find the function/i.test(error.message)
      ? "The stats database update (supabase/migrations/0005_stats.sql) hasn't been run yet. Run it in the Supabase SQL Editor, then reload."
      : `Couldn't load stats: ${error.message}`
    : null;
  const reps = ((rows ?? []) as RepStats[]).map(normalize);
  const query = `?${new URLSearchParams(Object.entries({ range: range.key, from: range.key === "custom" ? range.fromDay : "", to: range.key === "custom" ? range.toDay : "" }).filter(([, v]) => v)).toString()}`;
  return { range, reps, team: teamTotals(reps), daily: (daily ?? []) as DailyRow[], query, setupError };
}

function addDaysLocal(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function rangeLabel(r: { key: string; fromDay: string; toDay: string }) {
  const f = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  return r.fromDay === r.toDay ? f(r.fromDay) : `${f(r.fromDay)} – ${f(r.toDay)}`;
}
