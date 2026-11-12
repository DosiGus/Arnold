-- Running (ARN-RUN): run profile, run sessions of a plan version, runs and
-- their segments, heart-rate zones. Raw data schema arnold.training_raw 1.1.0.
--
-- Additive. Same rules as 001–003: every row belongs to one user, row level
-- security (policy own_rows) lets only that user's rows through, every
-- reference includes user_id, and the account deletion removes everything
-- through the cascade from arnold.users. Column names follow
-- src/shared/arnold-schema-v1.ts; value rules beyond the checks below are
-- enforced by the Zod schema on every write.
--
-- Heart rate (D-RUN-07): values and zone bounds can only be stored while the
-- health consent is active (trigger arnold.require_health_consent), and a
-- revocation erases them (arnold.erase_run_health). GPS coordinates have no
-- column anywhere (D-RUN-08).
--
-- Undo: db/rollback/004_down.sql (only with the owner's explicit yes).

-- --------------------------------------------------------------- workouts

alter table arnold.workouts
  add column activity_type text not null default 'strength'
    check (activity_type in ('strength', 'run'));
-- A run is never "in progress" on the server: the watch sends it when done.
alter table arnold.workouts
  add constraint workouts_run_not_in_progress
    check (activity_type <> 'run' or status <> 'in_progress');
-- Lets runs refer to (user_id, workout_id, activity_type), so a run row can
-- only belong to a run workout.
alter table arnold.workouts
  add constraint workouts_kind unique (user_id, workout_id, activity_type);

-- ------------------------------------------------------------ run profile

create table arnold.run_profiles (
  user_id text not null references arnold.users (user_id) on delete cascade,
  seq bigint generated always as identity,
  run_profile_id text not null,
  goal text not null check (goal in ('fitness', '5k', '10k', 'half_marathon')),
  race_date text check (race_date ~ '^\d{4}-\d{2}-\d{2}$'),
  target_time_s integer check (target_time_s > 0),
  reference_distance_m integer check (reference_distance_m > 0),
  reference_time_s integer check (reference_time_s > 0),
  reference_date text check (reference_date ~ '^\d{4}-\d{2}-\d{2}$'),
  reference_source text check (reference_source in ('test', 'race', 'user')),
  running_experience_months integer check (running_experience_months >= 0),
  runs_per_week integer not null check (runs_per_week between 1 and 7),
  long_run_weekday integer check (long_run_weekday between 1 and 7),
  preferred_environment text not null
    check (preferred_environment in ('outdoor', 'treadmill', 'track')),
  base_minutes_per_week integer check (base_minutes_per_week >= 0),
  longest_run_4w_min integer check (longest_run_4w_min >= 0),
  alarm_settings jsonb,
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, run_profile_id),
  -- One profile per user.
  unique (user_id)
);

-- --------------------------------------------- run sessions of a plan version

create table arnold.plan_run_sessions (
  user_id text not null references arnold.users (user_id) on delete cascade,
  seq bigint generated always as identity,
  plan_run_session_id text not null,
  plan_version_id text not null,
  session_id text not null,
  session_order integer not null check (session_order > 0),
  session_name text not null,
  run_type text not null,
  template jsonb not null,
  preferred_weekday integer check (preferred_weekday between 1 and 7),
  status text not null check (status in ('active', 'removed')),
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, plan_run_session_id),
  unique (user_id, plan_version_id, session_id),
  foreign key (user_id, plan_version_id)
    references arnold.plan_versions (user_id, plan_version_id)
    deferrable initially deferred
);

-- ------------------------------------------------------------------- runs

create table arnold.runs (
  user_id text not null references arnold.users (user_id) on delete cascade,
  seq bigint generated always as identity,
  workout_id text not null,
  -- Always 'run'; with the foreign key below a run row can only belong to a
  -- workout of activity_type run.
  activity_type text not null default 'run' check (activity_type = 'run'),
  run_type text not null,
  environment text not null check (environment in ('outdoor', 'treadmill', 'track')),
  prescription jsonb,
  rationale text,
  rules_version text,
  timer_s integer check (timer_s >= 0),
  elapsed_s integer check (elapsed_s >= 0),
  distance_m integer check (distance_m >= 0),
  distance_source text check (distance_source in ('gps', 'sensor', 'corrected', 'manual')),
  ascent_m integer check (ascent_m >= 0),
  descent_m integer check (descent_m >= 0),
  cadence_spm integer check (cadence_spm > 0),
  calories_kcal integer check (calories_kcal >= 0),
  te_aerobic double precision check (te_aerobic between 0 and 5),
  te_anaerobic double precision check (te_anaerobic between 0 and 5),
  rpe integer check (rpe between 1 and 10),
  splits_100m jsonb,
  pause_count integer check (pause_count >= 0),
  result_source text check (result_source in ('watch', 'chat', 'screenshot')),
  -- Why heart-rate values are there or not ("NULL mit Grund").
  hr_status text check (hr_status in
    ('recorded', 'no_consent', 'no_sensor', 'not_provided', 'consent_revoked')),
  hr_avg_bpm integer check (hr_avg_bpm between 30 and 250),
  hr_max_bpm integer check (hr_max_bpm between 30 and 250),
  hr_zone_seconds jsonb,
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, workout_id),
  check ((hr_status = 'recorded') =
         (hr_avg_bpm is not null and hr_max_bpm is not null)),
  check (hr_zone_seconds is null or hr_status = 'recorded'),
  check (timer_s is null or elapsed_s is null or timer_s <= elapsed_s),
  foreign key (user_id, workout_id, activity_type)
    references arnold.workouts (user_id, workout_id, activity_type)
    deferrable initially deferred
);

-- One entry per executed segment, or per kilometre lap of a free run.
create table arnold.run_segments (
  user_id text not null references arnold.users (user_id) on delete cascade,
  seq bigint generated always as identity,
  run_segment_id text not null,
  workout_id text not null,
  segment_index integer not null check (segment_index between 0 and 79),
  repetition integer check (repetition between 1 and 50),
  kind text not null
    check (kind in ('warmup', 'work', 'recovery', 'cooldown', 'rest', 'lap')),
  planned_duration_type text check (planned_duration_type in ('open', 'seconds', 'meters')),
  planned_duration_value integer check (planned_duration_value >= 0),
  target_type text check (target_type in ('none', 'hr_zone', 'pace', 'hr_bpm', 'rpe')),
  target_low integer check (target_low >= 0),
  target_high integer check (target_high >= 0),
  timer_s integer not null check (timer_s >= 0),
  distance_m integer not null check (distance_m >= 0),
  time_in_target_s integer check (time_in_target_s >= 0),
  status text not null check (status in ('completed', 'skipped', 'ended_early')),
  hr_avg_bpm integer check (hr_avg_bpm between 30 and 250),
  hr_max_bpm integer check (hr_max_bpm between 30 and 250),
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, run_segment_id),
  unique (user_id, workout_id, segment_index),
  check ((hr_avg_bpm is null) = (hr_max_bpm is null)),
  foreign key (user_id, workout_id)
    references arnold.runs (user_id, workout_id)
    deferrable initially deferred
);

-- Heart-rate zone bounds from the Garmin profile (D-RUN-06), with the time
-- they were read. Only with consent; deleted on revocation, which is why the
-- server role may DELETE here (as for workout_health).
create table arnold.run_hr_zones (
  user_id text not null references arnold.users (user_id) on delete cascade,
  zones_id text not null,
  sport text not null check (sport in ('running', 'generic')),
  bounds integer[] not null check (
    cardinality(bounds) = 6
    and bounds[1] >= 30 and bounds[6] <= 250
    and bounds[1] < bounds[2] and bounds[2] < bounds[3]
    and bounds[3] < bounds[4] and bounds[4] < bounds[5]
    and bounds[5] < bounds[6]),
  recorded_at_utc text not null,
  workout_id text,
  primary key (user_id, zones_id),
  foreign key (user_id, workout_id)
    references arnold.runs (user_id, workout_id)
    on delete cascade
);
create index run_hr_zones_by_time on arnold.run_hr_zones (user_id, recorded_at_utc desc);

-- ------------------------------------------------------- heart-rate consent

-- Refuses heart-rate values unless the user's health consent is active.
-- Locks the consent row like the existing health upload, so a revocation
-- either waits for this write or the write sees the revocation.
create function arnold.require_health_consent() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_needed boolean;
begin
  -- Nested on purpose: NEW has no hr_* fields in run_hr_zones.
  if tg_table_name = 'run_hr_zones' then
    v_needed := true;
  elsif tg_table_name = 'runs' then
    v_needed := new.hr_avg_bpm is not null or new.hr_max_bpm is not null
                or new.hr_zone_seconds is not null;
  else
    v_needed := new.hr_avg_bpm is not null or new.hr_max_bpm is not null;
  end if;
  if v_needed then
    perform 1 from arnold.health_consents c
      where c.user_id = new.user_id and c.scope = 'garmin_health'
        and c.revoked_at is null
      for share;
    if not found then
      raise exception 'Heart-rate values need the health consent'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger runs_hr_consent before insert or update on arnold.runs
  for each row execute function arnold.require_health_consent();
create trigger run_segments_hr_consent before insert or update on arnold.run_segments
  for each row execute function arnold.require_health_consent();
create trigger run_hr_zones_consent before insert or update on arnold.run_hr_zones
  for each row execute function arnold.require_health_consent();

-- Erases the current user's heart-rate data of runs: zone bounds deleted,
-- values in runs and segments set to null with the reason consent_revoked.
-- Called in the same transaction as the revocation. updated_at_utc never
-- moves backwards (ISO strings in one format compare like times). Runs as the caller, so
-- row level security limits it to the current user.
create function arnold.erase_run_health() returns integer
  language plpgsql
  set search_path = ''
as $$
declare
  v_user text := arnold.current_user_id();
  v_rows integer;
  v_count integer := 0;
  v_now text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_user is null then
    raise exception 'No user' using errcode = '42501';
  end if;
  delete from arnold.run_hr_zones where user_id = v_user;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update arnold.runs
     set hr_status = 'consent_revoked', hr_avg_bpm = null, hr_max_bpm = null,
         hr_zone_seconds = null, row_revision = row_revision + 1,
         updated_at_utc = greatest(updated_at_utc, v_now)
   where user_id = v_user and hr_status = 'recorded';
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update arnold.run_segments
     set hr_avg_bpm = null, hr_max_bpm = null, row_revision = row_revision + 1,
         updated_at_utc = greatest(updated_at_utc, v_now)
   where user_id = v_user and hr_avg_bpm is not null;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  return v_count;
end
$$;
revoke all on function arnold.require_health_consent() from public;
revoke all on function arnold.erase_run_health() from public;
grant execute on function arnold.erase_run_health() to arnold_app;

-- ------------------------------------------------------- row level security

do $$
declare
  t text;
begin
  foreach t in array array[
    'run_profiles', 'plan_run_sessions', 'runs', 'run_segments', 'run_hr_zones'
  ] loop
    execute format('alter table arnold.%I enable row level security', t);
    execute format(
      'create policy own_rows on arnold.%I for all to arnold_app '
      'using (user_id = arnold.current_user_id()) '
      'with check (user_id = arnold.current_user_id())', t);
  end loop;
end
$$;

-- Like the training tables: no DELETE, no TRUNCATE, no DDL. Only the account
-- deletion removes these rows, through the cascade from arnold.users. The one
-- exception is run_hr_zones, which a consent revocation deletes.
grant select, insert, update on
  arnold.run_profiles, arnold.plan_run_sessions, arnold.runs, arnold.run_segments
  to arnold_app;
grant select, insert, delete on arnold.run_hr_zones to arnold_app;

-- The Supabase API roles get nothing on the new tables or functions.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on arnold.run_profiles, arnold.plan_run_sessions, arnold.runs, arnold.run_segments, arnold.run_hr_zones from %I', r);
      execute format('revoke all on function arnold.erase_run_health() from %I', r);
    end if;
  end loop;
end
$$;
