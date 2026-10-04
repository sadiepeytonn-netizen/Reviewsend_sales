"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic, MicOff, PhoneCall, PhoneOff } from "lucide-react";
import { mmss, PAUSE_LABELS, useClock, useDialer } from "./dialer-provider";

/** Shown on every page except the dialer while a call or dialing session is going. */
export function CallBar() {
  const d = useDialer();
  const pathname = usePathname();
  const now = useClock(d.callState === "open");
  if (pathname.startsWith("/dialer") || d.phase === "idle") return null;

  const name = d.ctx?.lead.business_name;
  if (d.phase === "calling") {
    return (
      <div className="sticky top-0 z-40 -mx-4 mb-4 flex flex-wrap items-center gap-3 bg-green-600 px-4 py-2 text-sm text-white shadow md:-mx-10 md:px-10">
        <PhoneCall className="h-4 w-4" />
        <span className="font-semibold">{name}</span>
        <span className="font-mono">{d.callState === "open" && d.answeredAt ? mmss(now - d.answeredAt) : d.callState === "ringing" ? "Ringing…" : "Connecting…"}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={d.toggleMute} disabled={d.callState !== "open"} className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2.5 py-1 hover:bg-white/25 disabled:opacity-50">
            {d.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {d.muted ? "Unmute" : "Mute"}
          </button>
          <button onClick={d.hangUp} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 font-medium ring-1 ring-white/40 hover:bg-red-700">
            <PhoneOff className="h-4 w-4" /> Hang up
          </button>
          <Link href="/dialer" className="rounded-md bg-white px-2.5 py-1 font-medium text-green-800">Back to dialer</Link>
        </div>
      </div>
    );
  }
  if (d.phase === "wrapup") {
    return (
      <div className="sticky top-0 z-40 -mx-4 mb-4 flex flex-wrap items-center gap-3 bg-amber-500 px-4 py-2 text-sm text-white shadow md:-mx-10 md:px-10">
        <span>Call with <b>{name}</b> ended. Pick an outcome.</span>
        <Link href="/dialer" className="ml-auto rounded-md bg-white px-2.5 py-1 font-medium text-amber-800">Go to dialer</Link>
      </div>
    );
  }
  return (
    <div className="sticky top-0 z-40 -mx-4 mb-4 flex flex-wrap items-center gap-3 bg-brand-600 px-4 py-2 text-sm text-white shadow md:-mx-10 md:px-10">
      <span>
        Dialing session on {d.list}
        {d.phase === "paused" ? ` · Paused (${PAUSE_LABELS[d.pauseReason]})` : name ? ` · next up: ${name}` : ""}
      </span>
      <Link href="/dialer" className="ml-auto rounded-md bg-white px-2.5 py-1 font-medium text-brand-700">Back to dialer</Link>
    </div>
  );
}
