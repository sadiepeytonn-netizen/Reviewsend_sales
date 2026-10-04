"use client";

import { useCallback, useEffect, useState } from "react";
import { Ear, Megaphone, MessageCircle } from "lucide-react";
import type { MonitorMode } from "@/lib/twilio";
import { mmss, useClock, useDialer } from "@/components/call/dialer-provider";
import Link from "next/link";
import { formatPhone } from "@/lib/phone";
import { getLive, type LiveData, type LiveRep } from "./actions";

type LiveCall = NonNullable<LiveRep["call"]>;

/** "Maria Lopez · Lopez Plumbing" (empty for a keypad call that isn't a lead yet). */
export const callWith = (c: { owner: string | null; business: string | null }) => [c.owner, c.business].filter(Boolean).join(" · ");

/** The prospect's number; admins can click it to open the lead. */
export function ProspectPhone({ phone, href, className }: { phone: string; href: string | null; className?: string }) {
  if (!href) return <span className={className}>{formatPhone(phone)}</span>;
  return (
    <Link href={href} className={`${className ?? ""} underline-offset-2 hover:underline`} title="Open this lead">
      {formatPhone(phone)}
    </Link>
  );
}

const leadHref = (c: LiveCall, isAdmin: boolean) => (isAdmin && c.leadId ? `/admin/leads/${c.leadId}` : null);

export const MODE_LABELS: Record<MonitorMode, { label: string; help: string; icon: typeof Ear }> = {
  listen: { label: "Listen", help: "Nobody can hear you", icon: Ear },
  whisper: { label: "Whisper", help: "Only the rep hears you", icon: MessageCircle },
  barge: { label: "Barge", help: "Everyone hears you", icon: Megaphone },
};

const DOT: Record<LiveRep["status"], string> = {
  on_call: "bg-green-500",
  wrap_up: "bg-amber-400",
  ready: "bg-blue-500",
  paused: "bg-amber-500",
  idle: "bg-gray-300",
  offline: "bg-gray-200",
};

const STATUS: Record<LiveRep["status"], string> = {
  on_call: "On a call",
  wrap_up: "Wrapping up",
  ready: "Ready",
  paused: "Paused",
  idle: "Not dialing",
  offline: "Offline",
};

/** Sidebar list of reps; click one who's on a call to listen, whisper, or barge. */
export function LiveSection() {
  const d = useDialer();
  const [data, setData] = useState<LiveData | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const now = useClock(true);

  const load = useCallback(async () => {
    try {
      setData(await getLive());
    } catch {
      /* offline for a moment: keep the last list */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  if (!data || !data.modes.length) return null;

  return (
    <div className="mt-6">
      <p className="mb-2 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Live
      </p>
      {!data.conference && (
        <p className="px-3 pb-2 text-xs text-amber-700">Listening in is off (calls are in direct mode).</p>
      )}
      <ul className="space-y-0.5">
        {data.reps.map((r) => {
          const canOpen = Boolean(r.call) && data.conference;
          const listening = Boolean(r.call && d.monitor?.callId === r.call.id);
          return (
            <li key={r.rep_id} className={`rounded-lg ${canOpen ? "hover:bg-gray-100" : ""} ${listening ? "bg-violet-50" : ""}`}>
              <button
                onClick={() => canOpen && setOpen((o) => (o === r.rep_id ? null : r.rep_id))}
                className={`flex w-full items-start gap-2 px-3 pt-1.5 text-left text-sm ${r.call ? "" : "pb-1.5"} ${canOpen ? "" : "cursor-default"}`}
                title={canOpen ? "Click to listen in" : STATUS[r.status]}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[r.status]}`} />
                <span className="min-w-0">
                  <span className={`block truncate font-medium ${r.status === "offline" ? "text-gray-400" : "text-gray-800"}`}>{r.name}</span>
                  <span className="block truncate text-xs text-gray-500">
                    {r.call
                      ? r.call.answered ? "Talking" : "Ringing"
                      : STATUS[r.status]}
                    {r.status !== "offline" && r.since ? ` · ${mmss(now - Date.parse(r.since))}` : ""}
                  </span>
                  {r.call?.owner && <span className="mt-0.5 block truncate text-xs font-medium text-gray-800">{r.call.owner}</span>}
                  {r.call?.business && <span className="block truncate text-xs text-gray-600" title={r.call.business}>{r.call.business}</span>}
                </span>
              </button>
              {r.call && (
                <div className="pb-1.5 pl-7 pr-3">
                  <ProspectPhone phone={r.call.phone} href={leadHref(r.call, data.isAdmin)} className="text-xs text-gray-600" />
                </div>
              )}
              {open === r.rep_id && r.call && (
                <div className="flex flex-wrap gap-1 pb-2 pl-7 pr-3">
                  {data.modes.map((m) => {
                    const { label, icon: Icon, help } = MODE_LABELS[m];
                    return (
                      <button
                        key={m}
                        title={help}
                        onClick={() => {
                          if (listening && d.monitor) void d.switchMonitorMode(m);
                          else
                            void d.listenIn(r.call!.id, r.name, m, {
                              withWho: callWith(r.call!),
                              phone: r.call!.phone,
                              leadHref: leadHref(r.call!, data.isAdmin),
                            });
                        }}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ${
                          listening && d.monitor?.mode === m
                            ? "bg-violet-600 text-white ring-violet-600"
                            : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </button>
                    );
                  })}
                  {listening && (
                    <button onClick={d.leaveMonitor} className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">
                      Leave
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {data.reps.length === 0 && <li className="px-3 text-xs text-gray-400">Nobody&apos;s working right now.</li>}
      </ul>
    </div>
  );
}
