import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { shareIceServers } from "@/lib/share/ice";

// Public (prospects aren't signed in): connection helpers for watching a screen share.
// Only handed out while that rep is actually sharing, so the relay can't be used for anything else.
export async function GET(req: Request) {
  const rep = z.uuid().safeParse(new URL(req.url).searchParams.get("rep"));
  if (!rep.success) return Response.json({ error: "bad request" }, { status: 400 });
  const { data: active } = await (await createClient()).rpc("share_active", { p_rep: rep.data });
  if (!active) return Response.json({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  return Response.json({ iceServers: await shareIceServers() }, { headers: { "Cache-Control": "no-store" } });
}
