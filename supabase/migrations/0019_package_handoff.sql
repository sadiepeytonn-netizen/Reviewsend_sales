-- ReviewSend Sales CRM — step 19: packages + handoff to the Account Manager CRM
--
-- Run ONCE in Supabase: SQL Editor → New query → paste this whole file → Run.
-- Adds columns only. The package list itself lives in the Account Manager CRM
-- (decision #24); a sale stores which package was sold and whether the new
-- client has been sent over yet.

alter table public.sales
  add column if not exists package_id       text,          -- the package's id in the Account Manager CRM
  add column if not exists package_name     text,          -- e.g. "Pro", as it was at the time of sale
  add column if not exists handed_off_at    timestamptz,   -- when the Account Manager CRM accepted the new client
  add column if not exists handoff_error    text,          -- last reason it couldn't be sent (cleared on success)
  add column if not exists am_business_id   text;          -- the client's id in the Account Manager CRM

-- The setup fee is whatever the salesperson negotiates, with no limit (decision #46).
-- (settings.setup_fee_max is no longer used; it's left in place.)
