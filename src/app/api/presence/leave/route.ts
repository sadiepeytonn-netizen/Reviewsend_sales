import { createClient } from "@/lib/supabase/server";

// The dialer page calls this when the tab closes, so the rep's lead goes back
// to the list right away instead of waiting for the claim to expire.
export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return new Response(null, { status: 204 });
  await supabase.rpc("set_presence", { p_status: "idle" });
  return new Response(null, { status: 204 });
}
