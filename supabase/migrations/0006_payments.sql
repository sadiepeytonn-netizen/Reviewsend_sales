-- ReviewSend Sales CRM — step 6: payments (Stripe) + commission
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- (0001–0005 must already have been run.) If Supabase warns about Row Level
-- Security, choose "Run without RLS": this file creates no tables.

-- ---------------------------------------------------------------------------
-- Sale details captured at the time of payment
-- ---------------------------------------------------------------------------
alter table public.sales
  add column if not exists business_name               text,
  add column if not exists contact_name                text,
  add column if not exists email                       text,
  add column if not exists phone                       text,
  add column if not exists notes                       text,
  add column if not exists payment_method              text,   -- card | link | manual
  add column if not exists stripe_checkout_session_id  text,
  add column if not exists checkout_url                text,
  add column if not exists last_error                  text;

create index if not exists sales_paid_idx on public.sales (first_paid_at);
create index if not exists sales_lead_idx on public.sales (lead_id);
create index if not exists commissions_created_idx on public.commissions (created_at);

-- Payment settings (editable later without code changes)
alter table public.settings
  add column if not exists onboarding_url   text not null default 'https://calendly.com/support-reviewsend/30min',
  add column if not exists setup_fee_max    numeric(10,2) not null default 599,
  add column if not exists monthly_min      numeric(10,2) not null default 199,
  add column if not exists monthly_max      numeric(10,2) not null default 699;

-- ---------------------------------------------------------------------------
-- Stats: "Sales" now counts PAID sales (first payment confirmed), credited
-- to the rep on the sale. Everything else is unchanged from 0005.
-- ---------------------------------------------------------------------------
create or replace function public.rep_stats(p_from timestamptz, p_to timestamptz)
returns table (
  rep_id                uuid,
  rep_name              text,
  dials                 bigint,
  contacts              bigint,
  answered_calls        bigint,
  talk_seconds          bigint,
  logged_in_seconds     bigint,
  on_call_seconds       bigint,
  ready_seconds         bigint,
  wrap_up_seconds       bigint,
  idle_seconds          bigint,
  paused_seconds        bigint,
  paused_lunch          bigint,
  paused_break          bigint,
  paused_meeting        bigint,
  paused_training       bigint,
  paused_other          bigint,
  avg_gap_seconds       bigint,
  appointments          bigint,
  demos                 bigint,
  showed                bigint,
  missed                bigint,
  pitched_no_sale       bigint,
  sales                 bigint,
  mrr                   numeric,
  first_month_commission numeric,
  residual_commission   numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with
  reps as (
    select p.id, coalesce(nullif(p.full_name, ''), p.email) as name
    from public.profiles p
    where private.can_see_rep(p.id)
      and (p.role = 'rep' or exists (select 1 from public.calls c where c.rep_id = p.id))
  ),

  -- Live-status timeline: each "status" event lasts until the next one.
  -- The last one is capped at the rep's last heartbeat (+2 min) so a closed
  -- laptop doesn't count as hours logged in.
  st as (
    select e.rep_id, e.data ->> 'status' as status, e.data ->> 'reason' as reason, e.occurred_at,
           lead(e.occurred_at) over (partition by e.rep_id order by e.occurred_at, e.id) as next_at
    from public.events e
    where e.type = 'status' and e.rep_id in (select id from reps)
      and e.occurred_at < p_to and e.occurred_at >= p_from - interval '2 days'
  ),
  iv as (
    select st.rep_id, st.status, st.reason,
           greatest(st.occurred_at, p_from) as s,
           least(coalesce(st.next_at, rp.last_heartbeat_at + interval '2 minutes', now()), p_to, now()) as t
    from st left join public.rep_presence rp on rp.rep_id = st.rep_id
  ),
  time_in as (
    select iv.rep_id,
      sum(extract(epoch from (t - s))) filter (where status <> 'offline')        as logged_in,
      sum(extract(epoch from (t - s))) filter (where status = 'on_call')          as on_call,
      sum(extract(epoch from (t - s))) filter (where status = 'ready')            as ready,
      sum(extract(epoch from (t - s))) filter (where status = 'wrap_up')          as wrap_up,
      sum(extract(epoch from (t - s))) filter (where status = 'idle')             as idle,
      sum(extract(epoch from (t - s))) filter (where status = 'paused')           as paused,
      sum(extract(epoch from (t - s))) filter (where status = 'paused' and reason = 'lunch')    as p_lunch,
      sum(extract(epoch from (t - s))) filter (where status = 'paused' and reason = 'break')    as p_break,
      sum(extract(epoch from (t - s))) filter (where status = 'paused' and reason = 'meeting')  as p_meeting,
      sum(extract(epoch from (t - s))) filter (where status = 'paused' and reason = 'training') as p_training,
      sum(extract(epoch from (t - s))) filter (where status = 'paused' and reason = 'other')    as p_other
    from iv where t > s
    group by iv.rep_id
  ),

  calls_in as (
    select c.* from public.calls c
    where c.rep_id in (select id from reps) and c.started_at >= p_from and c.started_at < p_to
  ),
  call_stats as (
    select c.rep_id,
      count(*) as dials,
      count(*) filter (where c.disposition in ('not_interested', 'appointment_set', 'demo_completed', 'sold', 'do_not_call')) as contacts,
      count(*) filter (where coalesce(c.duration_seconds, 0) > 0) as answered,
      coalesce(sum(c.duration_seconds), 0) as talk
    from calls_in c group by c.rep_id
  ),
  -- Time from the end of one call to the start of the next (gaps over 30 min = a break, ignored)
  gaps as (
    select c.rep_id,
           extract(epoch from (c.started_at - lag(coalesce(c.ended_at, c.started_at)) over (partition by c.rep_id order by c.started_at))) as gap
    from calls_in c
  ),
  gap_stats as (
    select rep_id, avg(gap) as avg_gap from gaps where gap between 0 and 1800 group by rep_id
  ),

  dispo as (
    select e.rep_id, e.lead_id, e.data ->> 'disposition' as d
    from public.events e
    where e.type = 'disposition' and e.rep_id in (select id from reps)
      and e.occurred_at >= p_from and e.occurred_at < p_to
  ),
  appts_in as (
    select a.rep_id, a.lead_id, a.status from public.appointments a
    where a.rep_id in (select id from reps) and a.starts_at >= p_from and a.starts_at < p_to
  ),
  -- A "demo" = an appointment marked Showed, or a Demo completed outcome.
  demo_leads as (
    select rep_id, lead_id from appts_in where status = 'showed'
    union
    select rep_id, lead_id from dispo where d = 'demo_completed'
  ),
  sold_leads as (
    select distinct rep_id, lead_id from dispo where d = 'sold'
  ),
  paid_sales as (
    select s.rep_id, s.id from public.sales s
    where s.rep_id in (select id from reps) and s.first_paid_at >= p_from and s.first_paid_at < p_to
  ),
  funnel as (
    select r.id as rep_id,
      (select count(*) from dispo x where x.rep_id = r.id and x.d = 'appointment_set') as appointments,
      (select count(*) from demo_leads x where x.rep_id = r.id) as demos,
      (select count(*) from appts_in x where x.rep_id = r.id and x.status = 'showed') as showed,
      (select count(*) from appts_in x where x.rep_id = r.id and x.status = 'missed') as missed,
      (select count(*) from demo_leads x join public.leads l on l.id = x.lead_id
        where x.rep_id = r.id and l.status <> 'sold') as pitched_no_sale,
      (select count(*) from paid_sales x where x.rep_id = r.id) as sales
    from reps r
  ),

  money as (
    select r.id as rep_id,
      (select coalesce(sum(s.monthly_price), 0) from public.sales s
        where s.rep_id = r.id and s.first_paid_at >= p_from and s.first_paid_at < p_to) as mrr,
      (select coalesce(sum(c.amount), 0) from public.commissions c
        where c.rep_id = r.id and c.kind = 'first_month'
          and c.created_at >= p_from and c.created_at < p_to) as first_month,
      case when private.is_admin() then
        (select coalesce(sum(c.amount), 0) from public.commissions c
          where c.rep_id = r.id and c.kind = 'residual'
            and c.created_at >= p_from and c.created_at < p_to)
      end as residual
    from reps r
  )

  select r.id, r.name,
    coalesce(cs.dials, 0), coalesce(cs.contacts, 0), coalesce(cs.answered, 0), coalesce(cs.talk, 0)::bigint,
    coalesce(ti.logged_in, 0)::bigint, coalesce(ti.on_call, 0)::bigint, coalesce(ti.ready, 0)::bigint,
    coalesce(ti.wrap_up, 0)::bigint, coalesce(ti.idle, 0)::bigint, coalesce(ti.paused, 0)::bigint,
    coalesce(ti.p_lunch, 0)::bigint, coalesce(ti.p_break, 0)::bigint, coalesce(ti.p_meeting, 0)::bigint,
    coalesce(ti.p_training, 0)::bigint, coalesce(ti.p_other, 0)::bigint,
    gs.avg_gap::bigint,
    f.appointments, f.demos, f.showed, f.missed, f.pitched_no_sale, f.sales,
    m.mrr, m.first_month, m.residual
  from reps r
  left join call_stats cs on cs.rep_id = r.id
  left join time_in ti on ti.rep_id = r.id
  left join gap_stats gs on gs.rep_id = r.id
  left join funnel f on f.rep_id = r.id
  left join money m on m.rep_id = r.id
  order by r.name;
$$;

-- ---------------------------------------------------------------------------
-- Day-by-day counts (Eastern time) for trend charts. p_rep null = whole team
-- (whatever the caller is allowed to see).
-- ---------------------------------------------------------------------------
create or replace function public.daily_stats(p_from date, p_to date, p_rep uuid default null)
returns table (day date, dials bigint, contacts bigint, appointments bigint, demos bigint, sales bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  ok as (
    select p.id from public.profiles p
    where private.can_see_rep(p.id) and (p_rep is null or p.id = p_rep)
  ),
  c as (
    select (c.started_at at time zone 'America/New_York')::date as day, c.disposition
    from public.calls c
    where c.rep_id in (select id from ok)
      and c.started_at >= (p_from::timestamp at time zone 'America/New_York')
      and c.started_at < ((p_to + 1)::timestamp at time zone 'America/New_York')
  ),
  e as (
    select (e.occurred_at at time zone 'America/New_York')::date as day, e.data ->> 'disposition' as d, e.lead_id
    from public.events e
    where e.type = 'disposition' and e.rep_id in (select id from ok)
      and e.occurred_at >= (p_from::timestamp at time zone 'America/New_York')
      and e.occurred_at < ((p_to + 1)::timestamp at time zone 'America/New_York')
  ),
  a as (
    select (a.starts_at at time zone 'America/New_York')::date as day, a.lead_id
    from public.appointments a
    where a.status = 'showed' and a.rep_id in (select id from ok)
      and a.starts_at >= (p_from::timestamp at time zone 'America/New_York')
      and a.starts_at < ((p_to + 1)::timestamp at time zone 'America/New_York')
  )
  select days.day,
    (select count(*) from c where c.day = days.day),
    (select count(*) from c where c.day = days.day
       and c.disposition in ('not_interested', 'appointment_set', 'demo_completed', 'sold', 'do_not_call')),
    (select count(*) from e where e.day = days.day and e.d = 'appointment_set'),
    (select count(*) from (
       select lead_id from a where a.day = days.day
       union select lead_id from e where e.day = days.day and e.d = 'demo_completed') x),
    (select count(*) from public.sales s
      where s.rep_id in (select id from ok)
        and (s.first_paid_at at time zone 'America/New_York')::date = days.day)
  from days
  order by days.day;
$$;

