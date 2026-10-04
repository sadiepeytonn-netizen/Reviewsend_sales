-- ReviewSend Sales CRM — Live: listen / whisper / barge.
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- (0001–0007 must already have been run.) If Supabase warns about Row Level
-- Security, choose "Run without RLS": this file creates no tables.
--
-- To allow listening in, each call now runs as a private Twilio "conference" room
-- (rep + prospect, and a coach when someone listens). settings.conference_calls
-- switches back to the old direct calls if ever needed (no listening then).

alter table public.calls
  add column if not exists conference        boolean not null default false,
  add column if not exists prospect_call_sid text;

alter table public.settings
  add column if not exists conference_calls boolean not null default true;
