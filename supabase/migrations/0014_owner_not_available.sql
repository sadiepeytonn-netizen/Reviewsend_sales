-- 0014: New call outcome "Owner not available" (someone answered, but not the owner).
-- The lead goes back in line and is retried on the same schedule as "No answer".
-- It isn't counted as a contact (the owner wasn't reached).
-- Safe to run while reps are dialing.

alter type public.call_disposition add value if not exists 'owner_unavailable' after 'no_answer';

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
    when 'no_answer', 'owner_unavailable' then
      -- A rep's own lead (appointment / sale) stays theirs; only pool leads cycle.
      -- "Owner not available" (someone answered, but not the owner) retries on the same schedule.
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

revoke all on function public.dispose_lead(uuid, public.call_disposition, uuid, text, timestamptz, integer) from public, anon;
grant execute on function public.dispose_lead(uuid, public.call_disposition, uuid, text, timestamptz, integer) to authenticated;
