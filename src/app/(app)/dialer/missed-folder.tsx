"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Phone, Trash2 } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { formatTime } from "@/lib/time";
import { getMissedFolder, removeFromMissed, type MissedRow } from "./actions";
import { EditLeadButton } from "./edit-lead";

/** Same calendar day in the lead's time zone (Eastern if unknown) — the folder dials each lead once a day. */
function calledToday(r: MissedRow) {
  if (!r.last_called_at) return false;
  const tz = r.timezone || "America/New_York";
  const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: tz });
  return day(new Date(r.last_called_at)) === day(new Date());
}

/** The rep's Demo Missed folder: everyone in it, with Call now / Edit / Remove. */
export function MissedFolder() {
  const [rows, setRows] = useState<MissedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    const res = await getMissedFolder();
    setRows(res.rows);
    setError(res.error ?? null);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const left = rows?.filter((r) => !calledToday(r)).length ?? 0;

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-5 py-3 text-left" aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
        <span className="font-semibold text-gray-900">Demo missed folder</span>
        {rows && (
          <span className="text-sm text-gray-500">
            · {rows.length} {rows.length === 1 ? "person" : "people"} · {left} still to call today
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-gray-100">
          {error && <div className="p-4"><Alert tone="amber">{error}</Alert></div>}
          {rows && rows.length === 0 && !error && (
            <p className="px-5 py-6 text-sm text-gray-500">
              Nobody here. When you mark an appointment <b>Demo missed</b> on the calendar, they land in this folder.
            </p>
          )}
          {rows && rows.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900">{r.contact_name || "Owner unknown"}</p>
                    <p className="text-sm text-gray-700">{r.business_name} · <span className="font-mono">{formatPhone(r.phone_e164)}</span></p>
                    <p className="text-xs text-gray-500">
                      Missed {formatTime(r.missed_since)}
                      {r.last_called_at ? ` · last called ${formatTime(r.last_called_at)}` : " · not called yet"}
                    </p>
                  </div>
                  {calledToday(r) ? <Badge tone="green">Called today</Badge> : <Badge tone="amber">To call today</Badge>}
                  <Link href={`/dialer?lead=${r.id}&from=missed`}>
                    <Button className="bg-green-600 hover:bg-green-700"><Phone className="h-4 w-4" /> Call now</Button>
                  </Link>
                  <EditLeadButton lead={r} onSaved={() => void load()} />
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${r.contact_name || r.business_name} from the Demo missed folder? They stay your client; they just won't be called from this list.`)) return;
                      const res = await removeFromMissed(r.id);
                      if (res.error) setError(res.error);
                      void load();
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
