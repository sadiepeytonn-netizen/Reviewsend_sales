// Settings come from environment variables (set in Vercel → Settings →
// Environment Variables, or in .env.local when running on your own computer).
// Read lazily so a missing value gives a clear message instead of a crash at build time.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Add it in Vercel → Project → Settings → Environment Variables.`,
    );
  }
  return value;
}

export const env = {
  // NEXT_PUBLIC_ values must be referenced literally so Next.js can inline them for the browser.
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: () =>
    required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY),
};
