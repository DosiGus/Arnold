-- Running goals (26.11.2026): Arnold tracks runs, so goals can be about them.
--
--   run_distance           kilometres in one run         target_value in km
--   run_duration           minutes in one run            target_value in min
--   run_time_for_distance  time for a fixed distance     target_value in s,
--                                                        run_distance_m in m
--
-- Additive. Existing goals keep every value; the new column is nullable and
-- without a default (null for every kind but run_time_for_distance). Column
-- names follow src/shared/arnold-schema-v1.ts.
--
-- The column belongs to arnold.goals, so row level security (policy own_rows
-- of 002) covers it unchanged, and arnold_app keeps its table grants (select,
-- insert, update), which include new columns. Every reference still carries
-- user_id; run goals have no exercise.
--
-- Undo: db/rollback/012_down.sql (only with the owner's explicit yes).

alter table arnold.goals add column run_distance_m integer
  check (run_distance_m between 100 and 100000);

-- The inline check of 002 got the name Postgres gives a column check.
alter table arnold.goals drop constraint goals_kind_check;
alter table arnold.goals
  add constraint goals_kind_check
    check (kind in ('body_weight', 'exercise_load', 'exercise_reps',
                    'run_distance', 'run_time_for_distance', 'run_duration'));

-- 002 tied "has an exercise" to "is not body_weight" (unnamed table check,
-- goals_check). Run goals have no exercise either.
alter table arnold.goals drop constraint goals_check;
alter table arnold.goals
  add constraint goals_exercise_kind
    check ((kind in ('exercise_load', 'exercise_reps')) = (exercise_id is not null));
alter table arnold.goals
  add constraint goals_run_distance_kind
    check ((kind = 'run_time_for_distance') = (run_distance_m is not null));

-- One active goal per kind, exercise and (for time goals) distance: 5 km under
-- 25 minutes and 10 km under 55 minutes can run side by side.
drop index arnold.goals_one_active;
create unique index goals_one_active
  on arnold.goals (user_id, kind, coalesce(exercise_id, ''),
                   coalesce(run_distance_m, 0))
  where status = 'active';
