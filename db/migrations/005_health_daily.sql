-- Daily health values from Garmin Connect (UX-015): one row per user and
-- local calendar day, plus the state of the last fetch per user.
--
-- Additive. Same rules as 001–004: every row belongs to one user, row level
-- security (policy own_rows) lets only that user's rows through, and the
-- account deletion removes everything through the cascade from arnold.users.
--
-- Unknown is NULL, never 0: every value column may be NULL, because Garmin
-- leaves out what the watch did not measure.
--
-- Health consent: a row can only be written while the consent garmin_health
-- is active (arnold.require_daily_health_consent, holding the consent row
-- like the other health writes). Revoking the consent deletes the user's
-- daily values and fetch state in the same transaction
-- (arnold.erase_health_daily_on_revoke).
--
-- Undo: db/rollback/005_down.sql (only with the owner's explicit yes).

create table arnold.health_daily (
  user_id text not null references arnold.users (user_id) on delete cascade,
  -- Garmin's calendarDate: the user's own local day, never derived from UTC.
  local_date text not null check (local_date ~ '^\d{4}-\d{2}-\d{2}$'),
  source text not null check (source in ('garmin_personal', 'garmin_starter')),
  received_at timestamptz not null default now(),
  resting_hr_bpm integer check (resting_hr_bpm between 20 and 250),
  stress_avg integer check (stress_avg between 0 and 100),
  body_battery_high integer check (body_battery_high between 0 and 100),
  body_battery_end_of_day integer check (body_battery_end_of_day between 0 and 100),
  sleep_seconds integer check (sleep_seconds between 0 and 86400),
  sleep_score integer check (sleep_score between 0 and 100),
  hrv_last_night_ms integer check (hrv_last_night_ms between 1 and 500),
  hrv_status text check (hrv_status in ('balanced', 'unbalanced', 'low', 'poor')),
  primary key (user_id, local_date)
);

-- When the server last tried and last succeeded to fetch, and how the last
-- attempt ended. No health values, no key, no token.
create table arnold.health_daily_sync (
  user_id text not null references arnold.users (user_id) on delete cascade,
  source text not null check (source in ('garmin_personal', 'garmin_starter')),
  last_attempt_at timestamptz not null,
  last_success_at timestamptz,
  last_outcome text not null check (last_outcome in
    ('ok', 'empty', 'key_expired', 'key_invalid', 'rate_limited',
     'upstream_error', 'network_error', 'no_consent')),
  primary key (user_id)
);

-- ------------------------------------------------------- health consent

create function arnold.require_daily_health_consent() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  perform 1 from arnold.health_consents c
    where c.user_id = new.user_id and c.scope = 'garmin_health'
      and c.revoked_at is null
    for share;
  if not found then
    raise exception 'Daily health values need the health consent'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger health_daily_consent before insert or update on arnold.health_daily
  for each row execute function arnold.require_daily_health_consent();

-- Runs as the caller (arnold_app), so row level security limits it to the
-- revoking user's own rows.
create function arnold.erase_health_daily_on_revoke() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.revoked_at is null and new.revoked_at is not null
     and new.scope = 'garmin_health' then
    delete from arnold.health_daily where user_id = new.user_id;
    delete from arnold.health_daily_sync where user_id = new.user_id;
  end if;
  return null;
end
$$;

create trigger health_consents_erase_daily after update on arnold.health_consents
  for each row execute function arnold.erase_health_daily_on_revoke();

revoke all on function arnold.require_daily_health_consent() from public;
revoke all on function arnold.erase_health_daily_on_revoke() from public;

-- ------------------------------------------------------- row level security

do $$
declare
  t text;
begin
  foreach t in array array['health_daily', 'health_daily_sync'] loop
    execute format('alter table arnold.%I enable row level security', t);
    execute format(
      'create policy own_rows on arnold.%I for all to arnold_app '
      'using (user_id = arnold.current_user_id()) '
      'with check (user_id = arnold.current_user_id())', t);
  end loop;
end
$$;

-- DELETE because a consent revocation erases these rows.
grant select, insert, update, delete on arnold.health_daily, arnold.health_daily_sync
  to arnold_app;

-- The Supabase API roles get nothing on the new tables or functions.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on arnold.health_daily, arnold.health_daily_sync from %I', r);
      execute format('revoke all on function arnold.require_daily_health_consent(), arnold.erase_health_daily_on_revoke() from %I', r);
    end if;
  end loop;
end
$$;
