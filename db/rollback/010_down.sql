-- Undoes migration 010 (mat for the morning routine), back to schema
-- version 9.
--
-- Why it exists: the server starts only on exactly its expected schema
-- version, so after 010 an older revision (version 9) refuses to start. This
-- script makes the database fit such a revision again. Run it only with the
-- owner's explicit yes, with the owner connection, never at request time:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/rollback/010_down.sql
--
-- It DELETES the stored mat answer (column has_mat) and the write receipts
-- whose mobility profile row carries has_mat (an old server could not read
-- those receipts back). The rest of the mobility profile stays. Audit events
-- stay, as history. One transaction: all of it or nothing. Applying 010
-- again afterwards (npm run db:migrate) works. Tested in
-- tests/db-mobility.test.ts.
--
-- It is outside db/migrations on purpose: the migration runner must never
-- pick it up.

begin;

select pg_advisory_xact_lock(hashtext('arnold.migrate'));

do $$
begin
  if exists (select 1 from arnold.schema_migrations where version > 10) then
    raise exception 'Schema is newer than 10; undo the newer migrations first.';
  end if;
  if not exists (select 1 from arnold.schema_migrations where version = 10) then
    raise exception 'Migration 010 is not applied; nothing to undo.';
  end if;
end
$$;

delete from arnold.operations
 where jsonb_path_exists(changes,
   '$[*] ? (@.table == "mobilityProfiles"
            && (exists(@.after.has_mat) || exists(@.before.has_mat)))');

alter table arnold.mobility_profiles drop column has_mat;

delete from arnold.schema_migrations where version = 10;

commit;
