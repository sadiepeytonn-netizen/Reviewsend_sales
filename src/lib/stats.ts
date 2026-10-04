import { APP_TIME_ZONE } from "@/lib/time";

export type RangeKey = "today" | "week" | "month" | "custom";

/** Minutes the zone is ahead of UTC at a given instant (Eastern: -240 or -300). */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value; // "GMT-04:00"
  const m = parts?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Midnight at the start of a calendar day ("2026-10-05") in the business time zone, as a real instant. */
export function zonedMidnight(day: string, tz = APP_TIME_ZONE): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60_000;
  t = guess - offsetMinutes(new Date(t), tz) * 60_000; // second pass for daylight-saving edges
  return new Date(t);
}

/** "2026-10-05" for an instant, in the business time zone. */
export function zonedDay(at: Date, tz = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/** Calendar days [fromDay, toDay] (inclusive) for a range choice, plus the instants [from, to). */
export function resolveRange(range: string | undefined, customFrom?: string, customTo?: string, now = new Date()) {
  const today = zonedDay(now);
  let key: RangeKey = (["today", "week", "month", "custom"] as const).includes(range as RangeKey) ? (range as RangeKey) : "today";
  let fromDay = today;
  let toDay = today;
  if (key === "week") {
    const [y, m, d] = today.split("-").map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
    fromDay = addDays(today, -dow);
  } else if (key === "month") {
    fromDay = `${today.slice(0, 8)}01`;
  } else if (key === "custom") {
    const ok = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
    if (ok(customFrom) && ok(customTo) && customFrom! <= customTo!) {
      fromDay = customFrom!;
      toDay = customTo!;
    } else key = "today";
  }
  return { key, fromDay, toDay, from: zonedMidnight(fromDay), to: zonedMidnight(addDays(toDay, 1)) };
}

export const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "—");

export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.round(Number(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export const money = (n: number | null | undefined) => {
  if (n == null) return "—";
  const v = Number(n);
  const digits = Number.isInteger(v) ? 0 : 2; // $499 but $249.50
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
};

export type RepStats = {
  rep_id: string; rep_name: string; dials: number; contacts: number; answered_calls: number; talk_seconds: number;
  logged_in_seconds: number; on_call_seconds: number; ready_seconds: number; wrap_up_seconds: number; idle_seconds: number;
  paused_seconds: number; paused_lunch: number; paused_break: number; paused_meeting: number; paused_training: number;
  paused_other: number; avg_gap_seconds: number | null; appointments: number; demos: number; showed: number; missed: number;
  pitched_no_sale: number; sales: number; mrr: number; first_month_commission: number; residual_commission: number | null;
};

/** Adds up rep rows into one team row. Database numbers arrive as strings, so coerce. */
export function teamTotals(rows: RepStats[]): RepStats {
  const sum = (k: keyof RepStats) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const gaps = rows.filter((r) => r.avg_gap_seconds != null);
  return {
    rep_id: "team", rep_name: "Team",
    dials: sum("dials"), contacts: sum("contacts"), answered_calls: sum("answered_calls"), talk_seconds: sum("talk_seconds"),
    logged_in_seconds: sum("logged_in_seconds"), on_call_seconds: sum("on_call_seconds"), ready_seconds: sum("ready_seconds"),
    wrap_up_seconds: sum("wrap_up_seconds"), idle_seconds: sum("idle_seconds"), paused_seconds: sum("paused_seconds"),
    paused_lunch: sum("paused_lunch"), paused_break: sum("paused_break"), paused_meeting: sum("paused_meeting"),
    paused_training: sum("paused_training"), paused_other: sum("paused_other"),
    avg_gap_seconds: gaps.length ? gaps.reduce((a, r) => a + Number(r.avg_gap_seconds), 0) / gaps.length : null,
    appointments: sum("appointments"), demos: sum("demos"), showed: sum("showed"), missed: sum("missed"),
    pitched_no_sale: sum("pitched_no_sale"), sales: sum("sales"), mrr: sum("mrr"),
    first_month_commission: sum("first_month_commission"),
    residual_commission: rows.some((r) => r.residual_commission != null) ? sum("residual_commission") : null,
  };
}

export function normalize(r: RepStats): RepStats {
  const out = { ...r } as Record<string, unknown>;
  for (const [k, v] of Object.entries(r)) {
    if (k !== "rep_id" && k !== "rep_name" && v != null) out[k] = Number(v);
  }
  return out as RepStats;
}
