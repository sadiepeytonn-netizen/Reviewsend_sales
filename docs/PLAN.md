# ReviewSend Sales CRM — agreed plan

A standalone sales-floor CRM with a single-line power dialer. Separate from the
ReviewSend client app: its own GitHub repo, Supabase project, Vercel project, and
Twilio subaccount. Planned address: `sales.reviewsend.io`.

## Stack

| Piece | Use |
|---|---|
| Next.js (TypeScript) on Vercel (Pro) | The website |
| Supabase (Pro), new project | Logins, Postgres database, row-level security, live updates |
| Twilio Voice subaccount | Browser calling, recording, Florida caller ID numbers |
| Stripe (existing account) | Taking payment for sales; drives commission |
| Tailwind CSS | Styling |

## Roles

- **Admin** sees everything, manages users, leads, lists, and commission plans.
- **Sales rep** sees only their own leads, calls, appointments, sales, and stats.
- **Manager** (later) sees their team. The database already supports it via `teams`.
- No public sign-up. The admin adds each user and gets a temporary password to
  hand over; the user must choose their own password on first sign-in.

## Decisions

### Leads
- CSV import with column mapping (HubSpot export first, lead vendors later).
- Duplicates: matched by normalized phone number, and by business name + city.
  A duplicate **fills in blank fields** on the existing lead and never overwrites data.
- Time zone (and state, if the file has none) from the phone's area code, using
  Google's phone-number data. Split area codes (e.g. 850 Pensacola vs. Tallahassee)
  are resolved by exchange. Falls back to the State column. EAST list = Eastern +
  Central; WEST list = Mountain, Pacific, Alaska, Hawaii. Admin can change a lead's list.
- Column matching on every import (vendor headers vary); common names are guessed
  automatically and the last choice is remembered per set of headers.
- Only valid US phone numbers are imported; rows without a business name or phone
  are skipped and listed in a downloadable report.
- An import can be undone (removes the leads it added that haven't been called).
- Do Not Call list is permanent (the database refuses deletes). Checked on import
  and before every dial. National DNC registry check: not in v1.
- **Ownership:** leads are shared until a rep books an appointment or makes a sale.
  Then the lead belongs to that rep and leaves the dialing pool.

### Dialer
- Dispositions: No Answer, Not Interested, Appointment Set, Demo Completed, Sold,
  Do Not Call, Bad Number. (No Callback disposition.)
- **Contact** = any disposition except No Answer and Bad Number.
- Atomic lead claiming (two reps can never get the same lead); claims last
  3 minutes and are renewed while the rep is on the lead.
- No Answer retry rules: attempts 1–2 retry after 4 hours; attempts 3–6 retry
  the next business day, alternating morning/afternoon; after 6 → Exhausted
  (admin can recycle). All adjustable in settings.
- Calling hours: only dial 8am–8pm in the lead's local time.
- Recording notice played automatically to the prospect when they answer.
- Pause with reason (lunch, break, meeting, training, other).
- Florida caller ID numbers (start with 2–3), registered in Twilio Trust Hub.

### Dialer details (built in step 3)
- Reps can also call their own leads (appointments, follow-ups) from **My leads**;
  No Answer on an owned lead keeps it with the rep instead of returning it to the pool.
- "Pick an outcome without calling" exists for obvious bad numbers or a phone problem;
  dial stats count only real calls.
- Keypad (for phone menus), mute, "pause after this call", and a default appointment
  of the next weekday at 10am.
- Caller ID: a number with the lead's area code if one exists, otherwise a random one
  of the company's numbers.
- Admin can recycle exhausted leads back into the pool from the Leads page.

### Recordings
- Kept 1 year.
- Reps can listen to their own calls. Admin can listen to and download any call.

### Calendar
- Built in. Default appointment length: 30 minutes.
- The same rep who booked runs the demo, then marks it **Showed** or
  **Demo Missed** (missed demos stay on the rep's list to chase).
- A rep can mark Sold on the first call (no appointment needed).
- Each rep gets a private calendar link to subscribe to in Google Calendar /
  iPhone (one-way). Two-way Google sync is a later project.

### Payments
- The CRM takes over the payment step. On **Sold**, the rep enters setup fee and
  monthly price, then either takes the card now (Stripe Checkout) or sends a
  Stripe invoice. The Stripe customer/subscription is tagged with the rep and lead.
- A sale **counts when the first payment succeeds** (Stripe webhook).
- No refunds, so no clawbacks.
- Admin can enter a manual sale as a backup.

### Commission (per-rep plans, admin-only)
Each rep has their own plan; changes apply only to sales after the change.
"First month" = setup fee + first monthly payment. Residuals start in month 2
and are earned each month the client's payment succeeds.

| Rep | First month | Residual (months 2+) |
|---|---|---|
| Ryan | 50%, including $199 deals | $100/mo, only on clients paying more than $199 |
| Nate (standard plan) | 40% | $75/mo, only on clients paying more than $199 |
| Corban | 50% with a setup fee, 40% without | 30% of the monthly price, only on clients paying more than $199 |

Small-deal rule: $199/mo or less → 40% of the first month (Ryan: 50%) and no
residual for anyone. $199 is currently the lowest price offered.
Reps see their first-month commission; residuals are visible to admin only.

### Stats
Every call and status change is logged to a permanent `events` table from day
one, and all dashboard numbers are calculated from it.

## Build order

1. ✅ Project setup, logins, roles, users, commission plans
2. ✅ Lead import, dedupe, lists, Do Not Call
3. ✅ Dialer + dispositions + notes (test with one rep)
4. Calendar
5. Event tracking + dashboards
6. Stripe payments + commission

## Not in v1
SMS to prospects, email, scripts, AI, lead scoring, auto lead generation,
predictive dialing, two-way Google Calendar sync, national DNC registry scrub.
