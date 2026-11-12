-- Undoes migration 004 (running), back to schema version 3.
--
-- Why it exists: the server starts only on exactly its expected schema
-- version, so after 004 an older revision (version 3) refuses to start. This
-- script makes the database fit such a revision again. Run it only with the
-- owner's explicit yes, with the owner connection, never at request time:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/rollback/004_down.sql
--
-- It DELETES all running data: run profile, run sessions, runs, segments,
-- heart-rate zones, every workout of activity_type run (planned or done) and
-- the write receipts that refer to them (an old server could not read those
-- receipts back). Strength data is not touched. Audit events stay, as
-- history. One transaction: all of it or nothing. Applying 004 again
-- afterwards (npm run db:migrate) works. Tested in tests/db-run.test.ts.
--
-- It is outside db/migrations on purpose: the migration runner must never
-- pick it up.

begin;

select pg_advisory_xact_lock(hashtext('arnold.migrate'));
-- Checks the deferred foreign keys at once, so the ALTER TABLE below does
-- not meet pending trigger events of the deletes.
set constraints all immediate;

do $$
begin
  if exists (select 1 from arnold.schema_migrations where version > 4) then
    raise exception 'Schema is newer than 4; undo the newer migrations first.';
  end if;
  if not exists (select 1 from arnold.schema_migrations where version = 4) then
    raise exception 'Migration 004 is not applied; nothing to undo.';
  end if;
end
$$;

-- Receipts of writes that touched running data.
delete from arnold.operations
 where jsonb_path_exists(changes,
   '$[*] ? (@.table == "runProfiles" || @.table == "planRunSessions"
            || @.table == "runs" || @.table == "runSegments"
            || @.after.activity_type == "run")');

drop table arnold.run_hr_zones;
drop table arnold.run_segments;
drop table arnold.runs;
drop table arnold.plan_run_sessions;
drop table arnold.run_profiles;
drop function arnold.erase_run_health();
drop function arnold.require_health_consent();

-- Run workouts (planned or done) would look like empty strength workouts to
-- a version 3 server. They never have sets.
delete from arnold.workouts where activity_type = 'run';

alter table arnold.workouts drop constraint workouts_kind;
alter table arnold.workouts drop constraint workouts_run_not_in_progress;
alter table arnold.workouts drop column activity_type;

delete from arnold.schema_migrations where version = 4;

commit;
