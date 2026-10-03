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
