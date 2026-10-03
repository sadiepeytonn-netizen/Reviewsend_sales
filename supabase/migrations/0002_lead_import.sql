-- ReviewSend Sales CRM — step 2: lead import, duplicates, lists, Do Not Call
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- (0001_initial_schema.sql must already have been run.)

-- ---------------------------------------------------------------------------
-- Import history: allow undoing an import
-- ---------------------------------------------------------------------------
alter table public.import_batches
  add column undone_at    timestamptz,
  add column undone_count integer not null default 0;

create index leads_import_batch_idx on public.leads (import_batch_id);

-- ---------------------------------------------------------------------------
-- Import one chunk of rows (already cleaned up by the server).
--
-- Each row is a JSON object with the lead fields plus phone_e164, timezone,
-- list, and optionally "invalid_reason" (for rows the server already rejected).
-- For each row, in order:
--   invalid          → skipped
--   on Do Not Call   → skipped
--   same phone, or same business name + city as an existing lead
--                    → "merged": fills in that lead's BLANK fields only
--   otherwise        → inserted as a new lead
-- Returns one result per row: {"i": <row index>, "outcome": ..., "lead_id": ...}
-- ---------------------------------------------------------------------------
create or replace function public.import_lead_rows(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r            jsonb;
  idx          integer := 0;
  results      jsonb := '[]'::jsonb;
  existing_id  uuid;
  new_id       uuid;
  v_key        text;
  n_inserted   integer := 0;
  n_merged     integer := 0;
  n_dnc        integer := 0;
  n_invalid    integer := 0;
  v_source     text;
begin
  select lead_source into v_source from public.import_batches where id = p_batch_id;
  if v_source is null then
    raise exception 'Unknown import batch %', p_batch_id;
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    existing_id := null;
    new_id := null;

    if coalesce(r ->> 'invalid_reason', '') <> '' then
      n_invalid := n_invalid + 1;
      results := results || jsonb_build_object('i', idx, 'outcome', 'invalid', 'reason', r ->> 'invalid_reason');

    elsif exists (select 1 from public.dnc_numbers d where d.phone_e164 = r ->> 'phone_e164') then
      n_dnc := n_dnc + 1;
      results := results || jsonb_build_object('i', idx, 'outcome', 'dnc');

    else
      select l.id into existing_id from public.leads l where l.phone_e164 = r ->> 'phone_e164';

      if existing_id is null and nullif(trim(r ->> 'city'), '') is not null then
        -- Same expression as leads.name_city_key
        v_key := lower(regexp_replace(r ->> 'business_name', '[^a-zA-Z0-9]', '', 'g'))
              || '|' || lower(regexp_replace(r ->> 'city', '[^a-zA-Z0-9]', '', 'g'));
        select l.id into existing_id from public.leads l where l.name_city_key = v_key;
      end if;

      if existing_id is not null then
        update public.leads l set
          contact_name       = coalesce(nullif(l.contact_name, ''), nullif(r ->> 'contact_name', '')),
          phone_raw          = coalesce(nullif(l.phone_raw, ''), nullif(r ->> 'phone_raw', '')),
          phone_e164         = coalesce(l.phone_e164, r ->> 'phone_e164'),
          email              = coalesce(nullif(l.email, ''), nullif(r ->> 'email', '')),
          website            = coalesce(nullif(l.website, ''), nullif(r ->> 'website', '')),
          address            = coalesce(nullif(l.address, ''), nullif(r ->> 'address', '')),
          city               = coalesce(nullif(l.city, ''), nullif(r ->> 'city', '')),
          state              = coalesce(nullif(l.state, ''), nullif(r ->> 'state', '')),
          category           = coalesce(nullif(l.category, ''), nullif(r ->> 'category', '')),
          google_rating      = coalesce(l.google_rating, (r ->> 'google_rating')::numeric),
          review_count       = coalesce(l.review_count, (r ->> 'review_count')::integer),
          google_profile_url = coalesce(nullif(l.google_profile_url, ''), nullif(r ->> 'google_profile_url', '')),
          import_notes       = coalesce(nullif(l.import_notes, ''), nullif(r ->> 'import_notes', '')),
          timezone           = coalesce(l.timezone, r ->> 'timezone'),
          list               = coalesce(l.list, (r ->> 'list')::public.lead_list)
        where l.id = existing_id;

        n_merged := n_merged + 1;
        results := results || jsonb_build_object('i', idx, 'outcome', 'merged', 'lead_id', existing_id);
      else
        insert into public.leads (
          business_name, contact_name, phone_raw, phone_e164, email, website, address, city, state,
          category, google_rating, review_count, google_profile_url, lead_source, import_notes,
          timezone, list, import_batch_id
        ) values (
          r ->> 'business_name',
          nullif(r ->> 'contact_name', ''),
          nullif(r ->> 'phone_raw', ''),
          r ->> 'phone_e164',
          nullif(r ->> 'email', ''),
          nullif(r ->> 'website', ''),
          nullif(r ->> 'address', ''),
          nullif(r ->> 'city', ''),
          nullif(r ->> 'state', ''),
          nullif(r ->> 'category', ''),
          (r ->> 'google_rating')::numeric,
          (r ->> 'review_count')::integer,
          nullif(r ->> 'google_profile_url', ''),
          v_source,
          nullif(r ->> 'import_notes', ''),
          nullif(r ->> 'timezone', ''),
          (nullif(r ->> 'list', ''))::public.lead_list,
          p_batch_id
        )
        returning id into new_id;

        n_inserted := n_inserted + 1;
        results := results || jsonb_build_object('i', idx, 'outcome', 'inserted', 'lead_id', new_id);
      end if;
    end if;

    idx := idx + 1;
  end loop;

  update public.import_batches set
    inserted_count = inserted_count + n_inserted,
    merged_count   = merged_count + n_merged,
    dnc_count      = dnc_count + n_dnc,
    invalid_count  = invalid_count + n_invalid
  where id = p_batch_id;

  return results;
end;
$$;

-- Only the server (secret key) may run imports.
revoke all on function public.import_lead_rows(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_lead_rows(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Adding a number to Do Not Call immediately pulls every matching lead out
-- of the dialing pool.
-- ---------------------------------------------------------------------------
create or replace function private.apply_dnc_to_leads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.leads
     set status = 'do_not_call',
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null
   where phone_e164 = new.phone_e164
     and status <> 'do_not_call';
  return new;
end;
$$;

create trigger dnc_applies_to_leads
  after insert on public.dnc_numbers
  for each row execute function private.apply_dnc_to_leads();

-- ---------------------------------------------------------------------------
-- Lead inventory for the admin Leads page (row-level security applies, so
-- only an admin sees the whole picture).
-- ---------------------------------------------------------------------------
create or replace function public.lead_inventory()
returns table (
  list         public.lead_list,
  ready_now    bigint,   -- in the pool and due to be called
  waiting      bigint,   -- in the pool, waiting for a retry time
  never_called bigint,
  owned        bigint,   -- belongs to a rep (appointment / sale)
  closed       bigint,   -- not interested, DNC, bad number, exhausted, sold...
  total        bigint
)
language sql
stable
set search_path = ''
as $$
  select
    l.list,
    count(*) filter (where l.owner_id is null and l.status in ('new', 'no_answer') and l.next_call_at <= now()),
    count(*) filter (where l.owner_id is null and l.status in ('new', 'no_answer') and l.next_call_at > now()),
    count(*) filter (where l.status = 'new' and l.attempt_count = 0),
    count(*) filter (where l.owner_id is not null),
    count(*) filter (where l.owner_id is null and l.status not in ('new', 'no_answer')),
    count(*)
  from public.leads l
  group by l.list
  order by l.list nulls last;
$$;

-- Bad-number rate by lead source (helps judge lead vendors).
create or replace function public.lead_source_stats()
returns table (
  lead_source  text,
  total        bigint,
  dialed       bigint,
  bad_numbers  bigint,
  dnc          bigint
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(l.lead_source, '(none)'),
    count(*),
    count(*) filter (where l.attempt_count > 0),
    count(*) filter (where l.status = 'bad_number'),
    count(*) filter (where l.status = 'do_not_call')
  from public.leads l
  group by 1
  order by 2 desc;
$$;

grant execute on function public.lead_inventory() to authenticated, service_role;
grant execute on function public.lead_source_stats() to authenticated, service_role;
