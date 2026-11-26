-- Undoes migration 011 (plan explanation), back to schema version 10.
--
-- Why it exists: the server starts only on exactly its expected schema
-- version, so after 011 an older revision (version 10) refuses to start. This
-- script makes the database fit such a revision again. Run it only with the
-- owner's explicit yes, with the owner connection, never at request time:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/rollback/011_down.sql
--
-- It DELETES the stored plan explanations (column explanation) and the write
-- receipts whose plan row carries one (an old server could not read those
-- receipts back). The plans themselves stay. Audit events stay, as history.
-- One transaction: all of it or nothing. Applying 011 again afterwards
-- (npm run db:migrate) works. Tested in tests/db-plan-explanation.test.ts.
--
-- It is outside db/migrations on purpose: the migration runner must never
-- pick it up.

begin;

select pg_advisory_xact_lock(hashtext('arnold.migrate'));

do $$
begin
  if exists (select 1 from arnold.schema_migrations where version > 11) then
    raise exception 'Schema is newer than 11; undo the newer migrations first.';
  end if;
  if not exists (select 1 from arnold.schema_migrations where version = 11) then
    raise exception 'Migration 011 is not applied; nothing to undo.';
  end if;
end
$$;

delete from arnold.operations
 where jsonb_path_exists(changes,
   '$[*] ? (@.table == "plans"
            && (exists(@.after.explanation) || exists(@.before.explanation)))');

alter table arnold.plan_versions drop column explanation;

delete from arnold.schema_migrations where version = 11;

commit;
