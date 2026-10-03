import { createAdminClient } from "@/lib/supabase/admin";
import { readTwilioWebhook } from "@/lib/twilio";

// Twilio tells us when a call recording is ready.
export async function POST(req: Request) {
  const params = await readTwilioWebhook(req);
  if (!params) return new Response("Invalid signature", { status: 403 });
  const callId = new URL(req.url).searchParams.get("callId");
  if (callId && params.RecordingStatus === "completed" && params.RecordingSid) {
    await createAdminClient()
      .from("calls")
      .update({
        recording_sid: params.RecordingSid,
        recording_duration: Number.parseInt(params.RecordingDuration ?? "0", 10) || 0,
      })
      .eq("id", callId);
  }
  return new Response("ok");
}
