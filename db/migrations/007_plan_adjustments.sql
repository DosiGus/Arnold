-- Adjustment for a while (UX-008): a time-limited change over the active plan,
-- e.g. "only 20 minutes today", "little time this week", a holiday.
--
-- The adjustment never touches the active plan. Its sessions live in a plan
-- version of their own with the new status 'temporary': never activatable,
-- never a draft, frozen from the moment it is written. A row in
-- arnold.plan_adjustments says for which local calendar days (start and end
-- both inclusive, in the zone stored with it) that version replaces the
-- active plan for training. After the last day the normal plan applies again
-- without any write. Changing an adjustment means cancelling it and creating
-- a new one.
--
-- Additive. Same rules as 001–006: every row belongs to one user, row level
-- security (policy own_rows) lets only that user's rows through, every
-- reference includes user_id, and the account deletion removes everything
-- through the cascade from arnold.users. Rows are never deleted one by one.
-- Overlaps between confirmed adjustments are refused by the plan service and
-- the data contract (src/shared/arnold-schema-v1.ts), inside the per-user
-- write lock.
--
-- Undo: db/rollback/007_down.sql (only with the owner's explicit yes).

alter table arnold.plan_versions
  drop constraint plan_versions_status_check;
alter table arnold.plan_versions
  add constraint plan_versions_status_check
    check (status in ('draft', 'active', 'archived', 'temporary'));
-- A temporary version is never activated nor retired.
alter table arnold.plan_versions
  add constraint plan_versions_temporary_lifecycle
    check (status <> 'temporary' or (activated_at_utc is null and retired_at_utc is null));

create table arnold.plan_adjustments (
  user_id text not null references arnold.users (user_id) on delete cascade,
  -- Insertion order, so lists read back in the order they were written.
  seq bigint generated always as identity,
  plan_adjustment_id text not null,
  plan_version_id text not null,
  base_plan_version_id text not null,
  kind text not null check (kind in ('today', 'week', 'month', 'range')),
  start_date_local text not null check (start_date_local ~ '^\d{4}-\d{2}-\d{2}$'),
  end_date_local text not null check (end_date_local ~ '^\d{4}-\d{2}-\d{2}$'),
  timezone text not null,
  minutes_per_session integer check (minutes_per_session between 10 and 180),
  sessions_per_week integer check (sessions_per_week between 1 and 7),
  reason text,
  status text not null check (status in ('draft', 'confirmed', 'cancelled')),
  confirmed_at_utc text,
  cancelled_at_utc text,
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, plan_adjustment_id),
  -- One adjustment per temporary version.
  unique (user_id, plan_version_id),
  check (end_date_local >= start_date_local),
  check (status <> 'confirmed' or confirmed_at_utc is not null),
  check (status <> 'cancelled' or cancelled_at_utc is not null),
  foreign key (user_id, plan_version_id)
    references arnold.plan_versions (user_id, plan_version_id)
    deferrable initially deferred,
  foreign key (user_id, base_plan_version_id)
    references arnold.plan_versions (user_id, plan_version_id)
    deferrable initially deferred
);
create index on arnold.plan_adjustments (user_id, start_date_local);

alter table arnold.plan_adjustments enable row level security;
create policy own_rows on arnold.plan_adjustments for all to arnold_app
  using (user_id = arnold.current_user_id())
  with check (user_id = arnold.current_user_id());

-- Like the training tables: no DELETE, no TRUNCATE, no DDL.
grant select, insert, update on arnold.plan_adjustments to arnold_app;

-- Private table: never reachable through Supabase's API roles.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on arnold.plan_adjustments from %I', r);
    end if;
  end loop;
end $$;
