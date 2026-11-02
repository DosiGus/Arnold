-- Arnold database schema, version 1.
--
-- Run by the migration runner (src/server/db/migrate.ts) as the database
-- owner, never by the server at request time. On Supabase that is the
-- `postgres` role.
--
-- How user data stays separate:
--
--   1. Everything lives in the schema `arnold`, which is not exposed through
--      Supabase's Data API (only `public` is), and the API roles `anon` and
--      `authenticated` get no rights on it.
--   2. The server connects as `arnold_app`: no superuser, no BYPASSRLS, not
--      the owner of any table. It can only reach rows through the policies
--      below.
--   3. Every user table carries `user_id`, and its policy only lets through
--      rows whose `user_id` equals `arnold.current_user_id()`. The server sets
--      that value per transaction from the verified login token, never from a
--      tool argument. Without it, every user table looks empty.
--   4. Every reference between user tables includes `user_id`, so a row can
--      never point at another user's workout, plan or exercise.
--
-- Account lookup by login (issuer, subject) has to happen before the user is
-- known, so it runs through one SECURITY DEFINER function instead of giving
-- the server role read access to all accounts.

create schema if not exists arnold;
revoke all on schema arnold from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'arnold_app') then
    -- The password is set separately (scripts/db-setup.sh); it never appears
    -- in a migration.
    create role arnold_app login nobypassrls nocreatedb nocreaterole noinherit;
  end if;
end
$$;

grant usage on schema arnold to arnold_app;

-- The verified user of the current transaction. Empty means nobody.
create function arnold.current_user_id() returns text
  language sql stable
  set search_path = ''
as $$
  select nullif(current_setting('arnold.user_id', true), '')
$$;

-- ------------------------------------------------------------------ accounts

create table arnold.users (
  user_id text primary key
    check (user_id ~ '^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  tracker_id text not null unique default ('trk_' || gen_random_uuid()::text),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One Arnold user per login identity. Never keyed by email address.
create table arnold.identity_connections (
  connection_id text primary key default ('idc_' || gen_random_uuid()::text),
  user_id text not null references arnold.users (user_id) on delete cascade,
  issuer text not null check (issuer <> ''),
  subject text not null check (subject <> ''),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (issuer, subject)
);
create index on arnold.identity_connections (user_id);

-- ------------------------------------------------------------ training data
--
-- Column names and meanings follow src/shared/arnold-schema-v1.ts exactly.
-- Timestamps and calendar dates are stored as the literal strings the app
-- wrote ("2026-11-02T10:00:00.000Z", "2026-11-02"): a calendar day is never
-- derived from a UTC instant, and a stored row must read back unchanged.
-- Value checks (enums, ranges) live in the Zod schema, which validates every
-- write before it reaches the database.

create table arnold.exercises (
  user_id text not null references arnold.users (user_id) on delete cascade,
  -- Insertion order, so lists read back in the order they were written.
  seq bigint generated always as identity,
  exercise_id text not null,
  name_de text not null,
  name_en text,
  family_key text not null,
  variant_key text not null,
  equipment text not null,
  primary_muscle text not null,
  default_load_basis text not null,
  default_execution_mode text not null,
  default_implement_count integer not null,
  status text not null,
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, exercise_id)
);

create table arnold.plan_versions (
  user_id text not null references arnold.users (user_id) on delete cascade,
  -- Insertion order, so lists read back in the order they were written.
  seq bigint generated always as identity,
  plan_version_id text not null,
  plan_family_id text not null,
  version_no integer not null check (version_no > 0),
  name text not null,
  split_key text,
  status text not null check (status in ('draft', 'active', 'archived')),
  goal_key text,
  days_per_week integer,
  activated_at_utc text,
  retired_at_utc text,
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, plan_version_id),
  unique (user_id, plan_family_id, version_no)
);
-- At most one active plan per user.
create unique index plan_versions_one_active
  on arnold.plan_versions (user_id) where status = 'active';

create table arnold.plan_items (
  user_id text not null references arnold.users (user_id) on delete cascade,
  -- Insertion order, so lists read back in the order they were written.
  seq bigint generated always as identity,
  plan_item_id text not null,
  plan_version_id text not null,
  session_id text not null,
  session_order integer not null,
  session_name text not null,
  exercise_id text not null,
  exercise_order integer not null,
  target_sets integer,
  rep_min integer,
  rep_max integer,
  target_load_kg double precision,
  target_load_basis text,
  target_execution_mode text,
  target_implement_count integer,
  rest_seconds integer,
  notes text,
  status text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, plan_item_id),
  foreign key (user_id, plan_version_id)
    references arnold.plan_versions (user_id, plan_version_id)
    deferrable initially deferred,
  foreign key (user_id, exercise_id)
    references arnold.exercises (user_id, exercise_id)
    deferrable initially deferred
);

create table arnold.workouts (
  user_id text not null references arnold.users (user_id) on delete cascade,
  -- Insertion order, so lists read back in the order they were written.
  seq bigint generated always as identity,
  workout_id text not null,
  workout_date_local text not null check (workout_date_local ~ '^\d{4}-\d{2}-\d{2}$'),
  timezone text not null,
  started_at_utc text,
  ended_at_utc text,
  plan_version_id text,
  session_id text,
  session_name_snapshot text,
  status text not null,
  source text not null,
  notes text,
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, workout_id),
  foreign key (user_id, plan_version_id)
    references arnold.plan_versions (user_id, plan_version_id)
    deferrable initially deferred
);
create index on arnold.workouts (user_id, workout_date_local);

create table arnold.sets (
  user_id text not null references arnold.users (user_id) on delete cascade,
  -- Insertion order, so lists read back in the order they were written.
  seq bigint generated always as identity,
  set_id text not null,
  workout_id text not null,
  exercise_id text not null,
  plan_item_id text,
  exercise_name_snapshot text not null,
  exercise_order integer not null,
  set_number integer not null,
  set_type text not null,
  reps integer not null,
  reps_basis text not null,
  load_kg double precision,
  load_basis text not null,
  implement_count integer not null,
  execution_mode text not null,
  side text not null,
  rpe double precision,
  rir integer,
  notes text,
  status text not null,
  source text not null,
  created_at_utc text not null,
  updated_at_utc text not null,
  row_revision integer not null check (row_revision > 0),
  primary key (user_id, set_id),
  foreign key (user_id, workout_id)
    references arnold.workouts (user_id, workout_id)
    deferrable initially deferred,
  foreign key (user_id, exercise_id)
    references arnold.exercises (user_id, exercise_id)
    deferrable initially deferred,
  foreign key (user_id, plan_item_id)
    references arnold.plan_items (user_id, plan_item_id)
    deferrable initially deferred
);
create index on arnold.sets (user_id, workout_id);

-- --------------------------------------------------------- technical state

-- Every write carries a request_id. A repeated request_id returns the stored
-- result instead of writing twice. Written in the same transaction as the
-- data, so "recorded" always means "stored".
create table arnold.operations (
  user_id text not null references arnold.users (user_id) on delete cascade,
  request_id text not null,
  fingerprint text not null,
  actor text not null,
  changes jsonb not null,
  result jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index on arnold.operations (recorded_at);

create table arnold.audit_events (
  user_id text not null references arnold.users (user_id) on delete cascade,
  operation_id text not null,
  entity_id text not null,
  event_type text not null,
  event jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, operation_id, entity_id, event_type)
);
create index on arnold.audit_events (recorded_at);

-- The setup conversation. One JSON document per session, with an optimistic
-- revision: an update built on an older revision is refused.
create table arnold.onboarding_sessions (
  user_id text not null references arnold.users (user_id) on delete cascade,
  onboarding_session_id text not null,
  owner_subject text not null,
  status text not null,
  revision integer not null check (revision >= 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null,
  record jsonb not null,
  primary key (user_id, onboarding_session_id)
);
create index on arnold.onboarding_sessions (user_id, updated_at desc);

-- ------------------------------------------------------- row level security

do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'identity_connections', 'exercises', 'plan_versions',
    'plan_items', 'workouts', 'sets', 'operations', 'audit_events',
    'onboarding_sessions'
  ] loop
    execute format('alter table arnold.%I enable row level security', t);
    execute format(
      'create policy own_rows on arnold.%I for all to arnold_app '
      'using (user_id = arnold.current_user_id()) '
      'with check (user_id = arnold.current_user_id())', t);
  end loop;
end
$$;

-- What the server role may do. No TRUNCATE, no REFERENCES, no DDL.
grant select, insert, update on
  arnold.exercises, arnold.plan_versions, arnold.plan_items,
  arnold.workouts, arnold.sets
  to arnold_app;
grant select, insert, update, delete on arnold.onboarding_sessions to arnold_app;
grant select, insert on arnold.operations, arnold.audit_events to arnold_app;
grant select, delete on arnold.users, arnold.identity_connections to arnold_app;
-- Training rows are never deleted one by one (they become tombstones); only
-- the account deletion removes them, through the cascade from arnold.users.

-- The Supabase API roles get nothing, even if the schema were exposed later.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema arnold from %I', r);
      execute format('revoke all on schema arnold from %I', r);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------- functions

-- Finds the Arnold user for a verified login, creating it on first contact
-- when p_create is true. Concurrent first requests resolve to one user.
-- last_seen_at is refreshed at most once per hour, so ordinary requests do
-- not write.
create function arnold.resolve_identity(
  p_issuer text, p_subject text, p_create boolean
) returns table (
  user_id text, status text, tracker_id text, created boolean,
  user_created_at timestamptz, user_updated_at timestamptz,
  connection_id text, connection_created_at timestamptz, last_seen_at timestamptz
)
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user text;
  v_created boolean := false;
begin
  if coalesce(p_issuer, '') = '' or coalesce(p_subject, '') = '' then
    raise exception 'issuer and subject are required';
  end if;
  select c.user_id into v_user
    from arnold.identity_connections c
    where c.issuer = p_issuer and c.subject = p_subject;
  if v_user is null and p_create then
    -- Serialises first contact for this identity across connections.
    perform pg_advisory_xact_lock(hashtextextended(p_issuer || ' ' || p_subject, 7));
    select c.user_id into v_user
      from arnold.identity_connections c
      where c.issuer = p_issuer and c.subject = p_subject;
    if v_user is null then
      v_user := 'usr_' || gen_random_uuid()::text;
      insert into arnold.users (user_id) values (v_user);
      insert into arnold.identity_connections (user_id, issuer, subject)
        values (v_user, p_issuer, p_subject);
      v_created := true;
    end if;
  end if;
  if v_user is null then
    return;
  end if;
  update arnold.identity_connections c
    set last_seen_at = now()
    where c.issuer = p_issuer and c.subject = p_subject
      and c.last_seen_at < now() - interval '1 hour';
  return query
    select u.user_id, u.status, u.tracker_id, v_created,
           u.created_at, u.updated_at,
           c.connection_id, c.created_at, c.last_seen_at
      from arnold.users u
      join arnold.identity_connections c on c.user_id = u.user_id
      where c.issuer = p_issuer and c.subject = p_subject;
end
$$;

-- Deletes technical records past the retention period, for every user:
-- write receipts, audit events, and setup sessions that expired without being
-- completed. A completed setup is kept: it is the record that the account is
-- set up. Training data is never pruned.
create function arnold.prune(p_retention_days integer) returns table (
  operations bigint, audit_events bigint, onboarding_sessions bigint
)
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_ops bigint;
  v_audit bigint;
  v_sessions bigint;
begin
  if p_retention_days is null or p_retention_days < 1 then
    raise exception 'retention must be at least one day';
  end if;
  v_cutoff := now() - make_interval(days => p_retention_days);
  delete from arnold.operations o where o.recorded_at < v_cutoff;
  get diagnostics v_ops = row_count;
  delete from arnold.audit_events a where a.recorded_at < v_cutoff;
  get diagnostics v_audit = row_count;
  delete from arnold.onboarding_sessions s
    where s.status <> 'COMPLETED' and s.expires_at < v_cutoff;
  get diagnostics v_sessions = row_count;
  return query select v_ops, v_audit, v_sessions;
end
$$;

revoke all on function arnold.resolve_identity(text, text, boolean) from public;
revoke all on function arnold.prune(integer) from public;
grant execute on function arnold.resolve_identity(text, text, boolean) to arnold_app;
grant execute on function arnold.prune(integer) to arnold_app;
grant execute on function arnold.current_user_id() to arnold_app;

-- One account, read by id. Used on every request to check that the account
-- is still active; a function so the check is one round trip.
create function arnold.account(p_user_id text) returns table (
  user_id text, status text, tracker_id text,
  created_at timestamptz, updated_at timestamptz, last_seen_at timestamptz
)
  language sql stable
  security definer
  set search_path = ''
as $$
  select u.user_id, u.status, u.tracker_id, u.created_at, u.updated_at,
         (select max(c.last_seen_at) from arnold.identity_connections c
           where c.user_id = u.user_id)
    from arnold.users u
    where u.user_id = p_user_id
$$;
revoke all on function arnold.account(text) from public;
grant execute on function arnold.account(text) to arnold_app;
