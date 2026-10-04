"use client";

import { useState } from "react";

export type DailyRow = { day: string; dials: number; contacts: number; appointments: number; demos: number; sales: number };
const METRICS = [
  { key: "dials", label: "Dials" },
  { key: "contacts", label: "Contacts" },
  { key: "appointments", label: "Appointments" },
  { key: "demos", label: "Demos" },
  { key: "sales", label: "Sales" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

function niceMax(v: number) {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const dayLabel = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

/** Day-by-day columns for one measure at a time (one axis, one hue), with hover details. */
export function TrendChart({ rows }: { rows: DailyRow[] }) {
  const [metric, setMetric] = useState<MetricKey>("dials");
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const values = rows.map((r) => Number(r[metric]));
  const max = niceMax(Math.max(0, ...values));
  const W = 720, H = 220, L = 36, B = 24, T = 8;
  const plotW = W - L - 8, plotH = H - B - T;
  const slot = plotW / Math.max(1, rows.length);
  const barW = Math.min(24, slot * 0.6);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(rows.length / 10);
  const label = METRICS.find((m) => m.key === metric)!.label;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-gray-100 p-1">
          {METRICS.map((m) => (
            <button key={m.key} onClick={() => setMetric(m.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${metric === m.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
              {m.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowTable((v) => !v)} className="ml-auto text-xs text-gray-500 hover:underline">
          {showTable ? "Show chart" : "Show as table"}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-gray-500"><tr><th className="py-1 text-left font-medium">Day</th>{METRICS.map((m) => <th key={m.key} className="py-1 text-right font-medium">{m.label}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.day}><td className="py-1">{dayLabel(r.day)}</td>{METRICS.map((m) => <td key={m.key} className="py-1 text-right">{Number(r[m.key])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mx-auto max-w-[860px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label} per day`}>
            {ticks.map((t) => {
              const y = T + plotH - (t / max) * plotH;
              return (
                <g key={t}>
                  <line x1={L} x2={W - 8} y1={y} y2={y} stroke="#e7e6e2" strokeWidth={1} />
                  <text x={L - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#6b6a66">{Math.round(t).toLocaleString()}</text>
                </g>
              );
            })}
            {rows.map((r, i) => {
              const v = Number(r[metric]);
              const h = (v / max) * plotH;
              const x = L + i * slot + (slot - barW) / 2;
              const y = T + plotH - h;
              return (
                <g key={r.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={L + i * slot} y={T} width={slot} height={plotH} fill={hover === i ? "#f3f2ef" : "transparent"} />
                  {v > 0 && (
                    <path
                      d={`M${x},${T + plotH} V${y + Math.min(4, h)} Q${x},${y} ${x + Math.min(4, barW / 2)},${y} H${x + barW - Math.min(4, barW / 2)} Q${x + barW},${y} ${x + barW},${y + Math.min(4, h)} V${T + plotH} Z`}
                      fill="#2a78d6"
                    />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={L + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#6b6a66">{dayLabel(r.day)}</text>
                  )}
                </g>
              );
            })}
            <line x1={L} x2={W - 8} y1={T + plotH} y2={T + plotH} stroke="#d4d3cf" strokeWidth={1} />
          </svg>
          {hover != null && rows[hover] && (
            <div
              className="pointer-events-none absolute top-0 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg"
              style={{ left: `${((L + hover * slot + slot / 2) / W) * 100}%`, transform: "translateX(-50%)" }}
            >
              <p className="font-medium">{dayLabel(rows[hover].day)}</p>
              {METRICS.map((m) => (
                <p key={m.key} className={m.key === metric ? "font-semibold" : "opacity-80"}>
                  {m.label}: {Number(rows[hover][m.key])}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
