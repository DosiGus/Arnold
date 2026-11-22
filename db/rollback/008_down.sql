-- Undoes migration 008 (extended daily health values), back to schema
-- version 7.
--
-- Why it exists: the server starts only on exactly its expected schema
-- version, so after 008 an older revision (version 7) refuses to start. Run
-- it only with the owner's explicit yes, with the owner connection, never at
-- request time:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/rollback/008_down.sql
--
-- It DELETES the raw Garmin answers, the new columns of arnold.health_daily
-- with all their values and the endpoint outcomes. The values of 005
-- (resting heart rate, stress, Body Battery, sleep, HRV) stay. One
-- transaction: all of it or nothing. Applying 008 again afterwards
-- (npm run db:migrate) works. Tested in tests/db-health-daily.test.ts.
--
-- It is outside db/migrations on purpose: the migration runner must never
-- pick it up.

begin;

select pg_advisory_xact_lock(hashtext('arnold.migrate'));

do $$
begin
  if exists (select 1 from arnold.schema_migrations where version > 8) then
    raise exception 'Schema is newer than 8; undo the newer migrations first.';
  end if;
  if not exists (select 1 from arnold.schema_migrations where version = 8) then
    raise exception 'Migration 008 is not applied; nothing to undo.';
  end if;
end
$$;

-- The function of 005 again (without the raw table).
create or replace function arnold.erase_health_daily_on_revoke() returns trigger
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

drop table arnold.health_daily_raw;

alter table arnold.health_daily_sync drop column endpoint_outcomes;

alter table arnold.health_daily
  drop column sleep_deep_seconds, drop column sleep_light_seconds,
  drop column sleep_rem_seconds, drop column sleep_awake_seconds,
  drop column sleep_awake_count, drop column sleep_restless_moments,
  drop column sleep_start_local, drop column sleep_end_local,
  drop column respiration_sleep_avg, drop column respiration_sleep_low,
  drop column respiration_sleep_high, drop column respiration_day_avg,
  drop column respiration_day_low, drop column respiration_day_high,
  drop column spo2_avg_pct, drop column spo2_min_pct,
  drop column steps, drop column step_goal,
  drop column intensity_minutes_moderate, drop column intensity_minutes_vigorous,
  drop column floors_climbed, drop column kcal_active, drop column kcal_total,
  drop column distance_m, drop column skin_temp_deviation_c,
  drop column vo2max_running, drop column vo2max_cycling,
  drop column fitness_age, drop column chronological_age,
  drop column training_readiness_score, drop column training_readiness_level,
  drop column training_status, drop column acute_load,
  drop column chronic_load, drop column load_ratio;

delete from arnold.schema_migrations where version = 8;

commit;
