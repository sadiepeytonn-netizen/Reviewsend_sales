import { createAdminClient } from "@/lib/supabase/admin";
import { readTwilioWebhook, twilioClient } from "@/lib/twilio";

// Status of the prospect's side of the call: answered, then completed.
export async function POST(req: Request) {
  const params = await readTwilioWebhook(req);
  if (!params) return new Response("Invalid signature", { status: 403 });
  const callId = new URL(req.url).searchParams.get("callId");
  if (!callId) return new Response("ok");

  const supabase = createAdminClient();
  const { data: call } = await supabase.from("calls").select("*").eq("id", callId).maybeSingle();
  if (!call) return new Response("ok");

  const status = params.CallStatus;
  if ((status === "in-progress" || status === "answered") && !call.answered_at) {
    await supabase.from("calls").update({ answered_at: new Date().toISOString(), twilio_status: "in-progress" }).eq("id", call.id);
    await supabase.from("events").insert({ type: "call_answered", rep_id: call.rep_id, lead_id: call.lead_id, call_id: call.id });
  } else if (["completed", "busy", "no-answer", "failed", "canceled"].includes(status)) {
    const answered = Boolean(call.answered_at) && status === "completed";
    const duration = answered ? Number.parseInt(params.CallDuration ?? "0", 10) || 0 : 0;
    if (!call.ended_at) {
      await supabase
        .from("calls")
        .update({ ended_at: new Date().toISOString(), duration_seconds: duration, twilio_status: status })
        .eq("id", call.id);
      await supabase.from("events").insert({
        type: "call_ended",
        rep_id: call.rep_id,
        lead_id: call.lead_id,
        call_id: call.id,
        data: { status, talk_seconds: duration, answered },
      });
    }
    // Conference call: the prospect is gone (hung up, no answer, busy), so end the rep's side too.
    if (call.conference && call.twilio_call_sid) {
      await twilioClient().calls(call.twilio_call_sid).update({ status: "completed" }).catch(() => {});
    }
  }
  return new Response("ok");
}
