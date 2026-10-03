import { createAdminClient } from "@/lib/supabase/admin";
import { VoiceResponse, readTwilioWebhook, twiml } from "@/lib/twilio";

// Runs when the dial finishes. Backup for the status webhook (e.g. the prospect
// never answered, so no "completed" came for an answered call).
export async function POST(req: Request) {
  const params = await readTwilioWebhook(req);
  if (!params) return new Response("Invalid signature", { status: 403 });
  const callId = new URL(req.url).searchParams.get("callId");

  if (callId) {
    const supabase = createAdminClient();
    const { data: call } = await supabase.from("calls").select("id, rep_id, lead_id, answered_at, ended_at").eq("id", callId).maybeSingle();
    if (call && !call.ended_at) {
      const status = params.DialCallStatus ?? "completed";
      const duration = call.answered_at ? Number.parseInt(params.DialCallDuration ?? "0", 10) || 0 : 0;
      await supabase
        .from("calls")
        .update({ ended_at: new Date().toISOString(), duration_seconds: duration, twilio_status: status })
        .eq("id", call.id);
      await supabase.from("events").insert({
        type: "call_ended",
        rep_id: call.rep_id,
        lead_id: call.lead_id,
        call_id: call.id,
        data: { status, talk_seconds: duration, answered: Boolean(call.answered_at) },
      });
    }
  }
  const r = new VoiceResponse();
  r.hangup();
  return twiml(r.toString());
}
