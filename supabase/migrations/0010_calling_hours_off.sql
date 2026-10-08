-- ReviewSend Sales CRM — calling hours switch (owner's decision: no calling-hours limit).
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- (0001–0009 must already have been run.) If Supabase warns about Row Level
-- Security, choose "Run without RLS": this file creates no tables.
--
-- Calling hours are now a switch: start 0 / end 24 means "any time" (also for leads
-- whose time zone is unknown). The admin Dashboard can turn 8am–8pm back on.

create or replace function private.in_calling_hours(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.settings s
    where (s.calling_start_hour = 0 and s.calling_end_hour = 24)
       or (p_tz is not null
           and extract(hour from (now() at time zone p_tz)) >= s.calling_start_hour
           and extract(hour from (now() at time zone p_tz)) <  s.calling_end_hour)
  );
$$;

update public.settings set calling_start_hour = 0, calling_end_hour = 24 where id = 1;
