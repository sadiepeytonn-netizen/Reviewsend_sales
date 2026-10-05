"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Trophy, X } from "lucide-react";
import { POINTS, totalPoints, type Tally } from "@/lib/competition";
import { duration } from "@/lib/stats";
import { getCompetition, type Celebration, type CompetitionData } from "./competition-actions";

const REFRESH_MS = 15_000;

/** Loads the weekly board every 15s and collects new appointments / sales to celebrate. */
export function useCompetition() {
  const [data, setData] = useState<CompetitionData | null>(null);
  const [toasts, setToasts] = useState<Celebration[]>([]);
  const cursor = useRef<string | null>(null);
  const seen = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const d = await getCompetition(cursor.current);
      cursor.current = d.cursor;
      setData(d);
      const fresh = d.celebrations.filter((c) => !seen.current.has(c.id));
      fresh.forEach((c) => seen.current.add(c.id));
      if (fresh.length) {
        setToasts((t) => [...t, ...fresh]);
        setTimeout(() => setToasts((t) => t.filter((x) => !fresh.includes(x))), 6000);
      }
    } catch {
      /* offline for a moment: keep the last board */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const dismiss = (id: string) => setToasts((all) => all.filter((x) => x.id !== id));
  return { data, toasts, dismiss };
}

function summaryLine(data: CompetitionData): string {
  const mine = data.board.find((r) => r.isMe);
  if (!mine) {
    const leader = data.board[0];
    return leader.points > 0 ? `Leader: ${leader.name} · ${leader.points} pts` : "No points yet this week";
  }
  const above = data.board.filter((r) => r.points > mine.points);
  const next = above[above.length - 1];
  const tied = data.board.filter((r) => r.points === mine.points).length > 1;
  let s = `#${mine.place} of ${data.board.length}${tied ? " (tied)" : ""} · ${mine.points} pts`;
  if (next) s += ` · ${next.points - mine.points} behind ${next.name}`;
  else if (data.board[1] && !tied) s += ` · leading by ${mine.points - data.board[1].points}`;
  return s;
}

/** Full board in a card (next to the keypad when not on a lead). */
export function CompetitionPanel({ data }: { data: CompetitionData | null }) {
  if (!data || data.board.length === 0) return null;
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-500" />
        <h2 className="font-semibold text-gray-900">This week</h2>
        <span className="ml-auto text-xs text-gray-500">{data.week}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600">{summaryLine(data)}</p>
      <Board data={data} />
    </div>
  );
}

/** Slim bar above the dialer while working a lead; opens the board. */
export function CompetitionStrip({ data }: { data: CompetitionData | null }) {
  const [open, setOpen] = useState(false);
  if (!data || data.board.length === 0) return null;
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm" aria-expanded={open}>
        <Trophy className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="font-semibold text-gray-900">This week</span>
        <span className="min-w-0 truncate text-gray-600">{summaryLine(data)}</span>
        <span className="ml-auto shrink-0 text-gray-400">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 pb-4">
          <Board data={data} />
        </div>
      )}
    </div>
  );
}

function Board({ data }: { data: CompetitionData }) {
  return (
    <>
      <ol className="mt-3 divide-y divide-gray-100">
        {data.board.map((r) => (
          <li key={r.rep_id} className={`py-2 ${r.isMe ? "-mx-2 rounded-lg bg-brand-50 px-2" : ""}`}>
            <div className="flex items-center gap-3 text-sm">
              <span className={`w-6 text-center font-semibold ${r.place === 1 && r.points > 0 ? "text-amber-500" : "text-gray-400"}`}>
                {r.place === 1 && r.points > 0 ? "🏆" : r.place}
              </span>
              <span className="font-medium text-gray-900">{r.isMe ? `${r.name} (you)` : r.name}</span>
              <span className="ml-auto font-semibold tabular-nums text-gray-900">{r.points} pts</span>
            </div>
            {r.tally && <Breakdown t={r.tally} />}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-gray-400">
        Resets Monday 12am Eastern · contact {POINTS.contact} · talk 1 per 2 min (max {POINTS.talkMaxPerCall} a call) · appointment{" "}
        {POINTS.appointment} · demo {POINTS.demo} · sale {POINTS.sale}
      </p>
    </>
  );
}

function Breakdown({ t }: { t: Tally }) {
  const parts = [
    `${t.contacts} contacts`,
    `${duration(t.talkSeconds)} talk (${t.talkPoints} pts)`,
    `${t.appointments} appts`,
    `${t.demos} demos`,
    `${t.sales} sales`,
  ];
  return (
    <p className="ml-9 mt-0.5 text-xs text-gray-500" title={`${totalPoints(t)} points`}>
      {parts.join(" · ")}
    </p>
  );
}

/** "🎉 Ryan just set an appointment!" in the corner. */
export function CelebrationToasts({ toasts, onDismiss }: { toasts: Celebration[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div key={t.id} className="flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-lg">
          <span>🎉 {t.text}</span>
          <button onClick={() => onDismiss(t.id)} className="text-white/60 hover:text-white" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
