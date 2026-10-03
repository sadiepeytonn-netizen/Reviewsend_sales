import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { twilioConfig } from "@/lib/twilio";

// Plays (or, for admins, downloads) a call recording. The recording itself
// stays in Twilio; this checks the viewer may see the call, then streams it.
export async function GET(req: Request, ctx: RouteContext<"/api/recordings/[callId]">) {
  const profile = await getCurrentProfile();
  if (!profile?.active) return new Response("Not signed in", { status: 401 });
  const { callId } = await ctx.params;

  // Row-level security: reps only find their own calls.
  const supabase = await createClient();
  const { data: call } = await supabase.from("calls").select("id, recording_sid, started_at, to_number").eq("id", callId).maybeSingle();
  if (!call?.recording_sid) return new Response("Recording not found", { status: 404 });

  const c = twilioConfig();
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Recordings/${call.recording_sid}.mp3`, {
    headers: { Authorization: `Basic ${Buffer.from(`${c.apiKeySid}:${c.apiKeySecret}`).toString("base64")}` },
  });
  if (!res.ok || !res.body) return new Response("Couldn't load the recording", { status: 502 });

  const download = profile.role === "admin" && new URL(req.url).searchParams.has("download");
  const name = `call-${call.to_number.replace(/\D/g, "")}-${call.started_at.slice(0, 10)}.mp3`;
  return new Response(res.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
    },
  });
}
