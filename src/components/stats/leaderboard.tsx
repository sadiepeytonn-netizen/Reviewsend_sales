"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { duration, money, pct, type RepStats } from "@/lib/stats";

type Col = {
  key: string;
  label: string;
  value: (r: RepStats) => number | null; // used for sorting
  show: (r: RepStats) => string;
  adminOnly?: boolean;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

const COLS: Col[] = [
  { key: "dials", label: "Dials", value: (r) => r.dials, show: (r) => r.dials.toLocaleString() },
  { key: "manual_dials", label: "Manual dials", value: (r) => r.manual_dials, show: (r) => r.manual_dials.toLocaleString() },
  { key: "contacts", label: "Contacts", value: (r) => r.contacts, show: (r) => r.contacts.toLocaleString() },
  { key: "contact_rate", label: "Contact %", value: (r) => ratio(r.contacts, r.dials), show: (r) => pct(r.contacts, r.dials) },
  { key: "talk", label: "Talk time", value: (r) => r.talk_seconds, show: (r) => duration(r.talk_seconds) },
  { key: "avg_talk", label: "Avg talk", value: (r) => ratio(r.talk_seconds, r.answered_calls), show: (r) => (r.answered_calls ? duration(r.talk_seconds / r.answered_calls) : "—") },
  { key: "logged_in", label: "Logged in", value: (r) => r.logged_in_seconds, show: (r) => duration(r.logged_in_seconds) },
  { key: "not_calling", label: "Not calling", value: (r) => r.logged_in_seconds - r.on_call_seconds, show: (r) => duration(Math.max(0, r.logged_in_seconds - r.on_call_seconds)) },
  { key: "paused", label: "Paused", value: (r) => r.paused_seconds, show: (r) => duration(r.paused_seconds) },
  { key: "gap", label: "Avg between calls", value: (r) => r.avg_gap_seconds, show: (r) => duration(r.avg_gap_seconds) },
  { key: "appointments", label: "Appts", value: (r) => r.appointments, show: (r) => String(r.appointments) },
  { key: "appt_rate", label: "Appt %", value: (r) => ratio(r.appointments, r.contacts), show: (r) => pct(r.appointments, r.contacts) },
  { key: "demos", label: "Demos", value: (r) => r.demos, show: (r) => String(r.demos) },
  { key: "show_rate", label: "Show %", value: (r) => ratio(r.showed, r.showed + r.missed), show: (r) => pct(r.showed, r.showed + r.missed) },
  { key: "pns", label: "Pitched, no sale", value: (r) => r.pitched_no_sale, show: (r) => String(r.pitched_no_sale) },
  { key: "sales", label: "Sales", value: (r) => r.sales, show: (r) => String(r.sales) },
  { key: "close_rate", label: "Close %", value: (r) => ratio(r.sales, r.sales + r.pitched_no_sale), show: (r) => pct(r.sales, r.sales + r.pitched_no_sale) },
  { key: "mrr", label: "MRR sold", value: (r) => r.mrr, show: (r) => money(r.mrr) },
  { key: "commission", label: "Commission", value: (r) => r.first_month_commission, show: (r) => money(r.first_month_commission) },
  { key: "residual", label: "Residuals", value: (r) => r.residual_commission, show: (r) => money(r.residual_commission), adminOnly: true },
];

/** Every rep's numbers. Click any column header to sort by it. */
export function Leaderboard({ rows, team, isAdmin, query }: { rows: RepStats[]; team: RepStats; isAdmin: boolean; query: string }) {
  const [sortKey, setSortKey] = useState("dials");
  const [desc, setDesc] = useState(true);
  const cols = COLS.filter((c) => !c.adminOnly || isAdmin);

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sortKey) ?? COLS[0];
    return [...rows].sort((a, b) => {
      const va = col.value(a) ?? -Infinity;
      const vb = col.value(b) ?? -Infinity;
      return desc ? vb - va : va - vb;
    });
  }, [rows, sortKey, desc]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm tabular-nums">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left font-medium">#</th>
            <th className="sticky left-8 bg-gray-50 px-3 py-2 text-left font-medium">Rep</th>
            {cols.map((c) => (
              <th key={c.key} className="px-3 py-2 text-right font-medium">
                <button
                  className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-gray-900 ${sortKey === c.key ? "text-gray-900" : ""}`}
                  onClick={() => (sortKey === c.key ? setDesc((d) => !d) : (setSortKey(c.key), setDesc(true)))}
                >
                  {c.label}
                  {sortKey === c.key && (desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((r, i) => (
            <tr key={r.rep_id} className="hover:bg-gray-50">
              <td className="sticky left-0 bg-white px-3 py-2 text-gray-400">{i + 1}</td>
              <td className="sticky left-8 bg-white px-3 py-2 font-medium whitespace-nowrap">
                <Link href={`/admin/stats/${r.rep_id}${query}`} className="text-gray-900 hover:underline">{r.rep_name}</Link>
              </td>
              {cols.map((c) => <td key={c.key} className="px-3 py-2 text-right whitespace-nowrap text-gray-700">{c.show(r)}</td>)}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-gray-200 font-semibold">
          <tr>
            <td className="sticky left-0 bg-white px-3 py-2" />
            <td className="sticky left-8 bg-white px-3 py-2">Team</td>
            {cols.map((c) => <td key={c.key} className="px-3 py-2 text-right whitespace-nowrap">{c.show(team)}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
