import { createAdminClient } from "@/lib/supabase/admin";
import {
  VoiceResponse,
  allowedModes,
  conferenceName,
  pickCallerId,
  publicUrl,
  readTwilioWebhook,
  twilioClient,
  twilioConfig,
  twiml,
  type MonitorMode,
} from "@/lib/twilio";

const blocked = (msg: string) => {
  const r = new VoiceResponse();
  r.say(msg);
  r.hangup();
  return twiml(r.toString());
};

// Twilio asks this URL what to do when a browser starts a call: either a rep
// calling a lead, or someone listening in on a rep's call ("monitor").
// Everything is re-checked here (right person, fresh call, not on Do Not Call).
export async function POST(req: Request) {
  const params = await readTwilioWebhook(req);
  if (!params) return new Response("Invalid signature", { status: 403 });

  const userId = (params.From ?? "").replace(/^client:/, "");
  if (params.monitor) return monitor(userId, params.monitor, params.mode);

  const callId = params.callId ?? "";
  const supabase = createAdminClient();

  const { data: call } = await supabase
    .from("calls")
    .select("id, rep_id, to_number, twilio_call_sid, created_at")
    .eq("id", callId)
    .maybeSingle();
  if (!call || call.rep_id !== userId || call.twilio_call_sid || Date.now() - Date.parse(call.created_at) > 2 * 60_000) {
    return blocked("This call could not be started. Please try again.");
  }
  const { data: dnc } = await supabase.from("dnc_numbers").select("phone_e164").eq("phone_e164", call.to_number).maybeSingle();
  if (dnc) return blocked("This number is on the do not call list.");

  const { callerIds } = twilioConfig();
  const callerId = pickCallerId(call.to_number, callerIds);
  const base = new URL(publicUrl(req)).origin;
  const q = `callId=${encodeURIComponent(call.id)}`;
  const { data: settings } = await supabase.from("settings").select("conference_calls").eq("id", 1).single();

  // ---- Conference call (lets admins / allowed reps listen in) ---------------
  // The rep joins a private room; Twilio dials the prospect into the same room.
  // Only the prospect's side is recorded, so whispers to the rep never are.
  // (Direct calls until migration 0008 has been run.)
  if ((settings as { conference_calls?: boolean } | null)?.conference_calls === true) {
    const room = conferenceName(call.id);
    let prospectSid: string;
    try {
      const p = await twilioClient().conferences(room).participants.create({
        from: callerId,
        to: call.to_number,
        label: "prospect",
        earlyMedia: true, // the rep hears it ring
        beep: "false",
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        timeout: 30,
        record: true,
        recordingChannels: "dual",
        recordingStatusCallback: `${base}/api/webhooks/twilio/recording?${q}`,
        recordingStatusCallbackEvent: ["completed"],
        statusCallback: `${base}/api/webhooks/twilio/status?${q}`,
        statusCallbackEvent: ["answered", "completed"],
      });
      prospectSid = p.callSid;
    } catch (e) {
      console.error("Twilio participant create failed", e);
      return blocked("The call could not be placed. Please try again.");
    }
    await supabase
      .from("calls")
      .update({ twilio_call_sid: params.CallSid, from_number: callerId, conference: true, prospect_call_sid: prospectSid })
      .eq("id", call.id);

    const r = new VoiceResponse();
    r.dial({ action: `${base}/api/webhooks/twilio/dial-done?${q}` }).conference(
      { beep: "false", startConferenceOnEnter: true, endConferenceOnExit: true, waitUrl: "", participantLabel: "rep" },
      room,
    );
    return twiml(r.toString());
  }

  // ---- Direct call (fallback; no listening in) -------------------------------
  await supabase.from("calls").update({ twilio_call_sid: params.CallSid, from_number: callerId }).eq("id", call.id);
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
      // No automated notice: the rep tells the prospect the call is recorded (reminder on the dialer).
      statusCallback: `${base}/api/webhooks/twilio/status?${q}`,
      statusCallbackEvent: ["answered", "completed"],
    },
    call.to_number,
  );
  return twiml(r.toString());
}

/** Someone joins a rep's call silently (listen), talking only to the rep (whisper), or openly (barge). */
async function monitor(userId: string, callId: string, rawMode: string | undefined) {
  const mode = (["listen", "whisper", "barge"].includes(rawMode ?? "") ? rawMode : "listen") as MonitorMode;
  const supabase = createAdminClient();
  const [{ data: me }, { data: call }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("calls").select("*").eq("id", callId).maybeSingle(),
  ]);
  if (!me?.active || !allowedModes(me).includes(mode)) return blocked("You aren't allowed to do that.");
  if (!call || !call.conference || call.ended_at || !call.twilio_call_sid || call.rep_id === userId) {
    return blocked("That call has ended.");
  }

  await supabase.from("events").insert({
    type: "call_monitored",
    rep_id: userId, // logged under the listener, so the rep never sees it
    call_id: call.id,
    data: { mode, rep: call.rep_id },
  });

  const r = new VoiceResponse();
  r.dial().conference(
    {
      beep: "false",
      startConferenceOnEnter: false,
      endConferenceOnExit: false,
      waitUrl: "",
      muted: mode === "listen",
      coach: mode === "whisper" ? call.twilio_call_sid : undefined,
      participantLabel: `monitor-${userId}`,
    },
    conferenceName(call.id),
  );
  return twiml(r.toString());
}
