import { z } from "zod";
import { buildIcs } from "@/lib/calendar/ics";
import { formatPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";

// Private, subscribe-able calendar feed: /api/calendar/<token>.ics
// The long random token in the link is the only "password", so each person's
// link shows only their own appointments (an admin's link shows everyone's).
export async function GET(req: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  const { token: raw } = await ctx.params;
  const token = raw.replace(/\.ics$/i, "");
  if (!z.uuid().safeParse(token).success) return new Response("Not found", { status: 404 });

  const supabase = createAdminClient();
  const { data: feed } = await supabase
    .from("calendar_feeds")
    .select("rep_id, profile:profiles!calendar_feeds_rep_id_fkey(role, active, full_name)")
    .eq("token", token)
    .maybeSingle();
  const profile = feed?.profile as unknown as { role: string; active: boolean; full_name: string } | null;
  if (!feed || !profile?.active) return new Response("Not found", { status: 404 });

  const from = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 365 * 86_400_000).toISOString();
  let query = supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status, lead:leads(id, business_name, contact_name, phone_e164, city, state), rep:profiles!appointments_rep_id_fkey(full_name)")
    .in("status", ["scheduled", "showed", "missed", "canceled"])
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at");
  const isAdmin = profile.role === "admin";
  if (!isAdmin) query = query.eq("rep_id", feed.rep_id);
  const { data } = await query;

  type Row = {
    id: string; starts_at: string; ends_at: string; status: string;
    lead: { id: string; business_name: string; contact_name: string | null; phone_e164: string | null; city: string | null; state: string | null } | null;
    rep: { full_name: string } | null;
  };
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const origin = `${req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")}://${host}`;
  const events = ((data ?? []) as unknown as Row[]).map((a) => {
    const lead = a.lead;
    const phone = formatPhone(lead?.phone_e164);
    const who = isAdmin && a.rep?.full_name ? ` (${a.rep.full_name})` : "";
    const outcome = a.status === "missed" ? " [MISSED]" : a.status === "showed" ? " [showed]" : "";
    return {
      uid: `${a.id}@reviewsend-sales`,
      start: new Date(a.starts_at),
      end: new Date(a.ends_at),
      summary: `Demo: ${lead?.business_name ?? "Lead"}${phone ? ` · ${phone}` : ""}${who}${outcome}`,
      description: [
        lead?.contact_name && `Owner: ${lead.contact_name}`,
        phone && `Phone: ${phone}`,
        [lead?.city, lead?.state].filter(Boolean).join(", "),
        lead && `Open in CRM: ${origin}/leads/${lead.id}`,
      ].filter(Boolean).join("\n"),
      url: lead ? `${origin}/leads/${lead.id}` : undefined,
      canceled: a.status === "canceled",
    };
  });

  return new Response(buildIcs(isAdmin ? "ReviewSend Sales: all demos" : "ReviewSend Sales: my demos", events), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": 'inline; filename="reviewsend-sales.ics"',
    },
  });
}
