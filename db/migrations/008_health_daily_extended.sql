-- Extended daily health values from Garmin Connect: everything Garmin
-- delivers per local day (sleep stages, respiration, blood oxygen, activity,
-- skin temperature, fitness, training), plus the raw Garmin answers.
--
-- Additive. Same rules as 005: every row belongs to one user, row level
-- security (policy own_rows), account deletion removes everything through
-- the cascade from arnold.users, writing needs the active health consent
-- (arnold.require_daily_health_consent), revoking the consent deletes it.
--
-- Unknown is NULL, never 0: every new column may be NULL. The ranges below
-- only keep impossible values out; the server reads Garmin's answers
-- tolerantly (field names "ungeprüft bis zum ersten echten Abruf") and turns
-- anything outside the range into NULL before it gets here.
--
-- Undo: db/rollback/008_down.sql (only with the owner's explicit yes).

alter table arnold.health_daily
  -- Sleep. Times are the user's local wall clock as Garmin reports it
  -- (YYYY-MM-DDTHH:MM:SS), never converted from or to UTC.
  add column sleep_deep_seconds integer check (sleep_deep_seconds between 0 and 86400),
  add column sleep_light_seconds integer check (sleep_light_seconds between 0 and 86400),
  add column sleep_rem_seconds integer check (sleep_rem_seconds between 0 and 86400),
  add column sleep_awake_seconds integer check (sleep_awake_seconds between 0 and 86400),
  add column sleep_awake_count integer check (sleep_awake_count between 0 and 500),
  add column sleep_restless_moments integer check (sleep_restless_moments between 0 and 5000),
  add column sleep_start_local text
    check (sleep_start_local ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'),
  add column sleep_end_local text
    check (sleep_end_local ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'),
  -- Respiration in breaths per minute: during sleep and awake over the day.
  add column respiration_sleep_avg numeric(4,1) check (respiration_sleep_avg between 1 and 99),
  add column respiration_sleep_low numeric(4,1) check (respiration_sleep_low between 1 and 99),
  add column respiration_sleep_high numeric(4,1) check (respiration_sleep_high between 1 and 99),
  add column respiration_day_avg numeric(4,1) check (respiration_day_avg between 1 and 99),
  add column respiration_day_low numeric(4,1) check (respiration_day_low between 1 and 99),
  add column respiration_day_high numeric(4,1) check (respiration_day_high between 1 and 99),
  -- Blood oxygen (SpO2) of the day, percent.
  add column spo2_avg_pct integer check (spo2_avg_pct between 1 and 100),
  add column spo2_min_pct integer check (spo2_min_pct between 1 and 100),
  -- Activity.
  add column steps integer check (steps between 0 and 200000),
  add column step_goal integer check (step_goal between 0 and 200000),
  add column intensity_minutes_moderate integer check (intensity_minutes_moderate between 0 and 2880),
  add column intensity_minutes_vigorous integer check (intensity_minutes_vigorous between 0 and 2880),
  add column floors_climbed integer check (floors_climbed between 0 and 2000),
  add column kcal_active integer check (kcal_active between 0 and 20000),
  add column kcal_total integer check (kcal_total between 0 and 20000),
  add column distance_m integer check (distance_m between 0 and 1000000),
  -- Skin temperature: deviation from the personal norm in °C.
  add column skin_temp_deviation_c numeric(4,2) check (skin_temp_deviation_c between -10 and 10),
  -- Fitness.
  add column vo2max_running numeric(4,1) check (vo2max_running between 5 and 100),
  add column vo2max_cycling numeric(4,1) check (vo2max_cycling between 5 and 100),
  add column fitness_age integer check (fitness_age between 10 and 100),
  add column chronological_age integer check (chronological_age between 5 and 120),
  -- Training: readiness (score and level), status (Garmin's own wording,
  -- lower case), acute and chronic load and their ratio.
  add column training_readiness_score integer check (training_readiness_score between 0 and 100),
  add column training_readiness_level text
    check (training_readiness_level ~ '^[a-z0-9_]{1,40}$'),
  add column training_status text check (training_status ~ '^[a-z0-9_]{1,40}$'),
  add column acute_load numeric(6,1) check (acute_load between 0 and 10000),
  add column chronic_load numeric(6,1) check (chronic_load between 0 and 10000),
  add column load_ratio numeric(4,2) check (load_ratio between 0 and 99);

-- How each optional Garmin endpoint ended in the last fetch:
-- { "<endpoint>": "ok" | "empty" | "unavailable" | "error" }. No response
-- text, no key, no token, no health values.
alter table arnold.health_daily_sync
  add column endpoint_outcomes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(endpoint_outcomes) = 'object'
           and octet_length(endpoint_outcomes::text) <= 4096);

-- Garmin's answers as received (cleaned of anything key- or token-like by
-- the server), one per user, local day and endpoint, so they can be
-- evaluated again if a field name turns out different from the assumed one.
create table arnold.health_daily_raw (
  user_id text not null references arnold.users (user_id) on delete cascade,
  local_date text not null check (local_date ~ '^\d{4}-\d{2}-\d{2}$'),
  -- Arnold's name for the endpoint (for example daily_sleep), not the URL.
  endpoint text not null check (endpoint ~ '^[a-z0-9_]{1,40}$'),
  payload jsonb not null check (octet_length(payload::text) <= 262144),
  received_at timestamptz not null default now(),
  primary key (user_id, local_date, endpoint)
);

-- ------------------------------------------------------- health consent

create trigger health_daily_raw_consent before insert or update on arnold.health_daily_raw
  for each row execute function arnold.require_daily_health_consent();

-- Replaces the function from 005: the revocation also erases the raw answers.
create or replace function arnold.erase_health_daily_on_revoke() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.revoked_at is null and new.revoked_at is not null
     and new.scope = 'garmin_health' then
    delete from arnold.health_daily where user_id = new.user_id;
    delete from arnold.health_daily_raw where user_id = new.user_id;
    delete from arnold.health_daily_sync where user_id = new.user_id;
  end if;
  return null;
end
$$;

-- ------------------------------------------------------- row level security

alter table arnold.health_daily_raw enable row level security;
create policy own_rows on arnold.health_daily_raw for all to arnold_app
  using (user_id = arnold.current_user_id())
  with check (user_id = arnold.current_user_id());

-- DELETE because a consent revocation erases these rows.
grant select, insert, update, delete on arnold.health_daily_raw to arnold_app;

-- The Supabase API roles get nothing on the new table.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on arnold.health_daily_raw from %I', r);
    end if;
  end loop;
end
$$;
