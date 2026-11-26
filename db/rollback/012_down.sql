-- Undoes migration 012 (running goals), back to schema version 11.
--
-- Why it exists: the server starts only on exactly its expected schema
-- version, so after 012 an older revision (version 11) refuses to start. This
-- script makes the database fit such a revision again. Run it only with the
-- owner's explicit yes, with the owner connection, never at request time:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f db/rollback/012_down.sql
--
-- It DELETES every running goal (kinds run_distance, run_duration,
-- run_time_for_distance) and the write receipts whose goal row is one (an old
-- server could not read those receipts back). Body weight and exercise goals
-- stay. Audit events stay, as history. One transaction: all of it or nothing.
-- Applying 012 again afterwards (npm run db:migrate) works. Tested in
-- tests/db-run-goals.test.ts.
--
-- It is outside db/migrations on purpose: the migration runner must never
-- pick it up.

begin;

select pg_advisory_xact_lock(hashtext('arnold.migrate'));

do $$
begin
  if exists (select 1 from arnold.schema_migrations where version > 12) then
    raise exception 'Schema is newer than 12; undo the newer migrations first.';
  end if;
  if not exists (select 1 from arnold.schema_migrations where version = 12) then
    raise exception 'Migration 012 is not applied; nothing to undo.';
  end if;
end
$$;

delete from arnold.operations
 where jsonb_path_exists(changes,
   '$[*] ? (@.table == "goals"
            && (@.after.kind starts with "run_" || @.before.kind starts with "run_"))');

delete from arnold.goals
 where kind in ('run_distance', 'run_time_for_distance', 'run_duration');

drop index arnold.goals_one_active;
create unique index goals_one_active
  on arnold.goals (user_id, kind, coalesce(exercise_id, ''))
  where status = 'active';

alter table arnold.goals drop constraint goals_run_distance_kind;
alter table arnold.goals drop constraint goals_exercise_kind;
alter table arnold.goals
  add constraint goals_check
    check ((kind = 'body_weight') = (exercise_id is null));
alter table arnold.goals drop constraint goals_kind_check;
alter table arnold.goals
  add constraint goals_kind_check
    check (kind in ('body_weight', 'exercise_load', 'exercise_reps'));

alter table arnold.goals drop column run_distance_m;

delete from arnold.schema_migrations where version = 12;

commit;
