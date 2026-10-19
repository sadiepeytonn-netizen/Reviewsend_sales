-- 0012: Shuffle the dialer.
-- Before: EAST / WEST / MY LIST dialed the oldest upload first, so reps worked one
-- uploaded file all the way through before reaching the next one.
-- Now: every lead gets a random "shuffle" number and the dialer goes in that order,
-- so all uploaded lists are mixed together. Callbacks set for a later time still wait
-- until they're due; the Demo missed folder is unchanged.
-- Safe to run while reps are dialing.

alter table public.leads add column if not exists shuffle double precision not null default random();

create index if not exists leads_shuffle_idx on public.leads (list, shuffle) where owner_id is null;
create index if not exists leads_assigned_shuffle_idx on public.leads (assigned_to, shuffle) where assigned_to is not null;

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
       order by l.shuffle
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
