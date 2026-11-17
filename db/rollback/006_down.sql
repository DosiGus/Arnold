-- Undoes migration 006 (watch plan receipts), back to schema version 5.
--
-- Why it exists: the server starts only on exactly its expected schema
-- version, so after 006 an older revision (version 5) refuses to start. Run
-- it only with the owner's explicit yes, with the owner connection, never at
-- request time:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/rollback/006_down.sql
--
-- It DELETES the confirmed plan marks of all watches; the status then shows
-- "unknown" until the watches confirm again. Nothing else is touched. One
-- transaction: all of it or nothing. Applying 006 again afterwards
-- (npm run db:migrate) works. Tested in tests/db-watch-receipts.test.ts.
--
-- It is outside db/migrations on purpose: the migration runner must never
-- pick it up.

begin;

select pg_advisory_xact_lock(hashtext('arnold.migrate'));

do $$
begin
  if exists (select 1 from arnold.schema_migrations where version > 6) then
    raise exception 'Schema is newer than 6; undo the newer migrations first.';
  end if;
  if not exists (select 1 from arnold.schema_migrations where version = 6) then
    raise exception 'Migration 006 is not applied; nothing to undo.';
  end if;
end
$$;

drop table arnold.watch_plan_receipts;

delete from arnold.schema_migrations where version = 6;

commit;
