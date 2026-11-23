-- Mobility (ARN-MOB): mobility profile, mobility routines of a plan version
-- and the results of done routines. Raw data schema arnold.training_raw 1.2.0.
--
-- Additive. Same rules as 001–008: every row belongs to one user, row level
-- security (policy own_rows) lets only that user's rows through, every
-- reference includes user_id, and the account deletion removes everything
-- through the cascade from arnold.users. Column names follow
-- src/shared/arnold-schema-v1.ts; value rules beyond the checks below are
-- enforced by the Zod schema on every write.
--
-- A mobility routine is a workout of activity_type mobility with no sets. It
-- is stored only once it is over: never planned, never in progress. It is no
-- training day and no load (D-MOB-08). No heart rate is stored for it, so no
-- consent trigger is needed. This migration changes no existing row.
--
-- Undo: db/rollback/009_down.sql (only with the owner's explicit yes).

-- --------------------------------------------------------------- workouts

-- The inline check of 004 got the name Postgres gives a column check.
alter table arnold.workouts drop constraint workouts_activity_type_check;
alter table arnold.workouts
  add constraint workouts_activity_type_check
    check (activity_type in ('strength', 'run', 'mobility'));
-- A routine is saved when it is done (or ended early), like a run, and is
-- never a plan entry of its own: the plan holds plan_mobility_sessions.
alter table arnold.workouts
  add constraint workouts_mobility_not_in_progress
    check (activity_type <> 'mobility'
           or status not in ('planned', 'in_progress'));

-- ------------------------------------------------------- mobility profile

create table arnold.mobility_profiles (
  user_id text not null references arnold.users (user_id) on delete cascade,
  seq bigint generated always as identity,
  mobility_profile_id text not null,
  wants boolean not null,
  morning_weekdays integer[] check (
    morning_weekdays is null or (
      cardinality(morning_weekdays) between 1 and 7
      and array_position(morning_weekdays, null) is null
      and 1 <= all (morning_weekdays) and 7 >= all (morning_weekdays))),
  morning_minutes integer check (morning_minutes in (5, 10, 15)),
  sessions_placement text
    check (sessions_placement in ('own_days', 'after_strength', 'arnold_decides')),
  sessions_per_week integer check (sessions_per_week between 1 and 3),
  sessions_minutes integer check (sessions_minutes in (15, 20, 30)),
  stiff_areas text[] not null default '{}' check (
    cardinality(stiff_areas) <= 8
    and array_position(stiff_areas, null) is null
    and stiff_areas <@ array['neck', 'shoulders', 'upper_back', 'lower_back',
                             'hips', 'hamstrings', 'calves_ankles', 'wrists']),
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, mobility_profile_id),
  -- One profile per user.
  unique (user_id),
  -- Morning: weekdays and minutes together or not at all.
  constraint mobility_profiles_morning_together
    check ((morning_weekdays is null) = (morning_minutes is null)),
  -- Sessions: placement, count and minutes together or not at all.
  constraint mobility_profiles_sessions_together
    check ((sessions_placement is null) = (sessions_per_week is null)
           and (sessions_placement is null) = (sessions_minutes is null)),
  -- No wish, no details.
  constraint mobility_profiles_no_wish_no_details
    check (wants or (morning_weekdays is null and morning_minutes is null
                     and sessions_placement is null and sessions_per_week is null
                     and sessions_minutes is null
                     and cardinality(stiff_areas) = 0)),
  -- A wish needs a morning routine or sessions.
  constraint mobility_profiles_wish_has_details
    check (not wants or morning_minutes is not null
           or sessions_placement is not null)
);

-- ------------------------------------- mobility routines of a plan version

-- Shares the session_id space of the version with plan_items and
-- plan_run_sessions (checked by the Zod dataset schema on every write).
create table arnold.plan_mobility_sessions (
  user_id text not null references arnold.users (user_id) on delete cascade,
  seq bigint generated always as identity,
  plan_mobility_session_id text not null,
  plan_version_id text not null,
  session_id text not null,
  session_order integer not null check (session_order > 0),
  session_name text not null,
  kind text not null check (kind in ('morning', 'session')),
  placement text not null check (placement in ('own_day', 'after_strength')),
  weekdays integer[] not null check (
    cardinality(weekdays) <= 7
    and array_position(weekdays, null) is null
    and 1 <= all (weekdays) and 7 >= all (weekdays)),
  -- The strength session of the same version this routine follows.
  after_session_id text,
  minutes integer not null check (minutes > 0),
  template jsonb not null,
  status text not null check (status in ('active', 'removed')),
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, plan_mobility_session_id),
  unique (user_id, plan_version_id, session_id),
  foreign key (user_id, plan_version_id)
    references arnold.plan_versions (user_id, plan_version_id)
    deferrable initially deferred,
  constraint plan_mobility_sessions_morning_shape
    check (kind <> 'morning' or (
      minutes in (5, 10, 15)
      and cardinality(weekdays) between 1 and 7
      and placement = 'own_day'
      and after_session_id is null)),
  constraint plan_mobility_sessions_session_minutes
    check (kind <> 'session' or minutes in (15, 20, 30)),
  constraint plan_mobility_sessions_own_day_shape
    check (kind <> 'session' or placement <> 'own_day' or (
      cardinality(weekdays) = 1 and after_session_id is null)),
  constraint plan_mobility_sessions_after_strength_shape
    check (placement <> 'after_strength' or (
      cardinality(weekdays) = 0 and after_session_id is not null))
);
-- At most one active morning routine per plan version.
create unique index plan_mobility_sessions_one_morning
  on arnold.plan_mobility_sessions (user_id, plan_version_id)
  where kind = 'morning' and status = 'active';

-- ------------------------------------------------------- mobility results

create table arnold.mobility_results (
  user_id text not null references arnold.users (user_id) on delete cascade,
  seq bigint generated always as identity,
  workout_id text not null,
  -- Always 'mobility'; with the foreign key below a result can only belong
  -- to a workout of activity_type mobility.
  activity_type text not null default 'mobility' check (activity_type = 'mobility'),
  kind text not null check (kind in ('morning', 'session')),
  plan_version_id text,
  session_id text,
  minutes_planned integer check (minutes_planned > 0),
  timer_s integer check (timer_s >= 0),
  elapsed_s integer check (elapsed_s >= 0),
  exercises_total integer not null check (exercises_total between 0 and 20),
  exercises_done integer not null check (exercises_done between 0 and 20),
  exercises_skipped integer not null check (exercises_skipped between 0 and 20),
  ended_early boolean not null default false,
  items jsonb not null,
  result_source text not null check (result_source in ('watch', 'chat')),
  catalog_version text not null,
  rules_version text not null,
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, workout_id),
  check (timer_s is null or elapsed_s is null or timer_s <= elapsed_s),
  constraint mobility_results_counts
    check (exercises_done + exercises_skipped <= exercises_total),
  -- Only a routine ended early may fall short of its total (orchestrator
  -- decision 22.11.).
  constraint mobility_results_complete_unless_ended_early
    check (ended_early or exercises_done + exercises_skipped = exercises_total),
  -- The constraint workouts_kind of 004.
  foreign key (user_id, workout_id, activity_type)
    references arnold.workouts (user_id, workout_id, activity_type)
    deferrable initially deferred
);

-- ------------------------------------------------------- watch receipts

-- The mark over the mobility part the watch confirmed (like plan_mark).
alter table arnold.watch_plan_receipts
  add column mobility_mark text check (mobility_mark ~ '^[0-9a-f]{16}$');

-- ------------------------------------------------------- row level security

do $$
declare
  t text;
begin
  foreach t in array array[
    'mobility_profiles', 'plan_mobility_sessions', 'mobility_results'
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
-- deletion removes these rows, through the cascade from arnold.users.
grant select, insert, update on
  arnold.mobility_profiles, arnold.plan_mobility_sessions, arnold.mobility_results
  to arnold_app;

-- The Supabase API roles get nothing on the new tables.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on arnold.mobility_profiles, arnold.plan_mobility_sessions, arnold.mobility_results from %I', r);
    end if;
  end loop;
end
$$;
