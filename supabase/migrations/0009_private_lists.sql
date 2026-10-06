-- ReviewSend Sales CRM — private lead lists, cleanup of never-reached leads.
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- (0001–0008 must already have been run.) If Supabase warns about Row Level
-- Security or "destructive operations", choose Run: nothing is deleted.
--
-- Private lists: the admin uploads leads for one person (leads.assigned_to). Only
-- that person dials them (the dialer's MY LIST); nobody else can call or see them.
-- Numbers already in the CRM stay with whoever had them.

alter type public.lead_status add value if not exists 'removed'; -- taken out of dialing by the admin

alter table public.leads add column if not exists assigned_to uuid references public.profiles (id);
create index if not exists leads_assigned_idx on public.leads (assigned_to, next_call_at) where assigned_to is not null;
alter table public.import_batches add column if not exists assigned_to uuid references public.profiles (id);

-- New leads from an import for a person go on that person's list.
create or replace function private.assign_from_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.import_batch_id is not null and new.assigned_to is null then
    select b.assigned_to into new.assigned_to from public.import_batches b where b.id = new.import_batch_id;
  end if;
  return new;
end;
$$;
drop trigger if exists leads_assign_from_batch on public.leads;
create trigger leads_assign_from_batch before insert on public.leads
  for each row execute function private.assign_from_batch();

-- Reps can read the leads on their own private list.
drop policy if exists "leads: rep reads own or claimed" on public.leads;
create policy "leads: rep reads own or claimed" on public.leads
  for select to authenticated using (
    private.is_active_user()
    and (private.can_see_rep(owner_id) or private.can_see_rep(claimed_by) or private.can_see_rep(assigned_to))
  );

-- ---------------------------------------------------------------------------
-- Dialer: next lead from EAST / WEST (shared pool only) or from MY LIST.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_next_lead(public.lead_list);

create or replace function public.claim_next_lead(p_list public.lead_list default null, p_mine boolean default false)
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
     and (case when p_mine then assigned_to = uid else assigned_to is null and list = p_list end)
   limit 1;

  if lead.id is null then
    -- Give back anything stale this rep still holds.
    update public.leads set claimed_by = null, claimed_at = null, claim_expires_at = null
     where claimed_by = uid;

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

    if lead.id is null then
      update public.rep_presence set current_lead_id = null where rep_id = uid;
      return null;
    end if;

    update public.leads
       set claimed_by = uid, claimed_at = now(), claim_expires_at = now() + make_interval(secs => ttl)
     where id = lead.id
    returning * into lead;

    perform private.log_event('lead_claimed', uid, lead.id, null, jsonb_build_object('list', p_list, 'mine', p_mine));
  end if;

  update public.rep_presence set current_lead_id = lead.id, list = case when p_mine then null else p_list end where rep_id = uid;
  return to_jsonb(lead);
end;
$$;

-- Keypad, calendar booking: someone else's private list counts as theirs.
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

  -- On someone else's private list
  if lead.assigned_to is not null and lead.assigned_to <> uid and not private.is_admin() then
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
    if lead.assigned_to is not null and lead.assigned_to <> rep and not private.is_admin() then
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
  if lead.assigned_to is not null and lead.assigned_to <> p_rep and not private.is_admin() then
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

-- ---------------------------------------------------------------------------
-- Admin: move a person's private list to someone else (p_to null = shared pool).
-- Only leads that aren't anyone's client yet move.
-- ---------------------------------------------------------------------------
create or replace function public.reassign_list(p_from uuid, p_to uuid)
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
     set assigned_to = p_to, claimed_by = null, claimed_at = null, claim_expires_at = null
   where assigned_to = p_from and owner_id is null;
  get diagnostics n = row_count;
  perform private.log_event('list_moved', uid, null, null, jsonb_build_object('from', p_from, 'to', p_to, 'count', n));
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: leads called many times that never had a real conversation.
-- ---------------------------------------------------------------------------
create or replace function public.never_reached_leads(p_min_calls integer default 10)
returns table (
  id            uuid,
  business_name text,
  contact_name  text,
  phone_e164    text,
  status        public.lead_status,
  calls         bigint,
  last_called   timestamptz,
  assigned_to   uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not_allowed';
  end if;
  return query
    select l.id, l.business_name, l.contact_name, l.phone_e164, l.status, c.n, c.last_at, l.assigned_to
      from public.leads l
      join (
        select x.lead_id, count(*) as n, max(x.started_at) as last_at
          from public.calls x
         where x.lead_id is not null
         group by x.lead_id
        having count(*) >= p_min_calls
           and count(*) filter (where x.disposition in ('not_interested', 'appointment_set', 'demo_completed', 'sold', 'do_not_call')) = 0
      ) c on c.lead_id = l.id
     where l.owner_id is null and l.status::text <> 'removed'
     order by c.n desc, c.last_at desc
     limit 500;
end;
$$;

-- Take leads out of dialing for good (they stay in the CRM, so re-imports don't bring them back).
create or replace function public.remove_leads(p_ids uuid[])
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
     set status = 'removed'::text::public.lead_status, claimed_by = null, claimed_at = null, claim_expires_at = null
   where id = any(p_ids) and owner_id is null;
  get diagnostics n = row_count;
  perform private.log_event('leads_removed', uid, null, null, jsonb_build_object('count', n));
  return n;
end;
$$;

-- Lead inventory: EAST / WEST count the shared pool only; private lists are counted per person.
create or replace function public.lead_inventory()
returns table (
  list         public.lead_list,
  ready_now    bigint,
  waiting      bigint,
  never_called bigint,
  owned        bigint,
  closed       bigint,
  total        bigint
)
language sql
stable
set search_path = ''
as $$
  select
    l.list,
    count(*) filter (where l.owner_id is null and l.assigned_to is null and l.status in ('new', 'no_answer') and l.next_call_at <= now()),
    count(*) filter (where l.owner_id is null and l.assigned_to is null and l.status in ('new', 'no_answer') and l.next_call_at > now()),
    count(*) filter (where l.assigned_to is null and l.status = 'new' and l.attempt_count = 0),
    count(*) filter (where l.owner_id is not null),
    count(*) filter (where l.owner_id is null and l.status not in ('new', 'no_answer')),
    count(*) filter (where l.assigned_to is null or l.owner_id is not null)
  from public.leads l
  group by l.list
  order by l.list nulls last;
$$;

create or replace function public.private_list_stats()
returns table (rep_id uuid, ready_now bigint, waiting bigint, total bigint)
language sql
stable
set search_path = ''
as $$
  select l.assigned_to,
    count(*) filter (where l.owner_id is null and l.status in ('new', 'no_answer') and l.next_call_at <= now()),
    count(*) filter (where l.owner_id is null and l.status in ('new', 'no_answer') and l.next_call_at > now()),
    count(*) filter (where l.owner_id is null)
  from public.leads l
  where l.assigned_to is not null
  group by l.assigned_to;
$$;

revoke all on function public.claim_next_lead(public.lead_list, boolean) from public, anon;
revoke all on function public.reassign_list(uuid, uuid) from public, anon;
revoke all on function public.never_reached_leads(integer) from public, anon;
revoke all on function public.remove_leads(uuid[]) from public, anon;
revoke all on function public.private_list_stats() from public, anon;
grant execute on function public.claim_next_lead(public.lead_list, boolean) to authenticated;
grant execute on function public.reassign_list(uuid, uuid) to authenticated;
grant execute on function public.never_reached_leads(integer) to authenticated;
grant execute on function public.remove_leads(uuid[]) to authenticated;
grant execute on function public.private_list_stats() to authenticated, service_role;
