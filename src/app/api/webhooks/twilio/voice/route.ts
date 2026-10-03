import { createAdminClient } from "@/lib/supabase/admin";
import { VoiceResponse, pickCallerId, publicUrl, readTwilioWebhook, twilioConfig, twiml } from "@/lib/twilio";

// Twilio asks this URL what to do when a rep's browser starts a call.
// We re-check everything (right rep, fresh call, not on Do Not Call) before dialing.
export async function POST(req: Request) {
  const params = await readTwilioWebhook(req);
  if (!params) return new Response("Invalid signature", { status: 403 });

  const blocked = (msg: string) => {
    const r = new VoiceResponse();
    r.say(msg);
    r.hangup();
    return twiml(r.toString());
  };

  const repId = (params.From ?? "").replace(/^client:/, "");
  const callId = params.callId ?? "";
  const supabase = createAdminClient();

  const { data: call } = await supabase
    .from("calls")
    .select("id, rep_id, to_number, twilio_call_sid, created_at")
    .eq("id", callId)
    .maybeSingle();
  if (!call || call.rep_id !== repId || call.twilio_call_sid || Date.now() - Date.parse(call.created_at) > 2 * 60_000) {
    return blocked("This call could not be started. Please try again.");
  }
  const { data: dnc } = await supabase.from("dnc_numbers").select("phone_e164").eq("phone_e164", call.to_number).maybeSingle();
  if (dnc) return blocked("This number is on the do not call list.");

  const { callerIds } = twilioConfig();
  const callerId = pickCallerId(call.to_number, callerIds);
  await supabase.from("calls").update({ twilio_call_sid: params.CallSid, from_number: callerId }).eq("id", call.id);

  const base = new URL(publicUrl(req)).origin;
  const q = `callId=${encodeURIComponent(call.id)}`;
  const r = new VoiceResponse();
  const dial = r.dial({
    callerId,
    answerOnBridge: true,
    timeout: 30,
    record: "record-from-answer-dual",
    recordingStatusCallback: `${base}/api/webhooks/twilio/recording?${q}`,
    recordingStatusCallbackEvent: ["completed"],
    action: `${base}/api/webhooks/twilio/dial-done?${q}`,
  });
  dial.number(
    {
      // Plays the recording notice to the prospect when they pick up, before they hear the rep.
      url: `${base}/api/webhooks/twilio/notice`,
      statusCallback: `${base}/api/webhooks/twilio/status?${q}`,
      statusCallbackEvent: ["answered", "completed"],
    },
    call.to_number,
  );
  return twiml(r.toString());
}
