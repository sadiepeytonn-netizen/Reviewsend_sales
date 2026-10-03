import { createAdminClient } from "@/lib/supabase/admin";
import { VoiceResponse, readTwilioWebhook, twiml } from "@/lib/twilio";

// Played only to the person being called, right after they answer.
export async function POST(req: Request) {
  if (!(await readTwilioWebhook(req))) return new Response("Invalid signature", { status: 403 });
  const { data } = await createAdminClient().from("settings").select("recording_notice_text").eq("id", 1).single();
  const r = new VoiceResponse();
  r.say({ voice: "Polly.Joanna" }, data?.recording_notice_text ?? "This call may be recorded for quality purposes.");
  return twiml(r.toString());
}
