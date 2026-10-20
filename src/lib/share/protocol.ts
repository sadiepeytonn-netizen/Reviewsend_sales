/**
 * Screen share messages. The rep's browser and each viewer's browser find each other on a
 * Supabase live channel ("share:<rep id>"), then the video goes browser to browser (WebRTC).
 * Viewer stats travel back to the rep over a data channel on that connection.
 */

export const channelName = (repId: string) => `share:${repId}`;
export const SIGNAL = "signal";

export type ViewerDevice = { kind: "phone" | "tablet" | "computer"; label: string };

export type Signal =
  /** Viewer → rep: I'm here (sent on arrival, every few seconds while waiting, and on "start"). */
  | { t: "hello"; from: string; device: ViewerDevice; place: string | null; pass?: string }
  /** Rep → all: I started (viewers who are waiting say hello again). */
  | { t: "start" }
  /** Rep → all: the share ended. */
  | { t: "stop" }
  | { t: "offer"; to: string; sdp: string }
  | { t: "answer"; from: string; sdp: string }
  | { t: "ice"; to?: string; from?: string; candidate: RTCIceCandidateInit }
  /** Rep → one viewer: you were removed, or the room is locked. */
  | { t: "removed"; to: string }
  | { t: "locked"; to: string };

/** Viewer → rep over the data channel, every 2 seconds. */
export type ViewerStats = {
  /** What the viewer's window / screen looks like. */
  vw: number; vh: number; sw: number; sh: number;
  portrait: boolean; fullscreen: boolean; visible: boolean;
  /** What actually arrives. */
  fps: number; frameW: number; frameH: number;
  /** Seconds. */
  rtt: number | null; buffer: number | null;
  lossPct: number;
};

/** Rep → viewer over the data channel. */
export type RepNotice = { paused: boolean };

export type Health = "good" | "slow" | "bad";

/** Delay the viewer experiences (seconds), roughly: network one way + playback buffer + encoding. */
export function estimateDelay(s: ViewerStats): number | null {
  if (s.rtt == null && s.buffer == null) return null;
  return (s.rtt ?? 0) / 2 + (s.buffer ?? 0) + 0.05;
}

export function health(s: ViewerStats): Health {
  const delay = estimateDelay(s) ?? 0;
  if (s.fps >= 12 && delay < 0.8 && s.lossPct < 3) return "good";
  if (s.fps >= 5 && delay < 2 && s.lossPct < 10) return "slow";
  return "bad";
}

/** How big the shared screen looks for them: 1 = actual size, 0.3 = a third of actual size. */
export function shownScale(s: ViewerStats): number | null {
  if (!s.frameW || !s.frameH) return null;
  return Math.min(s.vw / s.frameW, s.vh / s.frameH);
}

/** Plain-English problems for the rep, most important first. */
export function viewerAlerts(s: ViewerStats, device: ViewerDevice): string[] {
  const out: string[] = [];
  if (!s.visible) out.push("They switched to another tab or app. Ask them to come back to the screen.");
  if (device.kind !== "computer" && s.portrait) out.push("They're holding the phone upright, so everything is tiny. Ask them to turn it sideways.");
  if (device.kind !== "computer" && !s.portrait && !s.fullscreen) out.push("Not full screen. Ask them to tap the full-screen button (bottom right).");
  if (device.kind === "computer" && !s.fullscreen && s.vw < 1000) out.push("Their window is small. Ask them to make it bigger or tap full screen.");
  const h = health(s);
  if (h === "bad") out.push("Their connection is struggling. Give it a second after each click.");
  else if (h === "slow") out.push("Their connection is a bit slow. Pause a moment after each click.");
  const scale = shownScale(s);
  if (scale != null && scale < 0.35 && out.length === 0) out.push("Your screen looks small for them. Zoom in on what you're showing (Ctrl +).");
  return out;
}

/** "iPhone", "Android phone", "Windows computer"… from the browser's user agent. */
export function describeDevice(ua: string, touch: boolean, shortSide: number): ViewerDevice {
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch);
  if (/iPhone|iPod/.test(ua)) return { kind: "phone", label: "iPhone" };
  if (iPad) return { kind: "tablet", label: "iPad" };
  if (/Android/.test(ua)) return /Mobile/.test(ua) || shortSide < 600 ? { kind: "phone", label: "Android phone" } : { kind: "tablet", label: "Android tablet" };
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  return { kind: "computer", label: os ? `${os} computer` : "Computer" };
}

/**
 * Start video at a healthy quality instead of WebRTC's cautious default (which takes ~30 seconds
 * to sharpen up). Chrome reads these from the answer it receives; on a slow line it still backs off.
 */
export function quickStart(sdp: string, startKbps = 1500): string {
  const lines = sdp.split("\r\n");
  const video = new Set<string>();
  for (const l of lines) {
    const m = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\/90000/i.exec(l);
    if (m) video.add(m[1]);
  }
  const extra = `x-google-start-bitrate=${startKbps}`;
  const out: string[] = [];
  const done = new Set<string>();
  for (const l of lines) {
    const f = /^a=fmtp:(\d+) (.*)$/.exec(l);
    if (f && video.has(f[1]) && !l.includes("x-google-start-bitrate")) {
      out.push(`${l};${extra}`);
      done.add(f[1]);
      continue;
    }
    out.push(l);
    const r = /^a=rtpmap:(\d+) /.exec(l);
    if (r && video.has(r[1]) && !lines.some((x) => x.startsWith(`a=fmtp:${r[1]} `))) {
      out.push(`a=fmtp:${r[1]} ${extra}`);
      done.add(r[1]);
    }
  }
  return out.join("\r\n");
}
