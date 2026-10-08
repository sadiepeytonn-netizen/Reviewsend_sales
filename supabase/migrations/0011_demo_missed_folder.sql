-- ReviewSend Sales CRM — Demo Missed folder.
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- (0001–0010 must already have been run.) If Supabase warns about "destructive
-- operations" or Row Level Security, choose Run: nothing is deleted.
--
-- When an appointment is marked Demo missed, the lead goes into its rep's Demo Missed
-- folder (leads.missed_since). The dialer's DEMO MISSED list calls each one once a day,
-- with no limit, until the rep rebooks it, it's sold / not interested / Do Not Call /
-- bad number, or the rep removes it.

alter table public.leads add column if not exists missed_since timestamptz;
create index if not exists leads_missed_idx on public.leads (owner_id) where missed_since is not null;

-- Appointment marked missed → into the folder. Rescheduled / un-done / new booking → out.
create or replace function private.missed_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'scheduled' then
      update public.leads set missed_since = null where id = new.lead_id and missed_since is not null;
    end if;
  elsif new.status = 'missed' and old.status is distinct from 'missed' then
    update public.leads set missed_since = coalesce(missed_since, now()) where id = new.lead_id;
  elsif old.status = 'missed' and new.status <> 'missed' then
    update public.leads set missed_since = null where id = new.lead_id;
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_missed_folder on public.appointments;
create trigger appointments_missed_folder after insert or update of status on public.appointments
  for each row execute function private.missed_from_appointment();

-- Sold / not interested / Do Not Call / bad number → out of the folder.
create or replace function private.missed_leave_on_close()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.missed_since is not null
     and new.status::text in ('sold', 'not_interested', 'do_not_call', 'bad_number', 'removed') then
    new.missed_since := null;
  end if;
  return new;
end;
$$;
drop trigger if exists leads_missed_leave on public.leads;
create trigger leads_missed_leave before update of status on public.leads
  for each row execute function private.missed_leave_on_close();

-- Leads already sitting on a missed appointment (before this update) go in now.
update public.leads l
   set missed_since = a.outcome_at
  from (
    select distinct on (lead_id) lead_id, status, coalesce(outcome_at, starts_at) as outcome_at
      from public.appointments
     order by lead_id, starts_at desc
  ) a
 where a.lead_id = l.id and a.status = 'missed' and l.owner_id is not null and l.missed_since is null
   and l.status in ('appointment_set', 'demo_completed');

-- The rep takes someone out of their folder (or the admin does).
create or replace function public.remove_from_missed(p_lead uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_active_user();
  lead public.leads;
begin
  select * into lead from public.leads where id = p_lead for update;
  if lead.id is null then
    raise exception 'lead_not_found';
  end if;
  if not coalesce(lead.owner_id = uid or private.is_admin(), false) then
    raise exception 'not_your_lead';
  end if;
  update public.leads
     set missed_since = null,
         claimed_by = case when claimed_by = uid then null else claimed_by end,
         claimed_at = case when claimed_by = uid then null else claimed_at end,
         claim_expires_at = case when claimed_by = uid then null else claim_expires_at end
   where id = p_lead;
  perform private.log_event('missed_removed', uid, p_lead, null, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dialer: EAST / WEST (shared pool), MY LIST (private), or DEMO MISSED (the rep's
-- missed-demo folder: each lead once per day, in the lead's time zone).
-- ---------------------------------------------------------------------------
drop function if exists public.claim_next_lead(public.lead_list, boolean);

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
       order by l.next_call_at, l.created_at
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
revoke all on function public.remove_from_missed(uuid) from public, anon;
grant execute on function public.claim_next_lead(public.lead_list, boolean, boolean) to authenticated;
grant execute on function public.remove_from_missed(uuid) to authenticated;
