"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { stripeConfig } from "@/lib/stripe";
import { allowedModes } from "@/lib/twilio";
import { shareIceServers } from "@/lib/share/ice";
import { shareLink } from "@/lib/share/slug";

export type ShareStart = { shareId: string; repId: string; link: string; ice: RTCIceServer[] };

/** Rep starts sharing: one open share at a time (an older one left open is closed). */
export async function startShare(input: { leadId?: string | null; callId?: string | null }): Promise<ShareStart | { error: string }> {
  const me = await requireUser();
  const slug = me.share_slug;
  if (!slug) return { error: "You don't have a screen share link yet. Ask an admin to set it on your user page." };
  const lead = z.uuid().safeParse(input.leadId);
  const call = z.uuid().safeParse(input.callId);
  const db = createAdminClient();
  await db.from("screen_shares").update({ ended_at: new Date().toISOString() }).eq("rep_id", me.id).is("ended_at", null);
  const { data, error } = await db
    .from("screen_shares")
    .insert({ rep_id: me.id, lead_id: lead.success ? lead.data : null, call_id: call.success ? call.data : null })
    .select("id")
    .single();
  if (error || !data) return { error: "Couldn't start the screen share. Try again." };
  return { shareId: data.id, repId: me.id, link: shareLink(slug), ice: await shareIceServers() };
}

type Tally = { peak: number; total: number; watchedSeconds: number };
const tallySchema = z.object({ peak: z.number().int().min(0).max(1000), total: z.number().int().min(0).max(10000), watchedSeconds: z.number().int().min(0).max(10_000_000) });

/** Every 20 seconds while sharing: still here (keeps the link live) + viewer totals so far. */
export async function shareHeartbeat(shareId: string, tally: Tally): Promise<{ ok: boolean }> {
  const me = await requireUser();
  const t = tallySchema.safeParse(tally);
  if (!z.uuid().safeParse(shareId).success || !t.success) return { ok: false };
  const { data } = await createAdminClient()
    .from("screen_shares")
    .update({ last_seen_at: new Date().toISOString(), peak_viewers: t.data.peak, viewers_total: t.data.total, watched_seconds: t.data.watchedSeconds })
    .eq("id", shareId)
    .eq("rep_id", me.id)
    .is("ended_at", null)
    .select("id");
  return { ok: Boolean(data?.length) };
}

/** Share ended: final totals, and a note on the lead ("Screen shared 14 min, watched 12 min"). */
export async function endShare(shareId: string, tally: Tally): Promise<void> {
  const me = await requireUser();
  const t = tallySchema.safeParse(tally);
  if (!z.uuid().safeParse(shareId).success || !t.success) return;
  const db = createAdminClient();
  const { data: share } = await db
    .from("screen_shares")
    .update({ ended_at: new Date().toISOString(), peak_viewers: t.data.peak, viewers_total: t.data.total, watched_seconds: t.data.watchedSeconds })
    .eq("id", shareId)
    .eq("rep_id", me.id)
    .is("ended_at", null)
    .select("lead_id, started_at")
    .maybeSingle();
  if (!share?.lead_id || t.data.watchedSeconds < 30) return;
  const minutes = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
  const shared = (Date.now() - Date.parse(share.started_at)) / 1000;
  await db.from("lead_notes").insert({
    lead_id: share.lead_id,
    author_id: me.id,
    body: `Screen share: shared ${minutes(shared)}, ${t.data.total} viewer${t.data.total === 1 ? "" : "s"}, watched ${minutes(t.data.watchedSeconds)} in total.`,
  });
}

/** Emails the rep's link ("Isaiah is ready to show you…") through Resend. */
export async function emailShareLink(input: { email: string; name?: string | null }): Promise<{ error?: string }> {
  const me = await requireUser();
  const slug = me.share_slug;
  if (!slug) return { error: "You don't have a screen share link yet." };
  const email = z.email().safeParse(input.email.trim());
  if (!email.success) return { error: "That email address doesn't look right." };
  const c = stripeConfig();
  if (!c.resendKey) return { error: "Email isn't set up (RESEND_API_KEY)." };
  const first = (me.full_name || "Your ReviewSend rep").split(" ")[0];
  const url = `https://${shareLink(slug)}`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const hi = input.name?.trim() ? `Hi ${esc(input.name.trim().split(" ")[0])},` : "Hi,";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${c.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: c.fromEmail,
      to: email.data,
      subject: `${first} from ReviewSend is ready to show you your screen`,
      html: `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#F7F4EC;border-radius:12px;">
    <div style="color:#E3A94C;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">★ ReviewSend</div>
    <h2 style="color:#14171F;margin:0 0 12px;">${hi} ${esc(first)} is ready to show you.</h2>
    <p style="color:#4B5563;line-height:1.5;">Tap below to watch ${esc(first)}'s screen while you talk. Nothing to download or sign into.</p>
    <a href="${url}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#1F6F5C;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Watch now</a>
    <p style="color:#6B7280;font-size:13px;margin-top:20px;">Or go to <b>${esc(shareLink(slug))}</b></p>
  </div>`,
    }),
  }).catch(() => null);
  return res?.ok ? {} : { error: "Couldn't send the email. Check the address and try again." };
}

// ---------------------------------------------------------------------------
// Watching silently from Live: a short-lived pass the rep's browser checks with the server.
// ---------------------------------------------------------------------------

const sign = (body: string) => createHmac("sha256", env.supabaseSecretKey()).update(`share-watch:${body}`).digest("base64url");

/** Admin (or a rep allowed to listen in) gets a pass to watch someone's screen share. */
export async function watchPass(repId: string): Promise<{ pass?: string; ice?: RTCIceServer[]; error?: string }> {
  const me = await requireUser();
  if (!allowedModes(me).length) return { error: "You can't watch screen shares." };
  if (!z.uuid().safeParse(repId).success || repId === me.id) return { error: "Can't watch that." };
  const body = `${repId}.${me.id}.${Date.now() + 2 * 60 * 60_000}`;
  return { pass: `${body}.${sign(body)}`, ice: await shareIceServers() };
}

/** The sharing rep's browser asks: is this watcher allowed (so they stay off the viewer list)? */
export async function checkWatchPass(pass: string): Promise<boolean> {
  const me = await requireUser();
  const parts = pass.split(".");
  if (parts.length !== 4) return false;
  const [repId, , exp, mac] = parts;
  const expected = Buffer.from(sign(parts.slice(0, 3).join(".")));
  const got = Buffer.from(mac);
  return repId === me.id && Number(exp) > Date.now() && got.length === expected.length && timingSafeEqual(got, expected);
}
