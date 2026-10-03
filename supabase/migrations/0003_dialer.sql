-- ReviewSend Sales CRM — step 3: dialer, dispositions, presence
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- (0001 and 0002 must already have been run.)
--
-- Every dialer action goes through one of the functions below. Each one
-- checks who is calling it (auth.uid()), does its work in a single
-- transaction, and writes to the permanent events log, so stats can't drift
-- and two reps can never end up with the same lead.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or private.my_role() is null then
    raise exception 'not_allowed' using hint = 'Not signed in, or account turned off.';
  end if;
  return uid;
end;
$$;

create or replace function private.log_event(
  p_type text, p_rep uuid, p_lead uuid default null, p_call uuid default null, p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.events (type, rep_id, lead_id, call_id, data)
  values (p_type, p_rep, p_lead, p_call, coalesce(p_data, '{}'::jsonb));
$$;

-- Is it within calling hours where the lead is?
create or replace function private.in_calling_hours(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tz is not null and exists (
    select 1 from public.settings s
    where extract(hour from (now() at time zone p_tz)) >= s.calling_start_hour
      and extract(hour from (now() at time zone p_tz)) <  s.calling_end_hour
  );
$$;

-- When a No Answer lead should come back:
--   attempts 1..retry_quick_attempts → retry_quick_hours later
--   after that → next business day in the lead's time zone,
--                alternating 10am / 2pm local
create or replace function private.next_retry_at(p_attempts integer, p_tz text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  s     public.settings;
  d     date;
begin
  select * into s from public.settings where id = 1;
  if p_attempts <= s.retry_quick_attempts then
    return now() + make_interval(hours => s.retry_quick_hours);
  end if;
  if p_tz is null then
    return now() + interval '1 day';
  end if;
  d := (now() at time zone p_tz)::date + 1;
  while extract(isodow from d) in (6, 7) loop
    d := d + 1;
  end loop;
  return (d + case when p_attempts % 2 = 1 then time '10:00' else time '14:00' end) at time zone p_tz;
end;
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Presence (live status) + sessions
-- ---------------------------------------------------------------------------

-- Called by every open CRM tab about once a minute. Starts a new "session"
-- (for time-logged-in stats) when the last heartbeat is more than 3 minutes
-- old, and keeps the rep's current lead claim alive.
create or replace function public.presence_heartbeat()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_active_user();
  p   public.rep_presence;
  ttl integer;
begin
  select claim_ttl_seconds into ttl from public.settings where id = 1;
  select * into p from public.rep_presence where rep_id = uid for update;

  if p.rep_id is null then
    insert into public.rep_presence (rep_id, status, status_since, last_heartbeat_at)
    values (uid, 'idle', now(), now());
    perform private.log_event('session_start', uid);
    perform private.log_event('status', uid, null, null, jsonb_build_object('status', 'idle'));
    return;
  end if;

  if p.status = 'offline' or p.last_heartbeat_at is null or p.last_heartbeat_at < now() - interval '3 minutes' then
    if p.status <> 'offline' and p.last_heartbeat_at is not null then
      -- The previous session ended silently (closed laptop, lost wifi).
      insert into public.events (occurred_at, type, rep_id, data)
      values (p.last_heartbeat_at, 'status', uid, jsonb_build_object('status', 'offline', 'from', p.status)),
             (p.last_heartbeat_at, 'session_end', uid, '{}'::jsonb);
    end if;
    update public.rep_presence
       set status = 'idle', pause_reason = null, status_since = now(), last_heartbeat_at = now(),
           current_lead_id = null, current_call_id = null
     where rep_id = uid;
    perform private.log_event('session_start', uid);
    perform private.log_event('status', uid, null, null, jsonb_build_object('status', 'idle'));
  else
    update public.rep_presence set last_heartbeat_at = now() where rep_id = uid;
  end if;

  update public.leads
     set claim_expires_at = now() + make_interval(secs => ttl)
   where claimed_by = uid;
end;
$$;

-- Change the rep's live status. Logs a "status" event only when it changes.
-- Going idle, paused, or offline gives back any lead they were holding.
create or replace function public.set_presence(
  p_status public.presence_status,
  p_reason public.pause_reason default null,
  p_list   public.lead_list default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_active_user();
  p   public.rep_presence;
begin
  if p_status = 'paused' and p_reason is null then
    raise exception 'pause_reason_required';
  end if;

  select * into p from public.rep_presence where rep_id = uid for update;
  if p.rep_id is null then
    insert into public.rep_presence (rep_id, status, last_heartbeat_at) values (uid, 'offline', now())
    returning * into p;
  end if;

  if p.status is distinct from p_status or p.pause_reason is distinct from p_reason then
    perform private.log_event('status', uid, p.current_lead_id, null, jsonb_build_object(
      'status', p_status, 'reason', p_reason, 'list', coalesce(p_list, p.list), 'from', p.status
    ));
    if p.status = 'offline' and p_status <> 'offline' then
      perform private.log_event('session_start', uid);
    elsif p_status = 'offline' and p.status <> 'offline' then
      perform private.log_event('session_end', uid);
    end if;
  end if;

  update public.rep_presence
     set status = p_status,
         pause_reason = case when p_status = 'paused' then p_reason end,
         list = coalesce(p_list, list),
         status_since = case when status is distinct from p_status or pause_reason is distinct from p_reason
                             then now() else status_since end,
         last_heartbeat_at = now(),
         current_lead_id = case when p_status in ('idle', 'paused', 'offline') then null else current_lead_id end,
         current_call_id = case when p_status in ('on_call') then current_call_id else null end
   where rep_id = uid;

  if p_status in ('idle', 'paused', 'offline') then
    update public.leads set claimed_by = null, claimed_at = null, claim_expires_at = null
     where claimed_by = uid;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claiming leads
-- ---------------------------------------------------------------------------

-- Hands the rep the next lead on a list, or returns null if none is ready.
-- "for update skip locked" means two reps asking at the same instant get
-- different leads. If the rep already holds a live claim (page refresh),
-- they get that same lead back.
create or replace function public.claim_next_lead(p_list public.lead_list)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_active_user();
  ttl  integer;
  lead public.leads;
begin
  select claim_ttl_seconds into ttl from public.settings where id = 1;

  select * into lead from public.leads
   where claimed_by = uid and claim_expires_at > now() and owner_id is null
     and status in ('new', 'no_answer')
   limit 1;

  if lead.id is null then
    -- Give back anything stale this rep still holds.
    update public.leads set claimed_by = null, claimed_at = null, claim_expires_at = null
     where claimed_by = uid;

    select l.* into lead
      from public.leads l
     where l.list = p_list
       and l.owner_id is null
       and l.status in ('new', 'no_answer')
       and l.next_call_at <= now()
       and l.phone_e164 is not null
       and (l.claimed_by is null or l.claim_expires_at < now())
       and not exists (select 1 from public.dnc_numbers d where d.phone_e164 = l.phone_e164)
       and private.in_calling_hours(l.timezone)
     order by l.next_call_at, l.created_at
     limit 1
     for update of l skip locked;

    if lead.id is null then
      update public.rep_presence set current_lead_id = null where rep_id = uid;
      return null;
    end if;

    update public.leads
       set claimed_by = uid, claimed_at = now(), claim_expires_at = now() + make_interval(secs => ttl)
     where id = lead.id
    returning * into lead;

    perform private.log_event('lead_claimed', uid, lead.id, null, jsonb_build_object('list', p_list));
  end if;

  update public.rep_presence set current_lead_id = lead.id, list = p_list where rep_id = uid;
  return to_jsonb(lead);
end;
$$;

create or replace function public.release_lead(p_lead uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_active_user();
begin
  update public.leads set claimed_by = null, claimed_at = null, claim_expires_at = null
   where id = p_lead and claimed_by = uid;
  update public.rep_presence set current_lead_id = null where rep_id = uid and current_lead_id = p_lead;
end;
$$;

-- ---------------------------------------------------------------------------
-- Starting a call: last checks before Twilio dials
-- ---------------------------------------------------------------------------
create or replace function public.start_call(p_lead uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := private.require_active_user();
  lead    public.leads;
  call_id uuid;
  ttl     integer;
begin
  select claim_ttl_seconds into ttl from public.settings where id = 1;
  select * into lead from public.leads where id = p_lead for update;

  if lead.id is null then
    raise exception 'lead_not_found';
  end if;
  -- (coalesce: a blank owner/claim must count as "not yours", never as unknown)
  if not coalesce((lead.claimed_by = uid and lead.claim_expires_at > now()) or lead.owner_id = uid or private.is_admin(), false) then
    raise exception 'not_your_lead';
  end if;
  if lead.phone_e164 is null then
    raise exception 'no_phone';
  end if;
  if lead.status = 'do_not_call' or exists (select 1 from public.dnc_numbers d where d.phone_e164 = lead.phone_e164) then
    raise exception 'do_not_call';
  end if;
  if not private.in_calling_hours(lead.timezone) then
    raise exception 'outside_calling_hours';
  end if;

  insert into public.calls (lead_id, rep_id, to_number)
  values (lead.id, uid, lead.phone_e164)
  returning id into call_id;

  if lead.claimed_by = uid then
    update public.leads set claim_expires_at = now() + make_interval(secs => ttl) where id = lead.id;
  end if;

  update public.rep_presence
     set status = 'on_call', status_since = now(), current_lead_id = lead.id, current_call_id = call_id,
         last_heartbeat_at = now()
   where rep_id = uid;
  perform private.log_event('status', uid, lead.id, call_id, jsonb_build_object('status', 'on_call'));
  perform private.log_event('call_started', uid, lead.id, call_id, '{}'::jsonb);

  return jsonb_build_object('call_id', call_id, 'to', lead.phone_e164);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dispositions
-- ---------------------------------------------------------------------------
create or replace function public.dispose_lead(
  p_lead          uuid,
  p_disposition   public.call_disposition,
  p_call          uuid default null,
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
  s          public.settings;
  lead       public.leads;
  owned      boolean;
  attempts   integer;
  new_status public.lead_status;
  new_owner  uuid;
  next_at    timestamptz;
  appt_id    uuid;
begin
  select * into s from public.settings where id = 1;
  select * into lead from public.leads where id = p_lead for update;

  if lead.id is null then
    raise exception 'lead_not_found';
  end if;
  owned := coalesce(lead.owner_id = uid, false);
  if not coalesce(lead.claimed_by = uid or owned or private.is_admin(), false) then
    raise exception 'not_your_lead';
  end if;

  if p_call is not null then
    update public.calls set disposition = p_disposition, disposition_at = now()
     where id = p_call and rep_id = uid and lead_id = p_lead;
    if not found then
      raise exception 'call_not_found';
    end if;
  end if;

  attempts   := lead.attempt_count + 1;
  new_status := lead.status;
  new_owner  := lead.owner_id;
  next_at    := lead.next_call_at;

  case p_disposition
    when 'no_answer' then
      -- A rep's own lead (appointment / sale) stays theirs; only pool leads cycle.
      if lead.owner_id is null then
        if attempts >= s.max_attempts then
          new_status := 'exhausted';
        else
          new_status := 'no_answer';
          next_at := private.next_retry_at(attempts, lead.timezone);
        end if;
      end if;
    when 'not_interested' then
      new_status := 'not_interested';
    when 'appointment_set' then
      if p_appt_start is null then
        raise exception 'appointment_time_required';
      end if;
      if p_appt_start < now() - interval '5 minutes' then
        raise exception 'appointment_in_past';
      end if;
      new_status := 'appointment_set';
      new_owner := coalesce(lead.owner_id, uid);
      -- Booking again replaces any appointment still on the calendar.
      update public.appointments set status = 'rescheduled', outcome_at = now()
       where lead_id = lead.id and status = 'scheduled';
      insert into public.appointments (lead_id, rep_id, call_id, starts_at, ends_at, created_by)
      values (lead.id, new_owner, p_call, p_appt_start,
              p_appt_start + make_interval(mins => coalesce(p_appt_minutes, s.default_appointment_minutes)), uid)
      returning id into appt_id;
      perform private.log_event('appointment_set', new_owner, lead.id, p_call,
        jsonb_build_object('appointment_id', appt_id, 'starts_at', p_appt_start, 'set_by', uid));
    when 'demo_completed' then
      new_status := 'demo_completed';
      new_owner := coalesce(lead.owner_id, uid);
    when 'sold' then
      new_status := 'sold';
      new_owner := coalesce(lead.owner_id, uid);
    when 'do_not_call' then
      new_status := 'do_not_call';
      if lead.phone_e164 is not null then
        insert into public.dnc_numbers (phone_e164, reason, source, lead_id, added_by)
        values (lead.phone_e164, 'Rep disposition', 'disposition', lead.id, uid)
        on conflict (phone_e164) do nothing;
      end if;
    when 'bad_number' then
      new_status := 'bad_number';
  end case;

  update public.leads
     set status = new_status,
         owner_id = new_owner,
         attempt_count = attempts,
         last_called_at = now(),
         next_call_at = next_at,
         claimed_by = null, claimed_at = null, claim_expires_at = null
   where id = lead.id;

  if nullif(trim(coalesce(p_note, '')), '') is not null then
    insert into public.lead_notes (lead_id, author_id, body) values (lead.id, uid, trim(p_note));
  end if;

  perform private.log_event('disposition', uid, lead.id, p_call, jsonb_build_object(
    'disposition', p_disposition, 'attempt', attempts, 'from_status', lead.status, 'to_status', new_status,
    'owned', owned
  ));
  if new_owner is distinct from lead.owner_id then
    perform private.log_event('lead_owned', new_owner, lead.id, p_call, '{}'::jsonb);
  end if;

  update public.rep_presence set current_lead_id = null, current_call_id = null where rep_id = uid;

  return jsonb_build_object('status', new_status, 'next_call_at', next_at, 'appointment_id', appt_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: send exhausted leads back to the pool
-- ---------------------------------------------------------------------------
create or replace function public.recycle_exhausted_leads(p_list public.lead_list default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_active_user();
  n   integer;
begin
  if not private.is_admin() then
    raise exception 'not_allowed';
  end if;
  update public.leads
     set status = 'no_answer', attempt_count = 0, next_call_at = now()
   where status = 'exhausted' and owner_id is null and (p_list is null or list = p_list);
  get diagnostics n = row_count;
  perform private.log_event('leads_recycled', uid, null, null, jsonb_build_object('count', n, 'list', p_list));
  return n;
end;
$$;

-- Who may call these: signed-in users only (each function checks further).
revoke all on function public.presence_heartbeat() from public, anon;
revoke all on function public.set_presence(public.presence_status, public.pause_reason, public.lead_list) from public, anon;
revoke all on function public.claim_next_lead(public.lead_list) from public, anon;
revoke all on function public.release_lead(uuid) from public, anon;
revoke all on function public.start_call(uuid) from public, anon;
revoke all on function public.dispose_lead(uuid, public.call_disposition, uuid, text, timestamptz, integer) from public, anon;
revoke all on function public.recycle_exhausted_leads(public.lead_list) from public, anon;
grant execute on function public.presence_heartbeat() to authenticated;
grant execute on function public.set_presence(public.presence_status, public.pause_reason, public.lead_list) to authenticated;
grant execute on function public.claim_next_lead(public.lead_list) to authenticated;
grant execute on function public.release_lead(uuid) to authenticated;
grant execute on function public.start_call(uuid) to authenticated;
grant execute on function public.dispose_lead(uuid, public.call_disposition, uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.recycle_exhausted_leads(public.lead_list) to authenticated;

-- Twilio looks calls up by its own ID
create index if not exists calls_twilio_sid_idx on public.calls (twilio_call_sid);
