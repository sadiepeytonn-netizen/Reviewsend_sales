-- ReviewSend Sales CRM — step 4: calendar
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- (0001–0003 must already have been run.) If Supabase warns about Row Level
-- Security, choose "Run without RLS": this file creates no tables.

-- Mark how an appointment went. The rep who owns it (or an admin) can do this.
--   showed   → the demo happened (lead moves to "Demo completed" unless already sold)
--   missed   → "Demo missed": stays on the rep's list to chase
--   canceled → called off
create or replace function public.set_appointment_outcome(
  p_appointment uuid,
  p_status      public.appointment_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_active_user();
  appt public.appointments;
begin
  if p_status not in ('showed', 'missed', 'canceled', 'scheduled') then
    raise exception 'bad_outcome';
  end if;

  select * into appt from public.appointments where id = p_appointment for update;
  if appt.id is null then
    raise exception 'appointment_not_found';
  end if;
  if not coalesce(appt.rep_id = uid or private.is_admin(), false) then
    raise exception 'not_your_appointment';
  end if;

  update public.appointments
     set status = p_status,
         outcome_at = case when p_status = 'scheduled' then null else now() end
   where id = appt.id;

  if p_status = 'showed' then
    update public.leads set status = 'demo_completed'
     where id = appt.lead_id and status = 'appointment_set';
  end if;

  perform private.log_event('appointment_outcome', appt.rep_id, appt.lead_id, appt.call_id, jsonb_build_object(
    'appointment_id', appt.id, 'status', p_status, 'from', appt.status, 'starts_at', appt.starts_at, 'by', uid
  ));
end;
$$;

-- Move an appointment to a new time (keeps it "scheduled").
create or replace function public.reschedule_appointment(
  p_appointment uuid,
  p_start       timestamptz,
  p_minutes     integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_active_user();
  appt public.appointments;
  mins integer;
begin
  select * into appt from public.appointments where id = p_appointment for update;
  if appt.id is null then
    raise exception 'appointment_not_found';
  end if;
  if not coalesce(appt.rep_id = uid or private.is_admin(), false) then
    raise exception 'not_your_appointment';
  end if;
  if p_start < now() - interval '5 minutes' then
    raise exception 'appointment_in_past';
  end if;

  mins := coalesce(p_minutes, (extract(epoch from (appt.ends_at - appt.starts_at)) / 60)::integer);
  update public.appointments
     set starts_at = p_start,
         ends_at = p_start + make_interval(mins => mins),
         status = 'scheduled',
         outcome_at = null
   where id = appt.id;

  perform private.log_event('appointment_rescheduled', appt.rep_id, appt.lead_id, appt.call_id, jsonb_build_object(
    'appointment_id', appt.id, 'from', appt.starts_at, 'to', p_start, 'by', uid
  ));
end;
$$;

-- Give the current user a new private calendar link (if the old one was shared by mistake).
create or replace function public.reset_calendar_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_active_user();
  t   uuid := gen_random_uuid();
begin
  insert into public.calendar_feeds (rep_id, token) values (uid, t)
  on conflict (rep_id) do update set token = excluded.token, created_at = now();
  return t;
end;
$$;

revoke all on function public.set_appointment_outcome(uuid, public.appointment_status) from public, anon;
revoke all on function public.reschedule_appointment(uuid, timestamptz, integer) from public, anon;
revoke all on function public.reset_calendar_token() from public, anon;
grant execute on function public.set_appointment_outcome(uuid, public.appointment_status) to authenticated;
grant execute on function public.reschedule_appointment(uuid, timestamptz, integer) to authenticated;
grant execute on function public.reset_calendar_token() to authenticated;

create index if not exists appointments_time_idx on public.appointments (starts_at);
