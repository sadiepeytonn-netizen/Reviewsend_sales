-- ReviewSend Sales CRM — initial database schema
--
-- Run this ONCE in a brand-new Supabase project:
--   Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- It creates every table the CRM needs (later build steps add functions on
-- top of these tables), plus the row-level security rules that decide who can
-- see what.

-- ---------------------------------------------------------------------------
-- Private schema for helper functions. It is not exposed through the
-- Supabase API, so nobody can call these helpers directly from a browser.
-- ---------------------------------------------------------------------------
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'manager', 'rep');

create type public.lead_list as enum ('EAST', 'WEST');

create type public.lead_status as enum (
  'new',              -- never called
  'no_answer',        -- waiting for a retry
  'not_interested',
  'appointment_set',  -- owned by the rep who booked it
  'demo_completed',
  'sold',
  'do_not_call',
  'bad_number',
  'exhausted'         -- too many no-answers; admin can recycle
);

create type public.call_disposition as enum (
  'no_answer',
  'not_interested',
  'appointment_set',
  'demo_completed',
  'sold',
  'do_not_call',
  'bad_number'
);

create type public.appointment_status as enum (
  'scheduled', 'showed', 'missed', 'canceled', 'rescheduled'
);

create type public.presence_status as enum (
  'offline',      -- not logged in / tab closed
  'idle',         -- logged in, not dialing
  'ready',        -- dialing session on, between calls
  'on_call',
  'wrap_up',      -- call ended, choosing a disposition
  'paused'
);

create type public.pause_reason as enum ('lunch', 'break', 'meeting', 'training', 'other');

create type public.residual_kind as enum ('none', 'flat', 'percent');

create type public.sale_status as enum (
  'pending',    -- payment link / invoice sent, not paid yet
  'active',     -- paying client
  'past_due',
  'canceled'
);

create type public.sale_source as enum ('stripe', 'manual');

create type public.commission_kind as enum ('first_month', 'residual');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Shared trigger: block edits/deletes on permanent tables
create or replace function private.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are permanent (% is not allowed)', tg_table_name, tg_op;
end;
$$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  manager_id  uuid,  -- FK added after profiles exists
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text not null,
  full_name             text not null default '',
  role                  public.user_role not null default 'rep',
  team_id               uuid references public.teams (id) on delete set null,
  active                boolean not null default false,
  must_change_password  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.teams
  add constraint teams_manager_id_fkey
  foreign key (manager_id) references public.profiles (id) on delete set null;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Private per-rep token for the subscribe-able calendar feed (step 4).
-- Kept out of profiles so coworkers can't see each other's token.
create table public.calendar_feeds (
  rep_id      uuid primary key references public.profiles (id) on delete cascade,
  token       uuid not null unique default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

-- When someone is added in Supabase Auth, create their profile.
-- The very first user ever becomes the active admin. Everyone after that
-- starts as an inactive rep; the CRM's "Add user" screen turns them on.
-- So a stranger who somehow signs up on their own gets no access.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when is_first then 'admin'::public.user_role else 'rep'::public.user_role end,
    is_first
  );

  insert into public.calendar_feeds (rep_id) values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Access helpers used by the row-level security rules
-- ---------------------------------------------------------------------------
create or replace function private.my_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and active;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.my_role() = 'admin', false);
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.my_role() is not null;
$$;

-- True when the current user may see data belonging to `rep`:
-- the rep themself, an admin, or (later) that rep's team manager.
create or replace function private.can_see_rep(rep uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.my_role()
    when 'admin' then true
    when 'manager' then rep = (select auth.uid()) or exists (
      select 1
      from public.profiles p
      join public.teams t on t.id = p.team_id
      where p.id = rep and t.manager_id = (select auth.uid())
    )
    when 'rep' then rep = (select auth.uid())
    else false
  end;
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Commission plans (one row per change; the newest effective row wins)
-- ---------------------------------------------------------------------------
create table public.commission_plans (
  id                              uuid primary key default gen_random_uuid(),
  rep_id                          uuid not null references public.profiles (id) on delete cascade,
  effective_from                  timestamptz not null default now(),
  first_month_pct_with_setup      numeric(5,2) not null check (first_month_pct_with_setup between 0 and 100),
  first_month_pct_without_setup   numeric(5,2) not null check (first_month_pct_without_setup between 0 and 100),
  residual_kind                   public.residual_kind not null default 'none',
  residual_value                  numeric(10,2) not null default 0 check (residual_value >= 0),
  small_deal_max_monthly          numeric(10,2) not null default 199,
  small_deal_first_month_pct      numeric(5,2) not null check (small_deal_first_month_pct between 0 and 100),
  small_deal_gets_residual        boolean not null default false,
  created_by                      uuid references public.profiles (id) on delete set null,
  created_at                      timestamptz not null default now()
);
create index commission_plans_rep_idx on public.commission_plans (rep_id, effective_from desc);

-- ---------------------------------------------------------------------------
-- App settings (exactly one row)
-- ---------------------------------------------------------------------------
create table public.settings (
  id                            integer primary key default 1 check (id = 1),
  calling_start_hour            integer not null default 8  check (calling_start_hour between 0 and 23),
  calling_end_hour              integer not null default 20 check (calling_end_hour between 1 and 24),
  claim_ttl_seconds             integer not null default 180,
  retry_quick_attempts          integer not null default 2,   -- attempts that retry after retry_quick_hours
  retry_quick_hours             integer not null default 4,
  max_attempts                  integer not null default 6,   -- after this many no-answers → exhausted
  default_appointment_minutes   integer not null default 30,
  recording_notice_text         text not null default 'This call may be recorded for quality purposes.',
  recording_retention_days      integer not null default 365,
  updated_at                    timestamptz not null default now()
);
insert into public.settings (id) values (1);

create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  file_name        text not null,
  lead_source      text not null,
  uploaded_by      uuid references public.profiles (id) on delete set null,
  total_rows       integer not null default 0,
  inserted_count   integer not null default 0,
  merged_count     integer not null default 0,
  dnc_count        integer not null default 0,
  invalid_count    integer not null default 0,
  created_at       timestamptz not null default now()
);

create table public.leads (
  id                  uuid primary key default gen_random_uuid(),
  business_name       text not null,
  contact_name        text,
  phone_raw           text,
  phone_e164          text,            -- normalized, e.g. +13055551234
  email               text,
  website             text,
  address             text,
  city                text,
  state               text,            -- 2-letter code
  category            text,
  google_rating       numeric(2,1) check (google_rating between 0 and 5),
  review_count        integer check (review_count >= 0),
  google_profile_url  text,
  lead_source         text,
  import_notes        text,            -- the "notes" column from the CSV
  timezone            text,            -- IANA name, e.g. America/New_York
  list                public.lead_list,
  status              public.lead_status not null default 'new',
  attempt_count       integer not null default 0,
  last_called_at      timestamptz,
  next_call_at        timestamptz not null default now(),
  owner_id            uuid references public.profiles (id) on delete set null,
  claimed_by          uuid references public.profiles (id) on delete set null,
  claimed_at          timestamptz,
  claim_expires_at    timestamptz,
  import_batch_id     uuid references public.import_batches (id) on delete set null,
  name_city_key       text generated always as (
    lower(regexp_replace(business_name, '[^a-zA-Z0-9]', '', 'g'))
    || '|' ||
    lower(regexp_replace(coalesce(city, ''), '[^a-zA-Z0-9]', '', 'g'))
  ) stored,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index leads_phone_unique on public.leads (phone_e164) where phone_e164 is not null;
create unique index leads_name_city_unique on public.leads (name_city_key)
  where city is not null and city <> '';
-- The dialer's "give me the next lead" lookup
create index leads_dial_queue_idx on public.leads (list, next_call_at)
  where owner_id is null and status in ('new', 'no_answer');
create index leads_owner_idx on public.leads (owner_id) where owner_id is not null;
create index leads_claimed_idx on public.leads (claimed_by) where claimed_by is not null;
create index leads_source_idx on public.leads (lead_source);

create trigger leads_touch before update on public.leads
  for each row execute function private.touch_updated_at();

create table public.lead_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now()
);
create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

-- Do Not Call: permanent. Updates and deletes are blocked for everyone,
-- including the admin and server code.
create table public.dnc_numbers (
  phone_e164  text primary key,
  reason      text,
  source      text not null default 'disposition',  -- disposition | import | manual
  lead_id     uuid,   -- plain ids (no foreign keys) so nothing can ever
  added_by    uuid,   -- cascade into a change on this permanent table
  created_at  timestamptz not null default now()
);
create trigger dnc_no_update before update or delete on public.dnc_numbers
  for each row execute function private.forbid_change();
create trigger dnc_no_truncate before truncate on public.dnc_numbers
  for each statement execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------
create table public.calls (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid references public.leads (id) on delete set null,
  rep_id               uuid not null references public.profiles (id),
  twilio_call_sid      text unique,
  from_number          text,
  to_number            text not null,
  started_at           timestamptz not null default now(),
  answered_at          timestamptz,
  ended_at             timestamptz,
  duration_seconds     integer,      -- from Twilio
  twilio_status        text,
  disposition          public.call_disposition,
  disposition_at       timestamptz,
  recording_sid        text,
  recording_duration   integer,
  recording_deleted_at timestamptz,
  created_at           timestamptz not null default now()
);
create index calls_rep_time_idx on public.calls (rep_id, started_at desc);
create index calls_lead_idx on public.calls (lead_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads (id) on delete cascade,
  rep_id       uuid not null references public.profiles (id),
  call_id      uuid references public.calls (id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       public.appointment_status not null default 'scheduled',
  outcome_at   timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appointments_rep_time_idx on public.appointments (rep_id, starts_at);
create index appointments_lead_idx on public.appointments (lead_id);

create trigger appointments_touch before update on public.appointments
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Sales and commission
-- ---------------------------------------------------------------------------
create table public.sales (
  id                      uuid primary key default gen_random_uuid(),
  lead_id                 uuid references public.leads (id) on delete set null,
  rep_id                  uuid not null references public.profiles (id),
  setup_fee               numeric(10,2) not null default 0 check (setup_fee >= 0),
  monthly_price           numeric(10,2) not null check (monthly_price >= 0),
  source                  public.sale_source not null,
  status                  public.sale_status not null default 'pending',
  plan_snapshot           jsonb not null,     -- rep's commission plan at the time of sale
  stripe_customer_id      text,
  stripe_subscription_id  text unique,
  first_paid_at           timestamptz,        -- the moment the sale "counts"
  canceled_at             timestamptz,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index sales_rep_idx on public.sales (rep_id, first_paid_at desc);

create trigger sales_touch before update on public.sales
  for each row execute function private.touch_updated_at();

create table public.commissions (
  id                 uuid primary key default gen_random_uuid(),
  sale_id            uuid not null references public.sales (id) on delete cascade,
  rep_id             uuid not null references public.profiles (id),
  kind               public.commission_kind not null,
  period_start       date not null,
  base_amount        numeric(10,2) not null,
  amount             numeric(10,2) not null,
  explanation        text not null,
  stripe_invoice_id  text unique,     -- one commission per paid invoice
  paid_out_at        timestamptz,
  created_at         timestamptz not null default now()
);
create index commissions_rep_idx on public.commissions (rep_id, period_start desc);
create unique index commissions_one_first_month on public.commissions (sale_id)
  where kind = 'first_month';

-- ---------------------------------------------------------------------------
-- Live presence + event log (the source of truth for every stat)
-- ---------------------------------------------------------------------------
create table public.rep_presence (
  rep_id             uuid primary key references public.profiles (id) on delete cascade,
  status             public.presence_status not null default 'offline',
  pause_reason       public.pause_reason,
  list               public.lead_list,
  current_lead_id    uuid references public.leads (id) on delete set null,
  current_call_id    uuid references public.calls (id) on delete set null,
  status_since       timestamptz not null default now(),
  last_heartbeat_at  timestamptz
);

create table public.events (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  type         text not null,   -- e.g. login, logout, dial_start, pause, call_answered, disposition, ...
  rep_id       uuid,   -- plain ids (no foreign keys): the log is permanent
  lead_id      uuid,   -- and must never be changed by a cascade
  call_id      uuid,
  data         jsonb not null default '{}'::jsonb
);
create index events_rep_time_idx on public.events (rep_id, occurred_at);
create index events_type_time_idx on public.events (type, occurred_at);

create trigger events_no_update before update or delete on public.events
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Rule of thumb: browsers can READ what they're allowed to see. Almost all
-- WRITES go through server code (which double-checks permissions) or through
-- database functions added in later steps, so stats can't be faked.
-- ---------------------------------------------------------------------------
alter table public.teams             enable row level security;
alter table public.profiles          enable row level security;
alter table public.calendar_feeds    enable row level security;
alter table public.commission_plans  enable row level security;
alter table public.settings          enable row level security;
alter table public.import_batches    enable row level security;
alter table public.leads             enable row level security;
alter table public.lead_notes        enable row level security;
alter table public.dnc_numbers       enable row level security;
alter table public.calls             enable row level security;
alter table public.appointments      enable row level security;
alter table public.sales             enable row level security;
alter table public.commissions       enable row level security;
alter table public.rep_presence      enable row level security;
alter table public.events            enable row level security;

-- Teams
create policy "teams: active users read" on public.teams
  for select to authenticated using (private.is_active_user());
create policy "teams: admin writes" on public.teams
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Profiles: coworkers' names are visible (notes show who wrote them).
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: active users read all" on public.profiles
  for select to authenticated using (private.is_active_user());
create policy "profiles: admin updates" on public.profiles
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- Calendar feed tokens: only your own
create policy "calendar_feeds: read own" on public.calendar_feeds
  for select to authenticated using (rep_id = (select auth.uid()) and private.is_active_user());

-- Commission plans: admin only (reps never see residual terms)
create policy "commission_plans: admin all" on public.commission_plans
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Settings: everyone reads, admin edits
create policy "settings: active users read" on public.settings
  for select to authenticated using (private.is_active_user());
create policy "settings: admin updates" on public.settings
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- Imports: admin only
create policy "import_batches: admin all" on public.import_batches
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Leads: admin sees all; a rep sees leads they own or currently have claimed
create policy "leads: admin all" on public.leads
  for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "leads: rep reads own or claimed" on public.leads
  for select to authenticated using (
    private.is_active_user()
    and (private.can_see_rep(owner_id) or private.can_see_rep(claimed_by))
  );

-- Notes: visible with the lead; reps add notes as themselves
create policy "lead_notes: read with lead" on public.lead_notes
  for select to authenticated using (
    exists (select 1 from public.leads l where l.id = lead_id)
  );
create policy "lead_notes: write own" on public.lead_notes
  for insert to authenticated with check (
    author_id = (select auth.uid())
    and private.is_active_user()
    and exists (select 1 from public.leads l where l.id = lead_id)
  );

-- DNC: admin can read and add; reps add through the dialer (step 3)
create policy "dnc: admin read" on public.dnc_numbers
  for select to authenticated using (private.is_admin());
create policy "dnc: admin add" on public.dnc_numbers
  for insert to authenticated with check (private.is_admin());

-- Calls: your own (admin sees all). Writes come from server code.
create policy "calls: read visible" on public.calls
  for select to authenticated using (private.can_see_rep(rep_id));

-- Appointments: your own calendar; admin sees everyone's
create policy "appointments: read visible" on public.appointments
  for select to authenticated using (private.can_see_rep(rep_id));
create policy "appointments: admin all" on public.appointments
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Sales: your own
create policy "sales: read visible" on public.sales
  for select to authenticated using (private.can_see_rep(rep_id));

-- Commissions: reps see only their own FIRST-MONTH rows; residuals are admin-only
create policy "commissions: admin all" on public.commissions
  for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "commissions: rep reads own first month" on public.commissions
  for select to authenticated using (
    rep_id = (select auth.uid()) and kind = 'first_month' and private.is_active_user()
  );

-- Presence: everyone on the floor can see who's on a call (leaderboard / floor view)
create policy "rep_presence: active users read" on public.rep_presence
  for select to authenticated using (private.is_active_user());

-- Events: your own; admin all. Written only by server code.
create policy "events: read visible" on public.events
  for select to authenticated using (private.can_see_rep(rep_id));

-- Live updates for the floor view and calendar
alter publication supabase_realtime add table public.rep_presence;
alter publication supabase_realtime add table public.appointments;
