-- 0013: Equal turns between uploaded files.
-- EAST / WEST / MY LIST now rotate between uploaded files: each lead handed out comes
-- from the file that has gone the longest without a call (leads added by hand count as
-- one file), picked at random inside that file. A big file no longer drowns out the
-- small ones. EAST and WEST are never mixed. The Demo missed folder is unchanged.
-- Safe to run while reps are dialing.

create or replace function public.claim_next_lead(
  p_list   public.lead_list default null,
  p_mine   boolean default false,
  p_missed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_active_user();
  ttl  integer;
  lead public.leads;
  turn record;
begin
  select claim_ttl_seconds into ttl from public.settings where id = 1;

  if p_missed then
    select * into lead from public.leads
     where claimed_by = uid and claim_expires_at > now() and owner_id = uid and missed_since is not null
     limit 1;
  else
    select * into lead from public.leads
     where claimed_by = uid and claim_expires_at > now() and owner_id is null
       and status in ('new', 'no_answer')
       and (case when p_mine then assigned_to = uid else assigned_to is null and list = p_list end)
     limit 1;
  end if;

  if lead.id is null then
    -- Give back anything stale this rep still holds.
    update public.leads set claimed_by = null, claimed_at = null, claim_expires_at = null
     where claimed_by = uid;

    if p_missed then
      select l.* into lead
        from public.leads l
       where l.owner_id = uid
         and l.missed_since is not null
         and l.phone_e164 is not null
         -- once a day: not yet called today (their time; Eastern if unknown)
         and (l.last_called_at is null
              or (l.last_called_at at time zone coalesce(l.timezone, 'America/New_York'))::date
                 < (now() at time zone coalesce(l.timezone, 'America/New_York'))::date)
         and (l.claimed_by is null or l.claim_expires_at < now())
         and not exists (select 1 from public.dnc_numbers d where d.phone_e164 = l.phone_e164)
         and private.in_calling_hours(l.timezone)
       order by l.last_called_at nulls first, l.missed_since
       limit 1
       for update of l skip locked;
    else
      -- Equal turns: the uploaded file (hand-added leads count as one) that has gone the
      -- longest without a call, among files that still have someone ready to call.
      select g.batch, true as found into turn
        from (
          select l.import_batch_id as batch,
                 bool_or(l.owner_id is null
                         and l.status in ('new', 'no_answer')
                         and l.next_call_at <= now()
                         and l.phone_e164 is not null
                         and (l.claimed_by is null or l.claim_expires_at < now())) as has_ready,
                 max(greatest(coalesce(l.claimed_at, '-infinity'), coalesce(l.last_called_at, '-infinity'))) as touched
            from public.leads l
           where (case when p_mine then l.assigned_to = uid else l.assigned_to is null and l.list = p_list end)
           group by l.import_batch_id
        ) g
       where g.has_ready
       order by g.touched, random()
       limit 1;

      -- A random lead from that file (falls back to the other files if none is callable).
      select l.* into lead
        from public.leads l
       where (case when p_mine then l.assigned_to = uid else l.assigned_to is null and l.list = p_list end)
         and l.owner_id is null
         and l.status in ('new', 'no_answer')
         and l.next_call_at <= now()
         and l.phone_e164 is not null
         and (l.claimed_by is null or l.claim_expires_at < now())
         and not exists (select 1 from public.dnc_numbers d where d.phone_e164 = l.phone_e164)
         and private.in_calling_hours(l.timezone)
       order by (turn.found is true and l.import_batch_id is not distinct from turn.batch) desc, l.shuffle
       limit 1
       for update of l skip locked;
    end if;

    if lead.id is null then
      update public.rep_presence set current_lead_id = null where rep_id = uid;
      return null;
    end if;

    update public.leads
       set claimed_by = uid, claimed_at = now(), claim_expires_at = now() + make_interval(secs => ttl)
     where id = lead.id
    returning * into lead;

    perform private.log_event('lead_claimed', uid, lead.id, null,
      jsonb_build_object('list', p_list, 'mine', p_mine, 'missed', p_missed));
  end if;

  update public.rep_presence
     set current_lead_id = lead.id, list = case when p_mine or p_missed then null else p_list end
   where rep_id = uid;
  return to_jsonb(lead);
end;
$$;

revoke all on function public.claim_next_lead(public.lead_list, boolean, boolean) from public, anon;
grant execute on function public.claim_next_lead(public.lead_list, boolean, boolean) to authenticated;
