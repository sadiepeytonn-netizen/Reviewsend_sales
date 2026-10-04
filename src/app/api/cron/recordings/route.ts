import { createAdminClient } from "@/lib/supabase/admin";
import { twilioConfig } from "@/lib/twilio";

// Runs once a day (see vercel.json). Deletes call recordings older than the
// retention period in Settings (365 days) from Twilio, and marks them deleted.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const c = twilioConfig();
  if (!c.ready) return Response.json({ skipped: "Twilio not configured" });

  const supabase = createAdminClient();
  const { data: settings } = await supabase.from("settings").select("recording_retention_days").eq("id", 1).single();
  const days = settings?.recording_retention_days ?? 365;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: old } = await supabase
    .from("calls")
    .select("id, recording_sid")
    .not("recording_sid", "is", null)
    .is("recording_deleted_at", null)
    .lt("started_at", cutoff)
    .limit(500);

  const auth = `Basic ${Buffer.from(`${c.apiKeySid}:${c.apiKeySecret}`).toString("base64")}`;
  let deleted = 0;
  let failed = 0;
  for (const call of old ?? []) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Recordings/${call.recording_sid}.json`, {
      method: "DELETE",
      headers: { Authorization: auth },
    }).catch(() => null);
    if (!res) {
      failed++;
      continue;
    }
    // 404 = already gone at Twilio; count it as deleted too.
    if (res.status === 204 || res.status === 404) {
      await supabase.from("calls").update({ recording_deleted_at: new Date().toISOString() }).eq("id", call.id);
      deleted++;
    } else failed++;
  }
  return Response.json({ checked: old?.length ?? 0, deleted, failed });
}
