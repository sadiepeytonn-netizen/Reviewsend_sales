-- 0015: Starred recordings.
-- Admins star the calls reps should really listen to (with an optional note on why).
-- They show in a "Starred" folder on the Recordings page. Safe to run while reps are dialing.

alter table public.calls add column if not exists starred_at timestamptz;
-- No foreign key on purpose: a second link from calls to profiles would make "the call's rep"
-- ambiguous in the app's queries.
alter table public.calls add column if not exists starred_by uuid;
alter table public.calls add column if not exists star_note  text;

create index if not exists calls_starred_idx on public.calls (starred_at desc) where starred_at is not null;
