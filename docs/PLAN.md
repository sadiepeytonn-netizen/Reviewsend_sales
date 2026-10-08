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
- Admin can **Add a lead** by hand (Leads page). Same checks as an import (valid phone, Do Not Call,
  duplicates fill in blanks, time zone/list). Filed under a daily "Added by hand" import.
- Do Not Call list is permanent (the database refuses deletes). Checked on import
  and before every dial. National DNC registry check: not in v1.
- **Ownership:** leads are shared until a rep books an appointment or makes a sale.
  Then the lead belongs to that rep and leaves the dialing pool.
- **Private lists:** only the admin can upload, and can upload a CSV for one person (any rep or
  the admin). Those new leads go on that person's private list: only they see or call them (the
  dialer's **MY LIST**; keypad and calendar block everyone else). Numbers already in the CRM stay
  with whoever had them (shared pool, another rep's client, or list). Private leads follow the
  normal retry rules and stay private when exhausted. The admin can move a whole list to someone
  else or into the shared pool (Leads page → Private lists).
- **Never reached:** Leads → Never reached lists leads called N+ times (default 10) with no real
  conversation. The admin can remove them from dialing (status Removed): they keep their history,
  and re-imports don't bring them back.
- **Editing leads:** everyone can edit any lead they can see (reps: the lead on their dialer,
  their clients, their private list; admin: all) with the **Edit lead** button on the dialer and
  lead pages. A new phone number must be valid, not on Do Not Call, and not another lead's; the time
  zone and EAST/WEST list follow the new number. Every edit is written into the lead's notes
  ("✏️ Edited — Business: A → B") and the permanent event log.
- **Notes & call history:** notes and every call (who, when, outcome, talk time, caller ID,
  recording) in one timeline per lead, with "Called 12 times · never reached anyone".

### Dialer
- Dispositions: No Answer, Not Interested, Appointment Set, Demo Completed, Sold,
  Do Not Call, Bad Number. (No Callback disposition.)
- **Contact** = any disposition except No Answer and Bad Number.
- Atomic lead claiming (two reps can never get the same lead); claims last
  3 minutes and are renewed while the rep is on the lead.
- No Answer retry rules: attempts 1–2 retry after 4 hours; attempts 3–6 retry
  the next business day, alternating morning/afternoon; after 6 → Exhausted
  (admin can recycle). All adjustable in settings.
- Calling hours: **off** (owner's decision): reps can call any lead at any time. The admin
  Dashboard (Phone system → Calling hours) can turn 8am–8pm in the lead's local time back on.
- Recording notice: **no automated message.** Reps say it themselves at the start of every call
  ("Heads up, I record my calls for training."). The dialer shows a yellow reminder during every
  call. Calls are still recorded. (Florida needs every party's consent. Have a lawyer check the wording.)
- Pause with reason (lunch, break, meeting, training, other).
- Florida caller ID numbers (start with 2–3), registered in Twilio Trust Hub.

### Calls never drop when moving around the app
The phone and dialing session live in the app layout, not the Dialer page. Reps can open
Calendar, Payments, My leads, etc. mid-call; a bar at the top of every page shows the call
(timer, Mute, Hang up, Back to dialer), or a pending outcome, or the dialing session. A call
ends only on Hang up, the other side hanging up, or closing/reloading the browser tab (the
browser asks "Leave site?" first).

### Dialer details (built in step 3)
- Reps can also call their own leads (appointments, follow-ups) from **My leads**;
  No Answer on an owned lead keeps it with the rep instead of returning it to the pool.
- "Pick an outcome without calling" exists for obvious bad numbers or a phone problem;
  dial stats count only real calls.
- Keypad (for phone menus), mute, "pause after this call", and a default appointment
  of the next weekday at 10am.
- **Copy number / Google it** stay on the lead card before, during, and after the call.
- **Call back** on the outcome screen redials the same person (dropped or failed call); the
  dropped call stays in the history with no outcome.
- Caller ID: a number with the lead's area code if one exists, otherwise a random one
  of the company's numbers. The dialer shows "Calling from …" during each call, and Past calls
  shows which number each call used.
- Admin can recycle exhausted leads back into the pool from the Leads page.

### Keypad ("Dial a number")
- A fold-out keypad on the dialer, above Notes (and on the idle / empty screens). No calling-hours
  limit on keypad dials. Do Not Call numbers are still blocked.
- A number belonging to another rep's client is blocked. A number another rep has on screen right
  now is blocked.
- A number that's already a lead opens that lead (owner, notes, past calls) and dials. Shared-pool
  leads are held for the rep like a normal dialer lead.
- An unknown number dials. After the call, the rep saves it as a lead (owner name, business name, phone
  prefilled, email optional) and then picks the outcome. Phone numbers never duplicate. If nobody
  answered, the rep can choose "No answer, don't save" or "Wrong number" instead.
- Keypad calls count in Dials and Contacts like any call. They also have their own **Manual dials**
  column. A rep who was dialing EAST/WEST goes back to the queue afterwards.

### Owner name
- The owner's name is the most important piece of a lead. On the dialer it's the biggest text on
  the card, above the business name. If it's missing, a yellow box asks for it, and the rep can
  type it in on the spot.
- The dialer has **Copy number** and **Google it** buttons for looking up the business before calling.
- Imports map "Owner", "Owner name", "Contact name", "First/Last name" to the owner's name.
  HubSpot's "Company owner" (a HubSpot user) is not mapped.

### Live: listen / whisper / barge (tested with real calls ✅)
- A **Live** section in the menu (under the pages) lists every rep with their status. A rep on a
  call also shows who they're talking to: owner's name, business name, and phone number (admin can
  click the number to open the lead). Click a rep
  who's on a call, then **Listen**, **Whisper**, or **Barge**. You can switch modes while on the
  call, or **Leave**. A purple bar on every page shows whose call you're on.
- All reps can listen by default. Whisper and barge are off by default. The admin turns each one on
  or off per rep on the rep's user page. Admin can always do all three. People with none of them
  don't see the Live section.
- Reps are never shown that someone is listening (no beep, nothing on screen). Each listen-in is
  logged under the listener, for the admin only.
- To listen, you must not be dialing (pause or stop first).
- Ringing: conference calls don't get Twilio's own ringing sound, so the CRM plays a ringing tone in
  the rep's headset until the prospect answers (Twilio tells the browser instantly; checked every
  second as a backup).
- How it works: each call is a private Twilio conference room (rep + prospect). Only the prospect's
  side is recorded, so whispers are never in recordings. Keypad tones for phone menus are sent
  through the server (about a half-second delay per key).
- Backup switch on the admin Dashboard (**Phone system**): direct calls (the old way, no listening).

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

### Booking from the calendar
- Click an empty time on the week view (snaps to 15 minutes), or **New appointment**, to book a
  demo. Pick a lead you own (reps can search only their own leads; admin searches all), or enter a
  new client (owner, business, phone, email). A phone number already in the CRM is matched, not
  duplicated. Another rep's client is blocked. Admin picks which rep it's for.
- Calendar bookings do **not** count as "appointments set". Only the dialer's Appointment set outcome counts.

### Calendar details (built in step 4)
- Week view with time blocks (business name, time, phone); phones get a day-by-day list.
  Admin sees everyone (color per rep) with a rep filter.
- Appointment outcomes: Showed (lead → Demo completed), Demo missed, Canceled,
  Reschedule, and Undo. Past appointments with no outcome are listed at the top
  of the calendar until marked.
- Private subscribe link per person (.ics) for Google Calendar / iPhone (one-way).
- All times in the CRM are shown in Eastern time (calendar grid uses the device's time).

### Stat definitions (built in step 5)
All in Eastern time, for the chosen range (today / this week / this month / custom).
- **Dials** = calls started. **Contacts** = calls with an outcome other than No answer / Bad number.
- **Talk time** = connected time from Twilio; average is per answered call.
- **Logged in** = time with the CRM open (from once-a-minute check-ins; a closed laptop stops
  the clock at its last check-in). **Not calling** = logged in minus time on calls.
- **Paused** by reason; **Avg between calls** = end of one call to start of the next
  (gaps over 30 minutes are treated as breaks and left out).
- **Appointments set** = Appointment set outcomes on the dialer, counting each lead's **first** one
  only, so re-booking after a missed demo doesn't count twice. Calendar bookings don't count.
  **Appt %** = of contacts.
- **Manual dials** = keypad calls (already included in Dials).
- **Demos** = appointments marked Showed + Demo completed outcomes (each lead once).
  **Show rate** = showed ÷ (showed + demo missed).
- **Pitched, no sale** = demos where the lead isn't sold. **Sales** = Sold outcomes.
  **Close rate** = sales ÷ (sales + pitched, no sale).
- **MRR / commission** come from paid Stripe sales (step 6). Residuals: admin only.
- Live floor refreshes every 10 seconds; a rep with no check-in for 2 minutes shows Offline.
- Recordings older than 365 days are deleted from Twilio daily (Vercel Cron, `CRON_SECRET`).

### Payments (built in step 6)
- **Payments** page in the menu for everyone, plus **Take payment** on the dialer (opens over
  the dialer so the call stays connected). Admin can credit any rep.
- Payment happens while the client is on the phone: **enter card now** (Stripe card box, plain-
  English decline reasons) or **payment link** (emailed via Resend if set up, or copied).
- Prices are negotiated per deal: setup $0–599, monthly $199–699 (editable in settings).
  First charge = setup + first month; then the monthly price automatically.
- Products: every sale is filed under the two CRM products (monthly + setup fee).
- After **Paid ✓**, the rep books onboarding in Calendly (`settings.onboarding_url`) before
  hanging up.
- A sale counts when Stripe confirms the first payment (webhook), which also gives the
  first-month commission from the rep's plan at the time of sale, marks the lead Sold, and
  gives it to the rep. Each later monthly payment adds the residual. Failed payment → past
  due; canceled subscription → canceled (residuals stop).
- Admin: cancel a subscription, record a sale paid outside the CRM (first-month commission
  only), and the **Commissions** page per month with "Mark paid out".
- The old pay site keeps running for existing clients; it and the CRM ignore each other's
  Stripe events.

### Payments (original notes)
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

## Twilio safety rules (protect the client app's texting)
The client app's A2P 10DLC texting registration lives in the MAIN Twilio account
(brand: Isaiah B Enterprises LLC). The CRM must never put it at risk:
- The CRM uses only the **ReviewSend CRM subaccount**, with an API key created
  inside that subaccount (it cannot reach the main account).
- Never edit the main account's Trust Hub profiles, brands, or campaigns.
- The CRM makes voice calls only. No SMS from sales numbers (not in v1).
- SHAKEN/STIR / Voice Integrity on sales numbers only after Twilio support confirms
  it won't affect the A2P brand. CNAM / Branded Calling: on hold.

### Weekly competition (built)
- On the dialer: the full board sits next to the keypad when a rep isn't on a lead; while working
  a lead it shrinks to a slim bar at the top ("#2 of 4 · 135 pts · 15 behind Ryan") that opens the board.
- Weekly: starts Monday, resets every Monday at midnight Eastern. Weekend calls count toward
  that week (so the week is really Monday through Sunday).
- Reps see each other's **points only** (no counts, no money).
- Points: contact 1 · talk time 1 per 2 minutes, only on real conversations (not No answer /
  Bad number), max 10 per call · appointment set (dialer, first time only) 10 · demo held
  (Showed) 15 · sale (paid) 50. Values live in `src/lib/competition.ts`.
- Each rep also sees their own breakdown. Admin sees everyone's breakdown and the leader.
- Board refreshes every 15 seconds. Pop-ups show for any dialer appointment set or paid sale.
- Pop-ups for everyone on the dialer when a rep sets an appointment or makes a sale
  ("🎉 Ryan just set an appointment!").
- Commission payouts stay monthly for now. Weekly pay periods and chargeback clawbacks: undecided.

## On hold
- **Always-open coaching line** (talk to a rep between calls): rep stays connected all session,
  prospects are added and dropped. Bigger rebuild; after Live is tested with real calls.

## Open decisions
- **More caller ID numbers**: 4 numbers (all 954) for 5 people. Adding 4–6 more Florida numbers in
  other area codes is recommended to avoid "Spam Likely" labels; the owner is holding off for now.
- **Inbound callbacks** (prospects calling the sales numbers back): undecided.
  Options: forward to a phone, voicemail in the CRM routed to the last rep who
  called, forward-then-voicemail (recommended), or ring the rep's browser.
  Until decided, the numbers have no voice configuration for incoming calls.

## Build order

1. ✅ Project setup, logins, roles, users, commission plans
2. ✅ Lead import, dedupe, lists, Do Not Call
3. ✅ Dialer + dispositions + notes (test with one rep)
4. ✅ Calendar
5. ✅ Event tracking + dashboards
6. ✅ Stripe payments + commission

## Not in v1
SMS to prospects, email, scripts, AI, lead scoring, auto lead generation,
predictive dialing, two-way Google Calendar sync, national DNC registry scrub.
