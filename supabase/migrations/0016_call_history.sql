-- 0016: Call history + change a call's outcome.
-- Reps can pick (or change) the outcome of their own calls from the last 7 days; admins any call.
-- The change counts on the day of the call. Stats and the weekly board now use only each call's
-- LATEST outcome (the event log is permanent, so a change adds a new entry instead of editing).
-- Do Not Call and Sold outcomes can't be changed. Safe to run while reps are dialing.

create index if not exists events_disposition_call_idx on public.events (call_id, id) where type = 'disposition';

create or replace function public.change_call_outcome(
  p_call          uuid,
  p_disposition   public.call_disposition,
  p_note          text default null,
  p_appt_start    timestamptz default null,
  p_appt_minutes  integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid        uuid := private.require_active_user();
  admin      boolean := private.is_admin();
  s          public.settings;
  c          public.calls;
  lead       public.leads;
  old        public.call_disposition;
  latest     boolean := false;
  attempts   integer;
  new_status public.lead_status;
  new_owner  uuid;
  next_at    timestamptz;
  appt_id    uuid;
  label_old  text;
  label_new  text;
begin
  select * into s from public.settings where id = 1;
  select * into c from public.calls where id = p_call for update;
  if c.id is null then
    raise exception 'call_not_found';
  end if;
  -- Reps fix their own calls from the last 7 days; admins any call.
  if not admin then
    if c.rep_id <> uid then
      raise exception 'not_your_call';
    end if;
    if c.started_at < now() - interval '7 days' then
      raise exception 'call_too_old';
    end if;
  end if;
  if c.ended_at is null and c.started_at > now() - interval '30 minutes' then
    raise exception 'call_in_progress';
  end if;

  old := c.disposition;
  if old in ('do_not_call', 'sold') then
    raise exception 'outcome_locked';
  end if;
  if old = p_disposition then
    return jsonb_build_object('status', 'unchanged');
  end if;
  if c.lead_id is null and p_disposition not in ('no_answer', 'owner_unavailable', 'bad_number') then
    raise exception 'no_lead';
  end if;

  if c.lead_id is not null then
    select * into lead from public.leads where id = c.lead_id for update;
    -- Only the lead's most recent call may change the lead itself (an old call can't undo a newer one).
    latest := lead.id is not null
      and not exists (select 1 from public.calls x where x.lead_id = c.lead_id and x.started_at > c.started_at);
  end if;
  if p_disposition = 'appointment_set' then
    if not latest then
      raise exception 'lead_called_since';
    end if;
    if p_appt_start is null then
      raise exception 'appointment_time_required';
    end if;
    if p_appt_start < now() - interval '5 minutes' then
      raise exception 'appointment_in_past';
    end if;
  end if;

  update public.calls set disposition = p_disposition, disposition_at = now() where id = c.id;

  -- Booked on this call before, now something else: take that appointment off the calendar.
  if old = 'appointment_set' then
    update public.appointments set status = 'canceled', outcome_at = now()
     where call_id = c.id and status = 'scheduled';
  end if;

  if latest then
    attempts   := lead.attempt_count + case when old is null then 1 else 0 end;
    new_status := lead.status;
    new_owner  := lead.owner_id;
    next_at    := lead.next_call_at;
    case p_disposition
      when 'no_answer', 'owner_unavailable' then
        if lead.owner_id is null then
          if attempts >= s.max_attempts then
            new_status := 'exhausted';
          else
            new_status := 'no_answer';
            next_at := private.next_retry_at(greatest(attempts, 1), lead.timezone);
          end if;
        end if;
      when 'not_interested' then
        new_status := 'not_interested';
      when 'appointment_set' then
        new_status := 'appointment_set';
        new_owner := coalesce(lead.owner_id, c.rep_id);
        update public.appointments set status = 'rescheduled', outcome_at = now()
         where lead_id = lead.id and status = 'scheduled';
        insert into public.appointments (lead_id, rep_id, call_id, starts_at, ends_at, created_by)
        values (lead.id, new_owner, c.id, p_appt_start,
                p_appt_start + make_interval(mins => coalesce(p_appt_minutes, s.default_appointment_minutes)), uid)
        returning id into appt_id;
        perform private.log_event('appointment_set', new_owner, lead.id, c.id,
          jsonb_build_object('appointment_id', appt_id, 'starts_at', p_appt_start, 'set_by', uid, 'changed', true));
      when 'demo_completed' then
        new_status := 'demo_completed';
        new_owner := coalesce(lead.owner_id, c.rep_id);
      when 'sold' then
        new_status := 'sold';
        new_owner := coalesce(lead.owner_id, c.rep_id);
      when 'do_not_call' then
        new_status := 'do_not_call';
      when 'bad_number' then
        new_status := 'bad_number';
    end case;

    update public.leads
       set status = new_status,
           owner_id = new_owner,
           attempt_count = attempts,
           last_called_at = greatest(last_called_at, coalesce(c.ended_at, c.started_at)),
           next_call_at = next_at
     where id = lead.id;
    if new_owner is distinct from lead.owner_id then
      perform private.log_event('lead_owned', new_owner, lead.id, c.id, '{}'::jsonb);
    end if;
  end if;

  -- Do Not Call always sticks, even from an older call.
  if p_disposition = 'do_not_call' and c.to_number is not null then
    insert into public.dnc_numbers (phone_e164, reason, source, lead_id, added_by)
    values (c.to_number, 'Rep disposition', 'disposition', c.lead_id, uid)
    on conflict (phone_e164) do nothing;
    if lead.id is not null and not latest then
      update public.leads set status = 'do_not_call' where id = lead.id;
    end if;
  end if;

  if lead.id is not null then
    label_old := coalesce(initcap(replace(old::text, '_', ' ')), 'No outcome');
    label_new := initcap(replace(p_disposition::text, '_', ' '));
    insert into public.lead_notes (lead_id, author_id, body)
    values (lead.id, uid,
      'Outcome changed (call on ' || to_char(c.started_at at time zone 'America/New_York', 'Mon DD') || '): '
      || label_old || ' → ' || label_new
      || coalesce(E'\n' || nullif(trim(coalesce(p_note, '')), ''), ''));
  end if;

  -- Counted on the day of the call; the stats and weekly board use only each call's latest outcome.
  insert into public.events (occurred_at, type, rep_id, lead_id, call_id, data)
  values (coalesce(c.ended_at, c.started_at), 'disposition', c.rep_id, c.lead_id, c.id, jsonb_build_object(
    'disposition', p_disposition, 'changed', true, 'from', old, 'changed_by', uid, 'applied_to_lead', latest));

  return jsonb_build_object('status', coalesce(new_status::text, 'call_only'), 'appointment_id', appt_id);
end;
$$;

revoke all on function public.change_call_outcome(uuid, public.call_disposition, text, timestamptz, integer) from public, anon;
grant execute on function public.change_call_outcome(uuid, public.call_disposition, text, timestamptz, integer) to authenticated;

-- Stats: same as before, but an outcome that was later changed no longer counts.
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
             where p.type = 'disposition' and not exists (select 1 from public.events n where n.type = 'disposition' and n.call_id = p.call_id and n.id > p.id) and p.lead_id = e.lead_id
               and p.data ->> 'disposition' = 'appointment_set' and p.occurred_at < e.occurred_at
           ) as first_appt
    from public.events e
    where e.type = 'disposition' and not exists (select 1 from public.events n where n.type = 'disposition' and n.call_id = e.call_id and n.id > e.id) and e.rep_id in (select id from reps)
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
             where p.type = 'disposition' and not exists (select 1 from public.events n where n.type = 'disposition' and n.call_id = p.call_id and n.id > p.id) and p.lead_id = e.lead_id
               and p.data ->> 'disposition' = 'appointment_set' and p.occurred_at < e.occurred_at
           ) as first_appt
    from public.events e
    where e.type = 'disposition' and not exists (select 1 from public.events n where n.type = 'disposition' and n.call_id = e.call_id and n.id > e.id) and e.rep_id in (select id from ok)
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
