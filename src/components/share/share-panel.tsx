"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Lock, LockOpen, Mail, MonitorUp, Pause, Play, Repeat, Square, UserX } from "lucide-react";
import { estimateDelay, health, viewerAlerts, type Health } from "@/lib/share/protocol";
import { useDialer } from "@/components/call/dialer-provider";
import { emailShareLink } from "./actions";
import { useShare, type Viewer } from "./share-provider";

const DOT: Record<Health, string> = { good: "bg-green-500", slow: "bg-amber-400", bad: "bg-red-500" };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Sidebar button: "Show my screen" (with the rep's link underneath). */
export function ShareButton({ link }: { link: string | null }) {
  const share = useShare();
  if (!link) return null;
  return (
    <div className="mt-4 px-1">
      {share.status === "idle" ? (
        <button
          onClick={() => void share.start()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1F6F5C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#185a4a]"
        >
          <MonitorUp className="h-4 w-4" /> Show my screen
        </button>
      ) : (
        <p className="flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> {share.status === "starting" ? "Starting…" : "Sharing your screen"}
        </p>
      )}
      <p className="mt-1 text-center text-xs text-gray-500">{link}</p>
      {share.error && (
        <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
          {share.error}{" "}
          <button onClick={share.clearError} className="underline">OK</button>
        </p>
      )}
    </div>
  );
}

function ViewerRow({ v, onRemove }: { v: Viewer; onRemove: () => void }) {
  const alerts = v.stats ? viewerAlerts(v.stats, v.device) : [];
  const h = v.stats ? health(v.stats) : null;
  const delay = v.stats ? estimateDelay(v.stats) : null;
  return (
    <li className="py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${v.connected && h ? DOT[h] : "bg-gray-300"}`} />
        <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
          {v.device.label}
          {v.place && <span className="font-normal text-gray-500"> · {v.place}</span>}
        </span>
        <button onClick={onRemove} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Remove this viewer" aria-label="Remove viewer">
          <UserX className="h-4 w-4" />
        </button>
      </div>
      <p className="ml-4.5 text-xs text-gray-500">
        {!v.connected
          ? "Connecting…"
          : [
              `watching ${mmss(v.watchedSeconds)}`,
              delay != null ? `delay ${delay.toFixed(1)}s` : null,
              v.stats?.frameW ? `${v.stats.frameW}×${v.stats.frameH} · ${Math.round(v.stats.fps)} fps` : null,
            ].filter(Boolean).join(" · ")}
      </p>
      {alerts.map((a) => (
        <p key={a} className="ml-4.5 mt-1 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">⚠ {a}</p>
      ))}
    </li>
  );
}

/** The rep's panel while sharing: what's going out, who's watching, and their problems. */
export function SharePanel() {
  const share = useShare();
  const d = useDialer();
  const [small, setSmall] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [email, setEmail] = useState("");
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (video.current) video.current.srcObject = share.preview;
  }, [share.preview, small]);

  if (share.status !== "live") return null;
  const lead = d.ctx?.lead;
  const watching = share.viewers.filter((v) => v.connected).length;

  if (small) {
    return (
      <button
        onClick={() => setSmall(false)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-lg md:left-64"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Sharing · {watching} watching
        {share.viewers.some((v) => v.stats && viewerAlerts(v.stats, v.device).length) && <span className="text-amber-300">⚠</span>}
        <ChevronUp className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-40 max-h-[85vh] w-[22rem] overflow-y-auto rounded-xl bg-white shadow-2xl ring-1 ring-gray-200 md:left-64">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        <span className="text-sm font-semibold text-gray-900">{share.paused ? "Paused" : "Sharing your screen"}</span>
        <button onClick={() => setSmall(true)} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Make smaller">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">{share.link}</span>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(`https://${share.link}`).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded p-1 text-gray-500 hover:bg-gray-200"
            title="Copy link"
            aria-label="Copy link"
          >
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            onClick={() => {
              setEmail(lead?.email ?? "");
              setEmailNote(null);
              setEmailing((e) => !e);
            }}
            className="rounded p-1 text-gray-500 hover:bg-gray-200"
            title="Email the link"
            aria-label="Email the link"
          >
            <Mail className="h-4 w-4" />
          </button>
        </div>
        {emailing && (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setEmailNote("Sending…");
              const res = await emailShareLink({ email, name: lead?.contact_name ?? null });
              setEmailNote(res.error ?? "Sent ✓");
              if (!res.error) setTimeout(() => setEmailing(false), 1500);
            }}
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="their@email.com"
              className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-sm ring-1 ring-gray-300 focus:ring-2 focus:ring-brand-500 focus:outline-none"
            />
            <button className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">Send</button>
          </form>
        )}
        {emailNote && emailing && <p className="text-xs text-gray-600">{emailNote}</p>}

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">What they see</p>
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={video} autoPlay muted playsInline className="aspect-video w-full object-contain" />
            {share.paused && <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm font-semibold text-white">Paused</div>}
          </div>
          <p className="mt-1 text-xs text-gray-500">If you see the CRM here, you picked the wrong screen. Click <b>Switch screen</b>.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <button onClick={share.togglePause} className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium ring-1 ring-gray-300 hover:bg-gray-50">
            {share.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} {share.paused ? "Resume" : "Pause"}
          </button>
          <button onClick={() => void share.switchScreen()} className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium ring-1 ring-gray-300 hover:bg-gray-50">
            <Repeat className="h-4 w-4" /> Switch screen
          </button>
          <button
            onClick={share.toggleLock}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium ring-1 ${share.locked ? "bg-amber-50 text-amber-900 ring-amber-300" : "ring-gray-300 hover:bg-gray-50"}`}
            title={share.locked ? "New people can't join. Click to let people in again." : "Stop new people from joining"}
          >
            {share.locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />} {share.locked ? "Locked" : "Lock"}
          </button>
          <button onClick={() => void share.stop()} className="flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 font-semibold text-white hover:bg-red-700">
            <Square className="h-4 w-4" /> Stop
          </button>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Watching ({watching})
          </p>
          {share.viewers.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">
              Nobody yet. Tell them: <b>&quot;Go to {share.link}&quot;</b>
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {share.viewers.map((v) => (
                <ViewerRow key={v.id} v={v} onRemove={() => share.remove(v.id)} />
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-gray-400">Tip: turn on Do Not Disturb so pop-ups don&apos;t show on the shared screen.</p>
      </div>
    </div>
  );
}
