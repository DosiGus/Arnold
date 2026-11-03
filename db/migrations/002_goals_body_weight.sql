-- Goals and body weight (dashboard "Ziele").
--
-- Same rules as the training tables in 001: every row belongs to one user,
-- row level security lets only that user's rows through, every reference
-- includes user_id, and rows are never deleted one by one (a goal is archived,
-- a measurement voided). Column names follow src/shared/arnold-schema-v1.ts.

create table arnold.goals (
  user_id text not null references arnold.users (user_id) on delete cascade,
  -- Insertion order, so lists read back in the order they were written.
  seq bigint generated always as identity,
  goal_id text not null,
  kind text not null
    check (kind in ('body_weight', 'exercise_load', 'exercise_reps')),
  exercise_id text,
  load_basis text,
  target_value double precision not null check (target_value > 0),
  start_value double precision check (start_value >= 0),
  status text not null check (status in ('active', 'archived')),
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, goal_id),
  check ((kind = 'body_weight') = (exercise_id is null)),
  check ((kind = 'exercise_load') = (load_basis is not null)),
  foreign key (user_id, exercise_id)
    references arnold.exercises (user_id, exercise_id)
    deferrable initially deferred
);
-- One active goal per kind and exercise. coalesce: a body weight goal has no
-- exercise, and null never collides in a unique index.
create unique index goals_one_active
  on arnold.goals (user_id, kind, coalesce(exercise_id, ''))
  where status = 'active';

create table arnold.body_weights (
  user_id text not null references arnold.users (user_id) on delete cascade,
  -- Insertion order, so lists read back in the order they were written.
  seq bigint generated always as identity,
  body_weight_id text not null,
  measured_on text not null check (measured_on ~ '^\d{4}-\d{2}-\d{2}$'),
  weight_kg double precision not null check (weight_kg between 20 and 400),
  status text not null check (status in ('active', 'voided')),
  source text not null,
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, body_weight_id)
);
-- At most one valid measurement per day; a new one voids the old one first.
create unique index body_weights_one_per_day
  on arnold.body_weights (user_id, measured_on)
  where status = 'active';

do $$
declare
  t text;
begin
  foreach t in array array['goals', 'body_weights'] loop
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
grant select, insert, update on arnold.goals, arnold.body_weights to arnold_app;

-- The Supabase API roles get nothing on the new tables either.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on arnold.goals, arnold.body_weights from %I', r);
    end if;
  end loop;
end
$$;
