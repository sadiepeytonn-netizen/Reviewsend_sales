# Setup guide — Step 1 (logins and users)

This takes about 20–30 minutes. Do the parts in order: **A → B → C → D**.

> **Never paste passwords or keys into the Claude chat.** Every secret below goes
> straight from one website into another (Supabase → Vercel).

---

## A. Create the Supabase project (the database)

1. Go to **https://supabase.com** and sign in (use **Continue with GitHub**).
2. Click **New project**.
   - **Organization:** pick yours (create one called *ReviewSend* if asked).
   - **Project name:** `reviewsend-sales`
   - **Database password:** click **Generate a password**, then save it in your
     password manager. You won't need it day-to-day.
   - **Region:** *East US (North Virginia)*.
   - Click **Create new project** and wait 1–2 minutes until it finishes.
   - Plan: the free plan is fine while testing. Before reps start using it, go to
     **Organization → Billing** and switch to **Pro** (free projects pause after
     a week of no use).

### A2. Set up the database tables
1. In the left sidebar, click **SQL Editor**.
2. Click **+ New query** (or the **+** tab).
3. Open this file on GitHub:
   `supabase/migrations/0001_initial_schema.sql` in the `Reviewsend_sales` repo,
   on the `claude/reviewsend-crm-planning-eo4r8m` branch.
   Click the **Copy raw file** button (two overlapping squares, top-right of the file).
4. Click into the empty SQL Editor box, paste (Ctrl+V / Cmd+V).
5. Click **Run** (bottom-right). You should see **"Success. No rows returned."**
   - Only run it **once**. If you see an error that says something "already exists",
     it was already run, so that's fine.

### A3. Turn off public sign-up
1. Left sidebar → **Authentication**.
2. Under **Configuration**, click **Sign In / Providers**.
3. Turn **off** **"Allow new users to sign up"**, then click **Save changes**.
   (Only you can add people, from inside the CRM.)

### A4. Create your own login (you become the admin)
1. Still in **Authentication**, click **Users**.
2. Click **Add user** → **Create new user**.
3. Enter your email and a strong password. Leave **Auto Confirm User** checked.
4. Click **Create user**.

The very first login ever created automatically becomes the **admin**. You can
add your name later inside the CRM (Users → click yourself).

### A5. Find the three values Vercel needs (don't copy them anywhere yet)
1. Click **Project Settings** (gear icon, bottom of the left sidebar).
2. **Data API** → **Project URL**. It looks like `https://abcdefgh.supabase.co`.
3. **API Keys**:
   - **Publishable key** starts with `sb_publishable_…`
   - **Secret key** starts with `sb_secret_…` (click the eye / **Reveal** to copy it).
     This one is powerful. Only ever paste it into Vercel.

Keep this tab open for part B.

---

## B. Put the website on Vercel

1. Go to **https://vercel.com** and sign in with GitHub.
2. Click **Add New…** → **Project**.
3. Under **Import Git Repository**, find **Reviewsend_sales** and click **Import**.
   - Don't see it? Click **Adjust GitHub App Permissions**, give Vercel access to
     `Reviewsend_sales`, then come back.
4. Leave **Framework Preset** as **Next.js**. Don't change the build settings.
5. Open **Environment Variables** and add these three (Name on the left, Value on the right,
   click **Add** after each):

   | Name | Value (copy from Supabase, part A5) |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
   | `SUPABASE_SECRET_KEY` | Secret key |

6. Click **Deploy** and wait for the confetti (2–3 minutes).
   - If the project page says **No Production Deployment**, nothing has been
     built yet: go to **Deployments** → **Create Deployment** (or the **⋯** menu),
     type the branch name shown on the Overview page, and click **Create Deployment**.
7. Open your site: on the project's **Overview** page, click the address under
   **Domains**. Vercel picks this address, and it often has extra letters
   (e.g. `reviewsend-sales-abc123.vercel.app`), so don't type it from memory.
   Sign in with the email and password from part A4.

If you ever change an environment variable later: Vercel → your project →
**Settings → Environment Variables**, edit it, then **Deployments** → the newest one →
**⋯** → **Redeploy**.

> For business use, upgrade the Vercel team to **Pro** (Settings → Billing).

---

## C. Point sales.reviewsend.io at the site (Namecheap)

1. In Vercel: your project → **Settings** → **Domains** → type `sales.reviewsend.io` → **Add**.
   Vercel will show a **CNAME** record with a value (something like
   `xxxxxxx.vercel-dns-017.com`). Copy that value. It's not a secret.
2. In Namecheap: sign in → **Domain List** → next to **reviewsend.io** click **Manage**.
3. Click the **Advanced DNS** tab.
   - If you see a message that the domain uses **custom DNS** / other nameservers,
     stop and tell Claude. Your DNS is managed somewhere else (maybe Vercel or
     Cloudflare), and the steps are different.
4. Under **Host Records**, click **Add New Record** and choose:
   - **Type:** `CNAME Record`
   - **Host:** `sales`
   - **Value:** the value you copied from Vercel
   - **TTL:** Automatic
5. Click the **green check mark** to save.
6. Back in Vercel's Domains page, it turns **Valid** within a few minutes (can take up to an hour).

This does **not** affect `reviewsend.io` or your client app. It only adds the `sales.` address.

---

## D. Add your reps

1. Sign in to the CRM → **Users**.
2. Fill in **Full name** and **Email**, keep **Role = Sales rep**, click **Add user**.
3. A green box shows a **temporary password**. Give it to the rep in person or by text.
   It's shown only once (use **Reset password** on their page if it gets lost).
4. Click the rep's name → **Commission plan** → **Start from a template**:
   - **Ryan:** "50% first month (even small deals), $100/mo residual"
   - **Nate:** "Standard — 40% first month, $75/mo residual" (already the default)
   - **Corban:** "50% with setup fee / 40% without, 30% monthly residual"

   Check the **What this plan pays** examples, then click **Save plan**.
5. When a rep signs in the first time, they're asked to choose their own password.

To remove someone's access, open their page and click **Turn off account**. Their
history is kept, and you can turn them back on any time.

---

# Step 2 setup (lead import)

One database update, then you're ready to import.

1. In **Supabase** → your **reviewsend-sales** project → **SQL Editor** → **+ New query**.
2. Open `supabase/migrations/0002_lead_import.sql` on GitHub (same branch as before),
   click **Copy raw file**, paste it into the SQL Editor, and click **Run**.
   You should see **"Success. No rows returned."** Run it only once.
3. Vercel updates the website by itself. Once the newest deployment says **Ready**,
   **Leads** and **Do Not Call** appear in the left menu.

## Importing leads

1. Export your leads as a **CSV** file:
   - Google Sheets: **File → Download → Comma-separated values (.csv)**
   - Excel: **File → Save As →** choose **CSV**
   - HubSpot: export the list/view, then open it and save as CSV if it came as Excel.
2. In the CRM: **Leads → Import leads → Choose a CSV file**.
3. Type the **Lead source** (e.g. `HubSpot`, or the vendor's name).
4. Check the **Match the columns** table. Business name and Phone are required;
   set anything you don't need to **Don't import**. The CRM remembers your choices
   for files with the same columns.
5. Click **Import**. When it finishes you'll see how many were added, merged as
   duplicates, skipped for Do Not Call, or skipped for problems. **Download report**
   gives you every row with its result.

Made a mistake? **Leads → Import history → Undo** removes the leads that import
added, as long as nobody has called them yet.

---

# Step 3 setup (dialer + Twilio)

About 30 minutes. Do the parts in order. **Copy each Twilio value straight into
Vercel. Never paste them into the Claude chat.**

## 3A. Database update
Same as before: open `supabase/migrations/0003_dialer.sql` on GitHub → **Copy raw file**
→ Supabase **SQL Editor** → **+ New query** → paste → **Run** (once).

## 3B. Twilio: a separate subaccount for sales calls
1. Sign in at **https://console.twilio.com** with your existing Twilio login.
2. Your main account must be **upgraded** (not a free trial). Trial accounts can only
   call phone numbers you've verified and play a "trial account" message. If the top of
   the console says *Trial*, click **Upgrade** and add billing.
3. Open the **Admin** menu (top right) → **Account management** → **Subaccounts**
   (or type "Subaccounts" in the console search bar).
4. Click **Create new account** (or **Create subaccount**), name it `ReviewSend Sales`,
   and create it.
5. Switch into the new subaccount: click the account name at the top left and choose
   **ReviewSend Sales**. Everything below happens **inside this subaccount**, so your
   SMS/review texting account isn't touched.

## 3C. Account SID and Auth Token
1. On the subaccount's home page, find **Account Info**.
2. In **Vercel → your project → Settings → Environment Variables**, add:

   | Name | Value | Type |
   |---|---|---|
   | `TWILIO_ACCOUNT_SID` | Account SID (starts with `AC`) | Config |
   | `TWILIO_AUTH_TOKEN` | Auth Token (click **Show** / copy) | **Secret** |

## 3D. API key (lets the browser make calls)
1. In Twilio: **Admin** (top right) → **Account management** → **API keys & tokens**
   (search "API keys" if you don't see it).
2. Click **Create API key**. Name: `sales-crm`. Region: **United States (US1)**.
   Key type: **Standard**. Click **Create**.
3. Twilio shows the key **once**. Add to Vercel:

   | Name | Value | Type |
   |---|---|---|
   | `TWILIO_API_KEY_SID` | SID (starts with `SK`) | Config |
   | `TWILIO_API_KEY_SECRET` | Secret | **Secret** |

## 3E. Buy Florida phone numbers (caller ID)
1. In Twilio: **Phone Numbers → Manage → Buy a number**.
2. Country **United States**. In the search box choose **Number** → type an area code
   (e.g. `954`, `305`, `561`, `407`, `813`), and tick **Voice** under capabilities.
3. Click **Buy** on a number you like, and confirm. Repeat for 2–3 numbers.
4. Add to Vercel (all numbers in one value, `+1` then 10 digits, separated by commas,
   no spaces):

   | Name | Value | Type |
   |---|---|---|
   | `TWILIO_CALLER_IDS` | e.g. `+19545551234,+13055556789` | Config |

   The CRM uses a number with the same area code as the lead when it has one.

## 3F. TwiML App (tells Twilio where the CRM lives)
1. In Twilio: **Voice → Manage → TwiML apps** (search "TwiML apps" if needed).
2. Click **Create new TwiML App**.
   - Friendly name: `Sales CRM dialer`
   - **Voice Request URL**: your site address + `/api/webhooks/twilio/voice`, e.g.
     `https://sales.reviewsend.io/api/webhooks/twilio/voice`
     (or your `….vercel.app` address if the domain isn't set up yet). Method **HTTP POST**.
   - Leave Messaging blank. Click **Create** / **Save**.
3. Open the app you just made and copy its **SID** (starts with `AP`). Add to Vercel:

   | Name | Value | Type |
   |---|---|---|
   | `TWILIO_TWIML_APP_SID` | SID (starts with `AP`) | Config |

   If you later switch to `sales.reviewsend.io`, come back and update this URL.

## 3G. Redeploy and test
1. Vercel → **Deployments** → newest → **⋯** → **Redeploy**. Wait for **Ready**.
2. Make a test lead with **your own cell number**: a CSV with a `Company name` and
   `Phone Number` column, imported with lead source `Test`.
3. Open **Dialer** → **EAST** (or WEST, where your number lands) → **Start dialing**.
   The browser asks to use your microphone. Click **Allow**.
4. Click **Call**. Your cell should ring from one of the new numbers; when you answer
   you'll hear the recording notice, then the rep side. Hang up, pick an outcome.
5. Calls only go out **8am–8pm in the lead's time zone**.

## Recommended within the first week: caller ID reputation
New numbers that make lots of calls get labeled "Spam Likely" quickly. In Twilio,
open **Trust Hub** and complete:
1. **Customer Profile** (your business details); approval can take a few days.
2. **SHAKEN/STIR Trust**: add your numbers so calls are "verified".
3. **CNAM**: shows "ReviewSend" as the caller name on many phones.

---

# Step 4 setup (calendar)

1. Open `supabase/migrations/0004_calendar.sql` on GitHub → **Copy raw file** → Supabase
   **SQL Editor** → **+ New query** → paste → **Run** (once). If Supabase warns about
   Row Level Security, choose **Run without RLS**. This file creates no tables.
2. Vercel updates the site by itself. **Calendar** then appears in the left menu.

## Getting appointments onto your phone / Google Calendar
On the **Calendar** page, scroll to **See your demos in Google Calendar or on your phone**
and follow the steps there. Each person has their own private link (an admin's link
includes everyone's demos). Google refreshes subscribed calendars every few hours, so
brand-new bookings can take a while to appear there; the CRM calendar is always instant.

---

# Step 5 setup (dashboards + recording cleanup)

1. **Database:** open `supabase/migrations/0005_stats.sql` on GitHub → **Copy raw file** →
   Supabase **SQL Editor** → **+ New query** → paste → **Run** (once). If the RLS warning
   appears, choose **Run without RLS**.
2. **Recording cleanup password:** recordings older than 1 year are deleted automatically
   once a day. Vercel needs a password so nobody else can trigger it:
   1. Make a long random password (32+ characters) with your password manager's generator.
   2. Vercel → your project → **Settings → Environment Variables** → add
      `CRON_SECRET` = that password, Type **Secret**.
   3. **Deployments** → newest → **⋯** → **Redeploy**.
   Vercel sends this password to the CRM by itself every day; you never need to type it again.

---

# Step 6 setup (Stripe payments + commission)

About 15 minutes. Paste every key straight into Vercel. **Never into the Claude chat.**
All Vercel settings below go in **Vercel → your project → Settings → Environment Variables**.

## 6A. Database
Copy `supabase/migrations/0006_payments.sql` from GitHub → Supabase **SQL Editor** →
**+ New query** → paste → **Run** (once; choose **Run without RLS** if asked).

## 6B. Product IDs (already created)
| Name | Value | Type |
|---|---|---|
| `STRIPE_PRODUCT_IDS` | `prod_VNfmqHIeAF2M7i,prod_VNflV49933M4m8` | Config |

(The CRM reads both names from Stripe: the one with "Setup" in its name is used for setup fees.)

## 6C. Stripe keys
1. Stripe → **Developers** → **API keys**.
2. **Publishable key** (starts `pk_live_`): add as `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (Config).
3. Secret key, recommended as a **restricted key** so the CRM can only do what it needs:
   **Create restricted key** → name `sales-crm` → set these to the access shown, leave everything else **None**:
   - Customers: **Write** · Payment Methods: **Write** · Products: **Read** · Prices: **Write**
   - Subscriptions: **Write** · Invoices: **Write** · Checkout Sessions: **Write**

   Click **Create key**, then copy it (starts `rk_live_`) into `STRIPE_SECRET_KEY` (**Secret**).

## 6D. Webhook (Stripe tells the CRM when a payment goes through)
1. Stripe → **Developers** → **Webhooks** → **Add destination** (or **Add endpoint**).
2. Events: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`,
   `checkout.session.completed`.
3. If asked for an **API version**, choose the **latest** one.
4. Endpoint URL: `https://sales.reviewsend.io/api/webhooks/stripe`
5. Create it, then click **Reveal** under **Signing secret** (starts `whsec_`) and add it as
   `STRIPE_WEBHOOK_SECRET` (**Secret**).

Your old pay site's webhook stays as it is. Each site ignores the other's payments.

## 6E. Emailing payment links (optional)
If you have a **Resend** account (the old pay site used it):
- `RESEND_API_KEY` = your Resend API key (**Secret**)
- `PAYMENT_FROM_EMAIL` = e.g. `ReviewSend <billing@reviewsend.io>` (Config). The domain must be
  verified in Resend.

Without these, reps still get a **Copy link** button to send the payment link themselves.

## 6F. Redeploy and test
1. Vercel → **Deployments** → newest → **⋯** → **Redeploy**.
2. **Payments → New payment**, using your own card for the smallest allowed amount.
3. You should see **Paid ✓** and the Calendly booking. Then, in Stripe, **refund** that payment and
   **cancel** the subscription (or use **Cancel** on the CRM's Payments page).

---

# Update: keypad, calendar booking, owner name, coaching switches

## Database
Copy `supabase/migrations/0007_keypad_calendar_owner.sql` from GitHub → Supabase **SQL Editor** →
**+ New query** → paste → **Run** (once; choose **Run without RLS** if asked).
No new keys or Vercel settings are needed. Vercel deploys the new code by itself.

Until this file is run, the keypad and calendar booking show an error, and the
coaching switches don't appear on the user pages.

---

# Update: Live (listen / whisper / barge)

## Database
Copy `supabase/migrations/0008_live_coaching.sql` from GitHub → Supabase **SQL Editor** →
**+ New query** → paste → **Run** (once; choose **Run without RLS** if asked).

## Test it (two people, two computers or two browsers)
1. Rep A signs in, opens the **Dialer**, and calls your own cell phone with the keypad. Answer it.
2. Check: you hear ringing before answering, the timer starts when you answer, and the call is clear.
3. You (admin) look at **Live** in the menu → click Rep A → **Listen**. You should hear both sides.
   Rep A should see nothing.
4. Click **Whisper** and talk: Rep A hears you; your cell phone doesn't.
5. Click **Barge**: everyone hears you. Click **Leave**.
6. Hang up from the cell phone: Rep A's call should end by itself and show the outcome screen.
7. Call a business with a phone menu ("press 1…") and try the keypad.
8. Next day: open that lead and play the recording.

If calls misbehave, go to **Dashboard → Phone system → Switch to direct calls**. That puts calls
back the old way at once (no listening) while it gets fixed.

---

# Update: private lead lists, Never reached, call history

## Database
Copy `supabase/migrations/0009_private_lists.sql` from GitHub → Supabase **SQL Editor** →
**+ New query** → paste → **Run** (once). If Supabase warns about "destructive operations" or
Row Level Security, choose **Run query** / **Run without RLS**: nothing is deleted.

Until this is run, the dialer's MY LIST and the Never reached page show an error; everything else
keeps working.
