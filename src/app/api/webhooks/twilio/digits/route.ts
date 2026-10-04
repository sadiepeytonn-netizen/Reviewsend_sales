import { VoiceResponse, readTwilioWebhook, twiml } from "@/lib/twilio";

// Plays keypad tones to the prospect's side of a conference call (phone menus:
// "press 1 for…"). Conferences don't pass the rep's own key presses through.
export async function POST(req: Request) {
  if (!(await readTwilioWebhook(req))) return new Response("Invalid signature", { status: 403 });
  const digits = (new URL(req.url).searchParams.get("d") ?? "").replace(/[^0-9*#w]/g, "").slice(0, 20);
  const r = new VoiceResponse();
  if (digits) r.play({ digits }, "");
  return twiml(r.toString());
}
