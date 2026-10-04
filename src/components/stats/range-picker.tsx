"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@/components/ui";

const OPTIONS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
];

/** Today / This week / This month / Custom: one row above the stats. */
export function RangePicker({ current, fromDay, toDay }: { current: string; fromDay: string; toDay: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [custom, setCustom] = useState(current === "custom");
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);

  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const k of ["range", "from", "to"]) p.delete(k);
    for (const [k, v] of Object.entries(next)) p.set(k, v);
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-gray-100 p-1">
        {OPTIONS.map((o) => {
          const active = o.key === "custom" ? custom : !custom && current === o.key;
          return (
            <button
              key={o.key}
              onClick={() => {
                if (o.key === "custom") setCustom(true);
                else {
                  setCustom(false);
                  go({ range: o.key });
                }
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {custom && (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="From" />
          <span className="text-sm text-gray-500">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="To" />
          <Button variant="secondary" disabled={!from || !to || from > to} onClick={() => go({ range: "custom", from, to })}>Apply</Button>
        </div>
      )}
    </div>
  );
}
