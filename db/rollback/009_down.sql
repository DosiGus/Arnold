-- Undoes migration 009 (mobility), back to schema version 8.
--
-- Why it exists: the server starts only on exactly its expected schema
-- version, so after 009 an older revision (version 8) refuses to start. This
-- script makes the database fit such a revision again. Run it only with the
-- owner's explicit yes, with the owner connection, never at request time:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/rollback/009_down.sql
--
-- It DELETES all mobility data: mobility profile, mobility routines of every
-- plan version, mobility results, every workout of activity_type mobility,
-- the column mobility_mark of the watch receipts and the write receipts that
-- refer to mobility (an old server could not read those receipts back).
-- Strength and running data are not touched. Audit events stay, as history.
-- One transaction: all of it or nothing. Applying 009 again afterwards
-- (npm run db:migrate) works. Tested in tests/db-mobility.test.ts.
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
  if exists (select 1 from arnold.schema_migrations where version > 9) then
    raise exception 'Schema is newer than 9; undo the newer migrations first.';
  end if;
  if not exists (select 1 from arnold.schema_migrations where version = 9) then
    raise exception 'Migration 009 is not applied; nothing to undo.';
  end if;
end
$$;

-- Receipts of writes that touched mobility data.
delete from arnold.operations
 where jsonb_path_exists(changes,
   '$[*] ? (@.table == "mobilityProfiles" || @.table == "planMobilitySessions"
            || @.table == "mobilityResults"
            || @.after.activity_type == "mobility")');

-- Results first: they refer to the mobility workouts.
delete from arnold.mobility_results;
-- Mobility workouts would break the restored check below. They never have
-- sets.
delete from arnold.workouts where activity_type = 'mobility';
delete from arnold.plan_mobility_sessions;
delete from arnold.mobility_profiles;

drop table arnold.mobility_results;
drop table arnold.plan_mobility_sessions;
drop table arnold.mobility_profiles;

alter table arnold.watch_plan_receipts drop column mobility_mark;

alter table arnold.workouts drop constraint workouts_mobility_not_in_progress;
alter table arnold.workouts drop constraint workouts_activity_type_check;
alter table arnold.workouts
  add constraint workouts_activity_type_check
    check (activity_type in ('strength', 'run'));

delete from arnold.schema_migrations where version = 9;

commit;
