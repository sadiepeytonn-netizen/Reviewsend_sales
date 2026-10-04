-- ReviewSend Sales CRM — keypad dialing, booking from the calendar, owner name,
-- coaching permissions, and appointment counting.
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- (0001–0006 must already have been run.) If Supabase warns about Row Level
-- Security, choose "Run without RLS": this file creates no tables.

-- Keypad (manual) calls are tagged so stats can show them separately.
alter table public.calls add column if not exists manual boolean not null default false;

-- Per-rep coaching permissions (set by the admin on each rep's page).
alter table public.profiles
  add column if not exists can_listen  boolean not null default true,
  add column if not exists can_whisper boolean not null default false,
  add column if not exists can_barge   boolean not null default false;

-- ---------------------------------------------------------------------------
-- Keypad: what is this number?
--   dnc        → on Do Not Call (blocked)
--   other_rep  → belongs to another rep's client (blocked)
--   busy       → another rep has this lead on their dialer right now (blocked)
--   lead       → a lead the caller may call; pool leads get claimed for them
--   new        → not in the CRM
-- ---------------------------------------------------------------------------
create or replace function public.lookup_number(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_active_user();
  ttl  integer;
  lead public.leads;
  got  uuid;
begin
  if exists (select 1 from public.dnc_numbers where phone_e164 = p_phone) then
    return jsonb_build_object('status', 'dnc');
  end if;

  select * into lead from public.leads where phone_e164 = p_phone;
  if lead.id is null then
    return jsonb_build_object('status', 'new');
  end if;

  if lead.owner_id is not null then
    if lead.owner_id = uid or private.is_admin() then
      return jsonb_build_object('status', 'lead', 'lead_id', lead.id);
    end if;
    return jsonb_build_object('status', 'other_rep');
  end if;

  select claim_ttl_seconds into ttl from public.settings where id = 1;
  update public.leads
     set claimed_by = uid, claimed_at = now(), claim_expires_at = now() + make_interval(secs => ttl)
   where id = lead.id
     and (claimed_by is null or claimed_by = uid or claim_expires_at < now())
  returning id into got;
  if got is null then
    return jsonb_build_object('status', 'busy');
  end if;
  return jsonb_build_object('status', 'lead', 'lead_id', lead.id);
end;
$$;

-- Keypad call: same checks as the dialer except calling hours (none for keypad dials).
create or replace function public.start_manual_call(p_phone text, p_lead uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := private.require_active_user();
  lead    public.leads;
  call_id uuid;
begin
  if exists (select 1 from public.dnc_numbers where phone_e164 = p_phone) then
    raise exception 'do_not_call';
  end if;
  if p_lead is not null then
    select * into lead from public.leads where id = p_lead;
    if lead.id is null then
      raise exception 'lead_not_found';
    end if;
    if not coalesce(lead.claimed_by = uid or lead.owner_id = uid or private.is_admin(), false) then
      raise exception 'not_your_lead';
    end if;
  end if;

  insert into public.calls (lead_id, rep_id, to_number, manual)
  values (p_lead, uid, p_phone, true)
  returning id into call_id;

  update public.rep_presence
     set status = 'on_call', status_since = now(), current_lead_id = p_lead, current_call_id = call_id,
         last_heartbeat_at = now()
   where rep_id = uid;
  perform private.log_event('status', uid, p_lead, call_id, jsonb_build_object('status', 'on_call'));
  perform private.log_event('call_started', uid, p_lead, call_id, jsonb_build_object('manual', true));
  return jsonb_build_object('call_id', call_id);
end;
$$;

-- Find a lead by phone, or create it (keypad "save as new lead", calendar "new client").
-- Never creates a duplicate; never hands over another rep's client.
create or replace function public.find_or_create_lead(
  p_phone    text,
  p_business text,
  p_owner    text,
  p_email    text,
  p_city     text,
  p_state    text,
  p_timezone text,
  p_list     public.lead_list,
  p_for_rep  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_active_user();
  rep  uuid := coalesce(p_for_rep, uid);
  lead public.leads;
  id_  uuid;
begin
  if rep <> uid and not private.is_admin() then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from public.dnc_numbers where phone_e164 = p_phone) then
    raise exception 'do_not_call';
  end if;

  select * into lead from public.leads where phone_e164 = p_phone;
  if lead.id is not null then
    if lead.owner_id is not null and lead.owner_id <> rep and not private.is_admin() then
      raise exception 'other_rep';
    end if;
    -- Fill in anything that was blank (same rule as imports).
    update public.leads set
      contact_name = coalesce(nullif(contact_name, ''), nullif(trim(p_owner), '')),
      email        = coalesce(nullif(email, ''), nullif(lower(trim(p_email)), '')),
      claimed_by   = case when owner_id is null then uid else claimed_by end,
      claimed_at   = case when owner_id is null then now() else claimed_at end,
      claim_expires_at = case when owner_id is null then now() + interval '10 minutes' else claim_expires_at end
    where id = lead.id;
    return lead.id;
  end if;

  if nullif(trim(p_business), '') is null then
    raise exception 'business_name_required';
  end if;
  insert into public.leads (business_name, contact_name, phone_raw, phone_e164, email, city, state, timezone, list,
                            lead_source, claimed_by, claimed_at, claim_expires_at)
  values (trim(p_business), nullif(trim(p_owner), ''), p_phone, p_phone, nullif(lower(trim(p_email)), ''),
          nullif(trim(p_city), ''), nullif(p_state, ''), nullif(p_timezone, ''), p_list,
          'Manual', uid, now(), now() + interval '10 minutes')
  returning id into id_;
  perform private.log_event('lead_created', uid, id_, null, jsonb_build_object('source', 'manual'));
  return id_;
end;
$$;

-- Attach a keypad call to the lead it turned out to be.
create or replace function public.link_call_to_lead(p_call uuid, p_lead uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_active_user();
begin
  update public.calls set lead_id = p_lead
   where id = p_call and rep_id = uid and lead_id is null;
  if not found then
    raise exception 'call_not_found';
  end if;
end;
$$;

-- Keypad call to an unknown number that reached nobody: record the outcome
-- without creating a lead (only No answer / Bad number are allowed here).
create or replace function public.close_manual_call(p_call uuid, p_disposition public.call_disposition)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_active_user();
begin
  if p_disposition not in ('no_answer', 'bad_number') then
    raise exception 'save_lead_first';
  end if;
  update public.calls set disposition = p_disposition, disposition_at = now()
   where id = p_call and rep_id = uid and lead_id is null and manual;
  if not found then
    raise exception 'call_not_found';
  end if;
  perform private.log_event('disposition', uid, null, p_call, jsonb_build_object(
    'disposition', p_disposition, 'manual', true));
  update public.rep_presence set current_lead_id = null, current_call_id = null where rep_id = uid;
end;
$$;

-- Book an appointment straight from the calendar. These do NOT count as
-- "appointments set" in stats (only dialer outcomes do).
create or replace function public.create_appointment_manual(
  p_lead    uuid,
  p_rep     uuid,
  p_start   timestamptz,
  p_minutes integer default 30
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_active_user();
  lead public.leads;
  appt uuid;
begin
  if p_rep <> uid and not private.is_admin() then
    raise exception 'not_allowed';
  end if;
  select * into lead from public.leads where id = p_lead for update;
  if lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if lead.owner_id is not null and lead.owner_id <> p_rep and not private.is_admin() then
    raise exception 'other_rep';
  end if;
  if lead.status = 'do_not_call' then
    raise exception 'do_not_call';
  end if;

  update public.leads
     set owner_id = coalesce(owner_id, p_rep),
         status = case when status in ('sold', 'demo_completed') then status else 'appointment_set' end,
         claimed_by = null, claimed_at = null, claim_expires_at = null
   where id = lead.id;

  insert into public.appointments (lead_id, rep_id, starts_at, ends_at, created_by)
  values (lead.id, p_rep, p_start, p_start + make_interval(mins => coalesce(p_minutes, 30)), uid)
  returning id into appt;

  perform private.log_event('appointment_created', p_rep, lead.id, null, jsonb_build_object(
    'appointment_id', appt, 'starts_at', p_start, 'manual', true, 'by', uid));
  return appt;
end;
$$;

-- Fill in / fix the business owner's name (reps Google the number before calling).
create or replace function public.set_owner_name(p_lead uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_active_user();
  lead public.leads;
begin
  select * into lead from public.leads where id = p_lead;
  if lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if not coalesce(lead.claimed_by = uid or lead.owner_id = uid or private.is_admin(), false) then
    raise exception 'not_your_lead';
  end if;
  update public.leads set contact_name = nullif(trim(p_name), '') where id = p_lead;
end;
$$;

revoke all on function public.lookup_number(text) from public, anon;
revoke all on function public.start_manual_call(text, uuid) from public, anon;
revoke all on function public.find_or_create_lead(text, text, text, text, text, text, text, public.lead_list, uuid) from public, anon;
revoke all on function public.link_call_to_lead(uuid, uuid) from public, anon;
revoke all on function public.close_manual_call(uuid, public.call_disposition) from public, anon;
revoke all on function public.create_appointment_manual(uuid, uuid, timestamptz, integer) from public, anon;
revoke all on function public.set_owner_name(uuid, text) from public, anon;
grant execute on function public.lookup_number(text) to authenticated;
grant execute on function public.start_manual_call(text, uuid) to authenticated;
grant execute on function public.find_or_create_lead(text, text, text, text, text, text, text, public.lead_list, uuid) to authenticated;
grant execute on function public.link_call_to_lead(uuid, uuid) to authenticated;
grant execute on function public.close_manual_call(uuid, public.call_disposition) to authenticated;
grant execute on function public.create_appointment_manual(uuid, uuid, timestamptz, integer) to authenticated;
grant execute on function public.set_owner_name(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Stats: "Appointments set" now counts only a lead's FIRST Appointment set
-- outcome (re-booking after a missed demo doesn't count twice), and keypad
-- calls get their own "manual dials" column (still included in total dials).
-- ---------------------------------------------------------------------------
drop function if exists public.rep_stats(timestamptz, timestamptz);

create or replace function public.rep_stats(p_from timestamptz, p_to timestamptz)
returns table (
  rep_id                uuid,
  rep_name              text,
  dials                 bigint,
  manual_dials          bigint,
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
      count(*) filter (where c.manual) as manual_dials,
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
    select e.rep_id, e.lead_id, e.data ->> 'disposition' as d,
           not exists (
             select 1 from public.events p
             where p.type = 'disposition' and p.lead_id = e.lead_id
               and p.data ->> 'disposition' = 'appointment_set' and p.occurred_at < e.occurred_at
           ) as first_appt
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
      (select count(*) from dispo x where x.rep_id = r.id and x.d = 'appointment_set' and x.first_appt) as appointments,
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
    coalesce(cs.dials, 0), coalesce(cs.manual_dials, 0), coalesce(cs.contacts, 0), coalesce(cs.answered, 0), coalesce(cs.talk, 0)::bigint,
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
    select (e.occurred_at at time zone 'America/New_York')::date as day, e.data ->> 'disposition' as d, e.lead_id,
           not exists (
             select 1 from public.events p
             where p.type = 'disposition' and p.lead_id = e.lead_id
               and p.data ->> 'disposition' = 'appointment_set' and p.occurred_at < e.occurred_at
           ) as first_appt
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
    (select count(*) from e where e.day = days.day and e.d = 'appointment_set' and e.first_appt),
    (select count(*) from (
       select lead_id from a where a.day = days.day
       union select lead_id from e where e.day = days.day and e.d = 'demo_completed') x),
    (select count(*) from public.sales s
      where s.rep_id in (select id from ok)
        and (s.first_paid_at at time zone 'America/New_York')::date = days.day)
  from days
  order by days.day;
$$;


revoke all on function public.rep_stats(timestamptz, timestamptz) from public, anon;
revoke all on function public.daily_stats(date, date, uuid) from public, anon;
grant execute on function public.rep_stats(timestamptz, timestamptz) to authenticated;
grant execute on function public.daily_stats(date, date, uuid) to authenticated;
