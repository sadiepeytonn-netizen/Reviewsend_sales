"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Phone, Plus, X } from "lucide-react";
import { Badge, Button, Card, Select } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { getAppointments, getNeedsOutcome, type CalendarAppointment } from "./actions";
import { APPOINTMENT_LABELS, AppointmentActions } from "./appointment-actions";
import { NewAppointment } from "./new-appointment";

const ROW = 80; // pixels per hour

// One color per rep in the admin's combined view.
const REP_COLORS = [
  "bg-blue-100 text-blue-900 ring-blue-300",
  "bg-emerald-100 text-emerald-900 ring-emerald-300",
  "bg-violet-100 text-violet-900 ring-violet-300",
  "bg-amber-100 text-amber-900 ring-amber-300",
  "bg-pink-100 text-pink-900 ring-pink-300",
  "bg-cyan-100 text-cyan-900 ring-cyan-300",
];

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** The next quarter hour from now. */
function nextSlot() {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15);
  return d;
}

/** Side-by-side placement for overlapping appointments within one day. */
function layoutDay(appts: CalendarAppointment[]) {
  const sorted = [...appts].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const placed: { appt: CalendarAppointment; lane: number; lanes: number }[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = 0;
  const laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => (c.lanes = lanes));
    placed.push(...cluster);
    cluster = [];
    laneEnds.length = 0;
  };
  for (const appt of sorted) {
    const s = Date.parse(appt.starts_at);
    const e = Math.max(Date.parse(appt.ends_at), s + 15 * 60_000);
    if (cluster.length && s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = e;
    clusterEnd = Math.max(clusterEnd, e);
    cluster.push({ appt, lane, lanes: 1 });
  }
  flush();
  return placed;
}

export function CalendarView({
  meId,
  isAdmin,
  reps,
  initialRepId,
}: {
  meId: string;
  isAdmin: boolean;
  reps: { id: string; name: string }[];
  initialRepId?: string;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [repId, setRepId] = useState(initialRepId ?? "");
  const [appts, setAppts] = useState<CalendarAppointment[]>([]);
  const [needsOutcome, setNeedsOutcome] = useState<CalendarAppointment[]>([]);
  const [selected, setSelected] = useState<CalendarAppointment | null>(null);
  const [booking, setBooking] = useState<Date | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Dates depend on the viewer's clock and time zone, so draw only in the browser.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i); // calendar days, so daylight-saving changes don't shift anything
        return d;
      }),
    [weekStart],
  );

  const viewKey = `${weekStart.toISOString()}|${repId}`;
  const loading = loadedKey !== viewKey;

  const load = useCallback(async () => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    const [a, n] = await Promise.all([
      getAppointments(weekStart.toISOString(), end.toISOString(), repId || null),
      getNeedsOutcome(repId || null),
    ]);
    setAppts(a);
    setNeedsOutcome(n);
    setLoadedKey(`${weekStart.toISOString()}|${repId}`);
  }, [weekStart, repId]);

  // Load now, then refresh every minute (new bookings from the dialer, the "now" line).
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const repColor = useMemo(() => {
    const map = new Map<string, string>();
    reps.forEach((r, i) => map.set(r.id, REP_COLORS[i % REP_COLORS.length]));
    return (id: string) => (isAdmin ? map.get(id) ?? REP_COLORS[0] : REP_COLORS[0]);
  }, [reps, isAdmin]);

  // Show 7am–9pm, stretched to fit anything earlier or later.
  const { startHour, endHour } = useMemo(() => {
    let s = 7;
    let e = 21;
    for (const a of appts) {
      const st = new Date(a.starts_at);
      const en = new Date(a.ends_at);
      s = Math.min(s, st.getHours());
      e = Math.max(e, en.getHours() + (en.getMinutes() ? 1 : 0));
    }
    return { startHour: s, endHour: Math.min(24, e) };
  }, [appts]);

  const weekLabel = `${days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const shift = (weeks: number) =>
    setWeekStart((w) => {
      const x = new Date(w);
      x.setDate(x.getDate() + weeks * 7);
      return x;
    });

  if (!mounted) return <Card className="py-16 text-center text-gray-500">Loading calendar…</Card>;

  return (
    <div className="space-y-4">
      {needsOutcome.length > 0 && (
        <Card className="p-4 ring-amber-300">
          <p className="font-medium text-amber-900">
            {needsOutcome.length} past appointment{needsOutcome.length === 1 ? "" : "s"} need{needsOutcome.length === 1 ? "s" : ""} an outcome
          </p>
          <ul className="mt-3 divide-y divide-gray-100">
            {needsOutcome.slice(0, 8).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-medium text-gray-900">{a.lead?.business_name}</span>
                  <span className="text-gray-500">
                    {" · "}
                    {new Date(a.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {isAdmin && a.rep_name ? ` · ${a.rep_name}` : ""}
                  </span>
                </span>
                <AppointmentActions appointment={a} onChanged={load} compact />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Button variant="secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</Button>
        <Button variant="ghost" onClick={() => shift(-1)} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="ghost" onClick={() => shift(1)} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-1 font-semibold text-gray-900">{weekLabel}</span>
        {loading && <span className="text-xs text-gray-400">Loading…</span>}
        <Button variant="secondary" className={isAdmin ? "" : "ml-auto"} onClick={() => setBooking(nextSlot())}>
          <Plus className="h-4 w-4" /> New appointment
        </Button>
        {isAdmin && (
          <div className="ml-auto w-48">
            <Select value={repId} onChange={(e) => setRepId(e.target.value)} aria-label="Rep">
              <option value="">Everyone</option>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </div>
        )}
      </Card>

      {isAdmin && !repId && reps.length > 1 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {reps.map((r) => (
            <span key={r.id} className={`rounded px-2 py-0.5 ring-1 ${repColor(r.id)}`}>{r.name}</span>
          ))}
        </div>
      )}

      {/* Week grid (tablet and up) */}
      <Card className="hidden overflow-x-auto p-0 md:block">
        <div className="grid min-w-[760px] grid-cols-[3.5rem_repeat(7,1fr)]">
          <div className="border-b border-gray-200" />
          {days.map((d) => (
            <div key={d.toISOString()} className={`border-b border-l border-gray-200 px-2 py-2 text-center text-sm ${sameDay(d, new Date(now)) ? "bg-brand-50 font-semibold text-brand-700" : "text-gray-700"}`}>
              {d.toLocaleDateString("en-US", { weekday: "short" })} <span className="text-gray-500">{d.getDate()}</span>
            </div>
          ))}

          <div className="relative" style={{ height: (endHour - startHour) * ROW }}>
            {Array.from({ length: endHour - startHour }, (_, i) => (
              <div key={i} className="absolute right-2 -translate-y-2 text-[11px] text-gray-400" style={{ top: i * ROW }}>
                {i === 0 ? "" : new Date(2026, 0, 1, startHour + i).toLocaleTimeString("en-US", { hour: "numeric" })}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const dayAppts = appts.filter((a) => sameDay(new Date(a.starts_at), d));
            const dayStart = new Date(d);
            dayStart.setHours(startHour, 0, 0, 0);
            const nowTop = ((now - dayStart.getTime()) / 3_600_000) * ROW;
            return (
              <div
                key={d.toISOString()}
                className="relative cursor-pointer border-l border-gray-200 hover:bg-gray-50/60"
                style={{ height: (endHour - startHour) * ROW }}
                title="Click to book a demo at this time"
                onClick={(e) => {
                  // Snap the click to the nearest 15 minutes.
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const mins = Math.max(0, Math.floor(((y / ROW) * 60) / 15) * 15);
                  setBooking(new Date(dayStart.getTime() + mins * 60_000));
                }}
              >
                {Array.from({ length: endHour - startHour }, (_, i) => (
                  <div key={i} className="absolute inset-x-0 border-t border-gray-100" style={{ top: i * ROW }} />
                ))}
                {sameDay(d, new Date(now)) && nowTop >= 0 && nowTop <= (endHour - startHour) * ROW && (
                  <div className="absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: nowTop }} />
                )}
                {layoutDay(dayAppts).map(({ appt, lane, lanes }) => {
                  const s = new Date(appt.starts_at);
                  const top = ((s.getTime() - dayStart.getTime()) / 3_600_000) * ROW;
                  const height = Math.max(22, ((Date.parse(appt.ends_at) - s.getTime()) / 3_600_000) * ROW - 2);
                  const faded = appt.status === "canceled" ? "opacity-50 line-through" : "";
                  const ring = appt.status === "missed" ? "!ring-2 !ring-red-500" : appt.status === "showed" ? "!ring-2 !ring-green-500" : "";
                  return (
                    <button
                      key={appt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(appt);
                      }}
                      className={`absolute z-20 overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight ring-1 transition hover:z-30 hover:shadow-md ${repColor(appt.rep_id)} ${ring} ${faded}`}
                      style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                      title={`${appt.lead?.business_name} · ${formatPhone(appt.lead?.phone_e164)}`}
                    >
                      <span className="block truncate font-semibold">{appt.lead?.business_name}</span>
                      <span className="block truncate opacity-80">{time(appt.starts_at)} · {formatPhone(appt.lead?.phone_e164)}</span>
                      {isAdmin && !repId && <span className="block truncate opacity-70">{appt.rep_name}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Agenda list (phones) */}
      <div className="space-y-3 md:hidden">
        {days.map((d) => {
          const dayAppts = appts.filter((a) => sameDay(new Date(a.starts_at), d));
          return (
            <Card key={d.toISOString()} className="p-4">
              <div className="flex items-center justify-between">
                <p className={`text-sm font-semibold ${sameDay(d, new Date(now)) ? "text-brand-700" : "text-gray-900"}`}>
                  {d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                </p>
                <button
                  onClick={() => {
                    const x = new Date(d);
                    x.setHours(10, 0, 0, 0);
                    setBooking(x);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              {dayAppts.length === 0 ? (
                <p className="mt-1 text-sm text-gray-400">Nothing scheduled</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {dayAppts.map((a) => (
                    <li key={a.id}>
                      <button onClick={() => setSelected(a)} className={`w-full rounded-lg px-3 py-2 text-left text-sm ring-1 ${repColor(a.rep_id)}`}>
                        <span className="font-semibold">{time(a.starts_at)}</span> {a.lead?.business_name}
                        <span className="block text-xs opacity-80">{formatPhone(a.lead?.phone_e164)} · {APPOINTMENT_LABELS[a.status]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {booking && (
        <NewAppointment
          start={booking}
          isAdmin={isAdmin}
          reps={reps}
          defaultRepId={repId || meId}
          onClose={() => setBooking(null)}
          onSaved={() => {
            setBooking(null);
            void load();
          }}
        />
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" onClick={() => setSelected(null)}>
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{selected.lead?.business_name}</h3>
                <p className="text-sm text-gray-600">
                  {[selected.lead?.contact_name ? `Owner: ${selected.lead.contact_name}` : null, [selected.lead?.city, selected.lead?.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <p className="mt-3 font-mono text-xl text-gray-900">{formatPhone(selected.lead?.phone_e164)}</p>
            <p className="mt-1 text-sm text-gray-600">
              {new Date(selected.starts_at).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {" – "}
              {time(selected.ends_at)}
              {isAdmin && selected.rep_name ? ` · ${selected.rep_name}` : ""}
            </p>
            <div className="mt-2"><Badge tone={selected.status === "missed" ? "red" : selected.status === "showed" ? "green" : selected.status === "canceled" ? "gray" : "blue"}>{APPOINTMENT_LABELS[selected.status]}</Badge></div>
            {selected.lead && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/leads/${selected.lead.id}`}><Button variant="secondary"><ExternalLink className="h-4 w-4" /> Open lead &amp; notes</Button></Link>
                <Link href={`/dialer?lead=${selected.lead.id}`}><Button className="bg-green-600 hover:bg-green-700"><Phone className="h-4 w-4" /> Call</Button></Link>
              </div>
            )}
            <div className="mt-4 border-t border-gray-100 pt-4">
              <AppointmentActions
                appointment={selected}
                onChanged={() => {
                  setSelected(null);
                  void load();
                }}
              />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
