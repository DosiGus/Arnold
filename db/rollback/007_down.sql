-- Undoes migration 007 (adjustments for a while), back to schema version 6.
--
-- Why it exists: the server starts only on exactly its expected schema
-- version, so after 007 an older revision (version 6) refuses to start. Run
-- it only with the owner's explicit yes, with the owner connection, never at
-- request time:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/rollback/007_down.sql
--
-- It DELETES every adjustment and its temporary plan version with their
-- positions. Workouts trained on a temporary version keep their sets but lose
-- the link to that version (plan_version_id and session_id become null), so
-- the older revision reads them as free workouts. One transaction: all of it
-- or nothing. Tested in tests/db-plan-adjustments.test.ts.
--
-- It is outside db/migrations on purpose: the migration runner must never
-- pick it up.

begin;

select pg_advisory_xact_lock(hashtext('arnold.migrate'));

do $$
begin
  if exists (select 1 from arnold.schema_migrations where version > 7) then
    raise exception 'Schema is newer than 7; undo the newer migrations first.';
  end if;
  if not exists (select 1 from arnold.schema_migrations where version = 7) then
    raise exception 'Migration 007 is not applied; nothing to undo.';
  end if;
end
$$;

drop table arnold.plan_adjustments;

update arnold.workouts w
   set plan_version_id = null, session_id = null
  from arnold.plan_versions p
 where p.user_id = w.user_id and p.plan_version_id = w.plan_version_id
   and p.status = 'temporary';
delete from arnold.plan_items i
 using arnold.plan_versions p
 where p.user_id = i.user_id and p.plan_version_id = i.plan_version_id
   and p.status = 'temporary';
delete from arnold.plan_versions where status = 'temporary';
-- Check the deferred references now, before the table is altered.
set constraints all immediate;

alter table arnold.plan_versions drop constraint plan_versions_temporary_lifecycle;
alter table arnold.plan_versions drop constraint plan_versions_status_check;
alter table arnold.plan_versions
  add constraint plan_versions_status_check
    check (status in ('draft', 'active', 'archived'));

delete from arnold.schema_migrations where version = 7;

commit;
