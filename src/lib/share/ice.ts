import "server-only";
import { twilioClient, twilioConfig } from "@/lib/twilio";

const STUN: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
let cached: { servers: RTCIceServer[]; until: number } | null = null;

/**
 * Connection helpers for screen sharing. Twilio's relay (TURN) gets video through strict office
 * networks; credentials last an hour and are reused for 10 minutes. Falls back to plain STUN.
 */
export async function shareIceServers(): Promise<RTCIceServer[]> {
  if (cached && cached.until > Date.now()) return cached.servers;
  if (!twilioConfig().ready) return STUN;
  try {
    const token = await twilioClient().tokens.create({ ttl: 3600 });
    const servers = (token.iceServers ?? []).map((s) => {
      const r = s as { urls?: string; url?: string; username?: string; credential?: string };
      return { urls: r.urls ?? r.url ?? "", username: r.username, credential: r.credential } as RTCIceServer;
    }).filter((s) => s.urls);
    cached = { servers: servers.length ? servers : STUN, until: Date.now() + 10 * 60_000 };
    return cached.servers;
  } catch {
    return STUN;
  }
}
