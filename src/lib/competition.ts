// Weekly competition scoring (see docs/PLAN.md, "Weekly competition").
import { addDays, zonedDay, zonedMidnight } from "./stats";

export const POINTS = {
  contact: 1,
  talkSecondsPerPoint: 120, // 1 point per 2 minutes of talk
  talkMaxPerCall: 10,
  appointment: 10,
  demo: 15,
  sale: 50,
} as const;

/** Outcomes that count as a real conversation (same as "Contacts" on the dashboard). */
export const CONTACT_OUTCOMES = new Set(["not_interested", "appointment_set", "demo_completed", "sold", "do_not_call"]);

/** Points for one call: a contact point plus talk time, only for real conversations. */
export function callPoints(disposition: string | null, durationSeconds: number | null): { contact: number; talk: number } {
  if (!disposition || !CONTACT_OUTCOMES.has(disposition)) return { contact: 0, talk: 0 };
  const talk = Math.min(POINTS.talkMaxPerCall, Math.floor((durationSeconds ?? 0) / POINTS.talkSecondsPerPoint));
  return { contact: POINTS.contact, talk };
}

export type Tally = { contacts: number; talkPoints: number; talkSeconds: number; appointments: number; demos: number; sales: number };

export const emptyTally = (): Tally => ({ contacts: 0, talkPoints: 0, talkSeconds: 0, appointments: 0, demos: 0, sales: 0 });

export function totalPoints(t: Tally): number {
  return t.contacts * POINTS.contact + t.talkPoints + t.appointments * POINTS.appointment + t.demos * POINTS.demo + t.sales * POINTS.sale;
}

/** The competition week: Monday 12:00am Eastern until the next Monday (weekends count). */
export function competitionWeek(now = new Date()): { from: Date; to: Date; label: string } {
  const today = zonedDay(now);
  const [y, m, d] = today.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -dow);
  const fmt = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return { from: zonedMidnight(monday), to: zonedMidnight(addDays(monday, 7)), label: `${fmt(monday)} – ${fmt(addDays(monday, 6))}` };
}

/** Ranks by points; ties share a place (1, 2, 2, 4). */
export function rank<T extends { points: number }>(rows: T[]): (T & { place: number })[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  let place = 0;
  return sorted.map((r, i) => {
    if (i === 0 || sorted[i - 1].points !== r.points) place = i + 1;
    return { ...r, place };
  });
}
