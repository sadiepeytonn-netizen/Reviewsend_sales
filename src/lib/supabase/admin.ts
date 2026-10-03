import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Full-access Supabase client using the secret key. Bypasses row-level
// security, so only use it in server code AFTER checking the caller's role.
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
