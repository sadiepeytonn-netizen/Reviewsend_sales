"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Trophy, X } from "lucide-react";
import { POINTS, totalPoints, type Tally } from "@/lib/competition";
import { duration } from "@/lib/stats";
import { getCompetition, type Celebration, type CompetitionData } from "./competition-actions";

const REFRESH_MS = 15_000;

/** Weekly competition: a slim strip on the dialer that opens the full board, plus floor pop-ups. */
export function Competition() {
  const [data, setData] = useState<CompetitionData | null>(null);
  const [open, setOpen] = useState(false);
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

  if (!data || data.board.length === 0) return null;
  const mine = data.board.find((r) => r.isMe);
  const leader = data.board[0];

  let summary: string;
  if (mine) {
    const above = data.board.filter((r) => r.points > mine.points);
    const next = above[above.length - 1];
    const tied = data.board.filter((r) => r.points === mine.points).length > 1;
    summary = `#${mine.place} of ${data.board.length}${tied ? " (tied)" : ""} · ${mine.points} pts`;
    if (next) summary += ` · ${next.points - mine.points} behind ${next.name}`;
    else if (data.board[1] && !tied) summary += ` · leading by ${mine.points - data.board[1].points}`;
  } else {
    summary = leader.points > 0 ? `Leader: ${leader.name} · ${leader.points} pts` : "No points yet this week";
  }

  return (
    <>
      <div className="mb-4 rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
        <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm" aria-expanded={open}>
          <Trophy className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="font-semibold text-gray-900">This week</span>
          <span className="min-w-0 truncate text-gray-600">{summary}</span>
          <span className="ml-auto shrink-0 text-gray-400">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
        </button>
        {open && (
          <div className="border-t border-gray-100 px-4 pb-4 pt-3">
            <p className="mb-2 text-xs text-gray-500">{data.week} · resets Monday 12am Eastern</p>
            <ol className="divide-y divide-gray-100">
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
              Contact {POINTS.contact} · talk time 1 per 2 min (max {POINTS.talkMaxPerCall} a call) · appointment {POINTS.appointment} ·
              demo {POINTS.demo} · sale {POINTS.sale}
            </p>
          </div>
        )}
      </div>

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 space-y-2">
          {toasts.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-lg">
              <span>🎉 {t.text}</span>
              <button onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="text-white/60 hover:text-white" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
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
