import "server-only";
import twilio from "twilio";

// Twilio settings live in Vercel environment variables (see docs/SETUP.md, step 3).
export function twilioConfig() {
  const c = {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    apiKeySid: process.env.TWILIO_API_KEY_SID,
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET,
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID,
    callerIds: (process.env.TWILIO_CALLER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const missing = [
    !c.accountSid && "TWILIO_ACCOUNT_SID",
    !c.authToken && "TWILIO_AUTH_TOKEN",
    !c.apiKeySid && "TWILIO_API_KEY_SID",
    !c.apiKeySecret && "TWILIO_API_KEY_SECRET",
    !c.twimlAppSid && "TWILIO_TWIML_APP_SID",
    c.callerIds.length === 0 && "TWILIO_CALLER_IDS",
  ].filter(Boolean) as string[];
  return { ...c, missing, ready: missing.length === 0 };
}

/** Short-lived token that lets one rep's browser place calls. */
export function voiceToken(identity: string): string {
  const c = twilioConfig();
  const { AccessToken } = twilio.jwt;
  const token = new AccessToken(c.accountSid!, c.apiKeySid!, c.apiKeySecret!, { identity, ttl: 60 * 60 });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: c.twimlAppSid!, incomingAllow: false }));
  return token.toJwt();
}

/** Prefer a caller ID in the lead's area code; otherwise spread calls across numbers. */
export function pickCallerId(to: string, callerIds: string[]): string {
  const area = to.replace(/^\+1/, "").slice(0, 3);
  const local = callerIds.filter((n) => n.replace(/^\+1/, "").startsWith(area));
  const pool = local.length ? local : callerIds;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** The public URL Twilio used to reach us (needed to check its signature). */
export function publicUrl(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${url.pathname}${url.search}`;
}

/**
 * Reads a Twilio webhook and proves it really came from Twilio (signed with
 * our auth token). Returns the form fields, or null if the signature is wrong.
 */
export async function readTwilioWebhook(req: Request): Promise<Record<string, string> | null> {
  const c = twilioConfig();
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });
  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!c.authToken || !twilio.validateRequest(c.authToken, signature, publicUrl(req), params)) return null;
  return params;
}

export function twiml(xml: string, status = 200) {
  return new Response(xml, { status, headers: { "Content-Type": "text/xml" } });
}

export const VoiceResponse = twilio.twiml.VoiceResponse;

/** Server-side Twilio API client (uses the subaccount's API key). */
export function twilioClient() {
  const c = twilioConfig();
  return twilio(c.apiKeySid!, c.apiKeySecret!, { accountSid: c.accountSid! });
}

/** Each call's private conference room. */
export const conferenceName = (callId: string) => `call-${callId}`;

/** The live conference for a call (null if it has ended). */
export async function findConference(callId: string): Promise<string | null> {
  const list = await twilioClient().conferences.list({ friendlyName: conferenceName(callId), status: "in-progress", limit: 1 });
  return list[0]?.sid ?? null;
}

export type MonitorMode = "listen" | "whisper" | "barge";

/** What a person may do on other reps' calls. Admins can do everything. */
export function allowedModes(p: { role: string; can_listen?: boolean | null; can_whisper?: boolean | null; can_barge?: boolean | null }): MonitorMode[] {
  if (p.role === "admin") return ["listen", "whisper", "barge"];
  return [p.can_listen && "listen", p.can_whisper && "whisper", p.can_barge && "barge"].filter(Boolean) as MonitorMode[];
}
