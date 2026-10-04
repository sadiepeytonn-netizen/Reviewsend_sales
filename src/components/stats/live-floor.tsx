"use client";

import { useEffect, useState } from "react";
import { Coffee, Phone, PhoneOff, Timer, Wifi, WifiOff } from "lucide-react";
import { getFloor, type FloorRow } from "@/app/(app)/admin/actions";

const STATUS: Record<FloorRow["status"], { label: string; dot: string; Icon: typeof Phone }> = {
  on_call: { label: "On a call", dot: "bg-green-500", Icon: Phone },
  wrap_up: { label: "Wrapping up", dot: "bg-blue-500", Icon: Timer },
  ready: { label: "Between calls", dot: "bg-blue-400", Icon: PhoneOff },
  paused: { label: "Paused", dot: "bg-amber-500", Icon: Coffee },
  idle: { label: "Online, not dialing", dot: "bg-gray-400", Icon: Wifi },
  offline: { label: "Offline", dot: "bg-gray-300", Icon: WifiOff },
};

function since(iso: string | null, now: number) {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

/** Live floor: refreshes every 10 seconds. */
export function LiveFloor({ initial }: { initial: FloorRow[] }) {
  const [rows, setRows] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(async () => {
      setRows(await getFloor());
      setNow(Date.now());
    }, 10_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(tick);
    };
  }, []);

  if (rows.length === 0) return <p className="text-sm text-gray-500">No active reps yet.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((r) => {
        const s = STATUS[r.status];
        return (
          <li key={r.rep_id} className="rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-900">{r.name}</span>
              <span className="text-xs text-gray-500">{r.dials_today} dials today</span>
            </div>
            <p className="mt-1 flex items-center gap-2 text-sm text-gray-700">
              <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden />
              <s.Icon className="h-3.5 w-3.5 text-gray-500" aria-hidden />
              {s.label}
              {r.status === "paused" && r.pause_reason ? ` (${r.pause_reason})` : ""}
              {r.status !== "offline" && <span className="text-gray-500" suppressHydrationWarning>· {since(r.since, now)}</span>}
            </p>
            {r.lead && <p className="mt-1 truncate text-xs text-gray-500">{r.list ? `${r.list} · ` : ""}{r.lead}</p>}
          </li>
        );
      })}
    </ul>
  );
}
