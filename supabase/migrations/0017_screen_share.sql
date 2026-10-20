-- 0017: Screen share ("Show my screen").
-- Each rep gets a personal link name (reviewsend.io/corban). Prospects open it and see the rep's
-- screen right away: no code, no sign-in. Every share is logged (who, when, how long watched).
-- Safe to run while reps are dialing. If the CRM is busy it stops after 5 seconds instead of
-- waiting (and holding everyone up): just click Run again.
set lock_timeout = '5s';

-- The rep's personal link name: lowercase letters, numbers and dashes.
alter table public.profiles add column if not exists share_slug text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_share_slug_format') then
    alter table public.profiles add constraint profiles_share_slug_format
      check (share_slug is null or share_slug ~ '^[a-z0-9][a-z0-9-]{1,29}$');
  end if;
end $$;
create unique index if not exists profiles_share_slug_idx on public.profiles (share_slug) where share_slug is not null;

-- One row per screen share. The rep's browser checks in every 20 seconds while sharing.
create table if not exists public.screen_shares (
  id               uuid primary key default gen_random_uuid(),
  rep_id           uuid not null references public.profiles (id) on delete cascade,
  lead_id          uuid references public.leads (id) on delete set null,
  call_id          uuid,   -- plain id, like events
  started_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  ended_at         timestamptz,
  peak_viewers     integer not null default 0,
  viewers_total    integer not null default 0,
  watched_seconds  integer not null default 0
);
create index if not exists screen_shares_rep_time_idx on public.screen_shares (rep_id, started_at desc);
create index if not exists screen_shares_open_idx on public.screen_shares (rep_id) where ended_at is null;

alter table public.screen_shares enable row level security;
drop policy if exists "screen_shares: read visible" on public.screen_shares;
create policy "screen_shares: read visible" on public.screen_shares
  for select to authenticated using (private.can_see_rep(rep_id));
-- Writes come from server code.

-- Public (no sign-in): whose link is this, and are they sharing right now?
create or replace function public.share_room(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'rep_id', p.id,
    'name', split_part(coalesce(nullif(trim(p.full_name), ''), 'Your ReviewSend rep'), ' ', 1),
    'sharing', exists (
      select 1 from public.screen_shares s
       where s.rep_id = p.id and s.ended_at is null and s.last_seen_at > now() - interval '90 seconds'
    )
  )
  from public.profiles p
  where p.share_slug = lower(trim(p_slug)) and p.active
$$;

-- Public: is this rep sharing right now? (Gates the video relay so it can't be used for anything else.)
create or replace function public.share_active(p_rep uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.screen_shares s
     where s.rep_id = p_rep and s.ended_at is null and s.last_seen_at > now() - interval '90 seconds'
  )
$$;

revoke all on function public.share_room(text) from public;
revoke all on function public.share_active(uuid) from public;
grant execute on function public.share_room(text) to anon, authenticated;
grant execute on function public.share_active(uuid) to anon, authenticated;
