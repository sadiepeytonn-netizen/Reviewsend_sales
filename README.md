# ReviewSend Sales

Sales-floor CRM and single-line power dialer for ReviewSend. Separate from the
ReviewSend client app.

- **What we're building and every decision made:** [docs/PLAN.md](docs/PLAN.md)
- **How to set it up (click-by-click):** [docs/SETUP.md](docs/SETUP.md)

## For developers

- Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Supabase (`@supabase/ssr`).
- Database schema and row-level security: `supabase/migrations/`. Run each new
  file once, in order, in the Supabase SQL Editor.
- Environment variables: see `.env.example`. Put real values in `.env.local`
  locally and in Vercel for deployments.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (commission math)
npm run lint
npm run typecheck
```

### Layout

- `src/proxy.ts`: refreshes the login session on every request and sends
  logged-out visitors to `/login`.
- `src/lib/auth.ts`: `requireUser()` / `requireAdmin()`; call one at the top of
  every page and server action.
- `src/lib/supabase/admin.ts`: full-access client. Server-only, and only after
  `requireAdmin()` (or another explicit permission check).
- `src/lib/commission.ts`: commission rules (per-rep plans), with tests.
- `src/app/(app)/`: pages behind login (admin under `admin/`).
