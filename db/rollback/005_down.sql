-- Undoes migration 005 (daily health values), back to schema version 4.
--
-- Why it exists: the server starts only on exactly its expected schema
-- version, so after 005 an older revision (version 4) refuses to start. Run
-- it only with the owner's explicit yes, with the owner connection, never at
-- request time:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/rollback/005_down.sql
--
-- It DELETES all daily health values and the fetch state. Nothing else is
-- touched. One transaction: all of it or nothing. Applying 005 again
-- afterwards (npm run db:migrate) works. Tested in tests/db-health-daily.test.ts.
--
-- It is outside db/migrations on purpose: the migration runner must never
-- pick it up.

begin;

select pg_advisory_xact_lock(hashtext('arnold.migrate'));

do $$
begin
  if exists (select 1 from arnold.schema_migrations where version > 5) then
    raise exception 'Schema is newer than 5; undo the newer migrations first.';
  end if;
  if not exists (select 1 from arnold.schema_migrations where version = 5) then
    raise exception 'Migration 005 is not applied; nothing to undo.';
  end if;
end
$$;

drop trigger health_consents_erase_daily on arnold.health_consents;
drop table arnold.health_daily_sync;
drop table arnold.health_daily;
drop function arnold.erase_health_daily_on_revoke();
drop function arnold.require_daily_health_consent();

delete from arnold.schema_migrations where version = 5;

commit;
