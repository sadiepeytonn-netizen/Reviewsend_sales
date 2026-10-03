@AGENTS.md

# ReviewSend Sales CRM

- The owner is not a programmer. Explain steps simply and give exact clicks for
  GitHub, Vercel, Supabase, Twilio, Stripe, and Namecheap. Never ask for passwords
  or API keys in chat; say which environment variable to set and where.
- Agreed product decisions: `docs/PLAN.md`. Keep it updated when decisions change.
- Database changes: add a NEW numbered file in `supabase/migrations/` (never edit
  one that has already been run) and tell the owner to run it in the SQL Editor.
- `dnc_numbers` and `events` are permanent (triggers block update/delete).
- Every page/server action starts with `requireUser()` or `requireAdmin()`.
  Use the admin (secret-key) client only after that check.
- Before pushing: `npm run lint && npm run typecheck && npm test && npm run build`.
