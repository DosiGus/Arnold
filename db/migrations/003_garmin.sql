-- Garmin watch credentials, pairings and raw recordings. Additive migration.
alter table arnold.workouts add column client_session_id text;
create unique index workouts_one_client_session on arnold.workouts (user_id, client_session_id)
  where status = 'completed' and client_session_id is not null;

create table arnold.watch_devices (
  user_id text not null references arnold.users (user_id) on delete cascade,
  device_id text not null check (device_id ~ '^wdv_[0-9a-f-]{36}$'),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  label text not null, part_number text not null default '', app_version text not null default '',
  timezone text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(), last_used_at timestamptz, revoked_at timestamptz,
  primary key (user_id, device_id),
  check ((status = 'revoked') = (revoked_at is not null))
);
create table arnold.watch_pairings (
  pairing_id text primary key default ('wpr_' || gen_random_uuid()::text),
  device_code_hash bytea not null unique check (octet_length(device_code_hash) = 32),
  user_code_hash bytea not null unique check (octet_length(user_code_hash) = 32),
  status text not null default 'pending' check (status in ('pending', 'approved', 'consumed', 'expired')),
  user_id text references arnold.users (user_id) on delete cascade,
  device_label text not null, timezone text,
  expires_at timestamptz not null,
  last_polled_at timestamptz,
  check (status not in ('approved', 'consumed') or (user_id is not null and timezone is not null))
);
create index watch_pairings_by_user on arnold.watch_pairings (user_id);
create index watch_pairings_expiry on arnold.watch_pairings (expires_at);
create table arnold.health_consents (
  user_id text not null references arnold.users (user_id) on delete cascade,
  scope text not null check (scope = 'garmin_health'), text_version text not null,
  granted_at timestamptz not null, revoked_at timestamptz,
  primary key (user_id, scope)
);
create table arnold.workout_recordings (
  user_id text not null references arnold.users (user_id) on delete cascade,
  client_session_id text not null, device_id text not null,
  started_at_utc text not null, ended_at_utc text not null,
  set_timings jsonb not null, app_version text not null,
  primary key (user_id, client_session_id),
  foreign key (user_id, device_id) references arnold.watch_devices (user_id, device_id)
);
create index workout_recordings_by_device on arnold.workout_recordings (user_id, device_id);
create table arnold.workout_health (
  user_id text not null references arnold.users (user_id) on delete cascade,
  client_session_id text not null, hr jsonb, calories_kcal integer check (calories_kcal >= 0),
  before jsonb, after jsonb, extras jsonb, received_at timestamptz not null default now(),
  primary key (user_id, client_session_id),
  foreign key (user_id, client_session_id) references arnold.workout_recordings (user_id, client_session_id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['watch_devices', 'watch_pairings', 'health_consents', 'workout_recordings', 'workout_health'] loop
    execute format('alter table arnold.%I enable row level security', t);
    execute format('create policy own_rows on arnold.%I for all to arnold_app using (user_id = arnold.current_user_id()) with check (user_id = arnold.current_user_id())', t);
  end loop;
end $$;
grant select, insert, update on arnold.watch_devices, arnold.health_consents, arnold.workout_recordings, arnold.workout_health to arnold_app;
-- Health revocation deletes raw health rows; ownership is still enforced by RLS.
grant delete on arnold.workout_health to arnold_app;
-- Pairings can only be accessed through the functions. Failed approvals are
-- rate-limited in the server (D-15), not by an additional credential table.
revoke all on arnold.watch_pairings from public, arnold_app;

create function arnold.start_watch_pairing(p_device_code_hash bytea, p_user_code_hash bytea, p_label text, p_ttl integer)
returns table (pairing_id text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_ttl is distinct from 600 or p_label is null or length(p_label) not between 1 and 100 then
    raise exception 'Invalid pairing request';
  end if;
  return query insert into arnold.watch_pairings (device_code_hash, user_code_hash, device_label, expires_at)
    values (p_device_code_hash, p_user_code_hash, p_label, now() + make_interval(secs => p_ttl))
    returning watch_pairings.pairing_id, watch_pairings.expires_at;
end $$;

-- The authenticated owner comes only from the transaction context. timezone is
-- provided at approval (D-10); it is never inferred from the uploading watch.
create function arnold.approve_watch_pairing(p_user_code_hash bytea, p_timezone text)
returns table (result text, device_label text)
language plpgsql security definer set search_path = '' as $$
declare v_user text := arnold.current_user_id(); v_label text;
begin
  if not exists (select 1 from arnold.users where user_id = v_user and status = 'ACTIVE') then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;
  update arnold.watch_pairings set user_id = v_user, timezone = p_timezone, status = 'approved'
    where user_code_hash = p_user_code_hash and status = 'pending' and expires_at > now()
    returning watch_pairings.device_label into v_label;
  if found then return query select 'approved'::text, v_label;
  else
    return query select 'invalid'::text, null::text;
  end if;
end $$;

-- What the confirmation card shows before the click: model and expiry of an
-- open pairing. No user, no write (D-26).
create function arnold.preview_watch_pairing(p_user_code_hash bytea)
returns table (device_label text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.device_label, p.expires_at from arnold.watch_pairings p
   where p.user_code_hash = p_user_code_hash and p.status = 'pending' and p.expires_at > now()
$$;

create function arnold.redeem_watch_pairing(p_device_code_hash bytea, p_token_hash bytea, p_device_id text)
returns table (result text, user_id text, device_id text)
language plpgsql security definer set search_path = '' as $$
declare v_pair arnold.watch_pairings%rowtype;
begin
  select * into v_pair from arnold.watch_pairings where device_code_hash = p_device_code_hash for update;
  if not found or v_pair.expires_at <= now() or v_pair.status in ('expired', 'consumed') then
    return query select 'expired'::text, null::text, null::text; return;
  end if;
  -- The watch polls every 5 s; radio jitter must not count as too fast (D-26).
  if v_pair.last_polled_at > now() - interval '4 seconds' then
    return query select 'slow_down'::text, null::text, null::text; return;
  end if;
  update arnold.watch_pairings set last_polled_at = now() where pairing_id = v_pair.pairing_id;
  if v_pair.status = 'pending' then return query select 'pending'::text, null::text, null::text; return; end if;
  -- Lock the account against a concurrent disable/delete during redemption.
  perform 1 from arnold.users u where u.user_id = v_pair.user_id and u.status = 'ACTIVE' for share;
  if not found then return query select 'expired'::text, null::text, null::text; return; end if;
  insert into arnold.watch_devices (user_id, device_id, token_hash, label, timezone)
    values (v_pair.user_id, p_device_id, p_token_hash, v_pair.device_label, v_pair.timezone);
  update arnold.watch_pairings set status = 'consumed' where pairing_id = v_pair.pairing_id;
  return query select 'issued'::text, v_pair.user_id, p_device_id;
end $$;

create function arnold.resolve_watch_token(p_token_hash bytea)
returns table (user_id text, device_id text, scopes text[])
language plpgsql security definer set search_path = '' as $$
begin
  update arnold.watch_devices d set last_used_at = now()
    where d.token_hash = p_token_hash and d.status = 'active'
      and (d.last_used_at is null or d.last_used_at <= now() - interval '1 hour')
      and exists (select 1 from arnold.users u where u.user_id = d.user_id and u.status = 'ACTIVE');
  return query select d.user_id, d.device_id, array['arnold.watch.read', 'arnold.watch.write']::text[]
    from arnold.watch_devices d join arnold.users u on u.user_id = d.user_id
    where d.token_hash = p_token_hash and d.status = 'active' and u.status = 'ACTIVE';
end $$;

-- Keep the existing prune result shape and retention behaviour unchanged.
create or replace function arnold.prune(p_retention_days integer)
returns table (operations bigint, audit_events bigint, onboarding_sessions bigint)
language plpgsql security definer set search_path = '' as $$
declare v_cutoff timestamptz; v_ops bigint; v_audit bigint; v_sessions bigint;
begin
  if p_retention_days is null or p_retention_days < 1 then raise exception 'retention must be at least one day'; end if;
  v_cutoff := now() - make_interval(days => p_retention_days);
  delete from arnold.watch_pairings where expires_at < now();
  delete from arnold.operations o where o.recorded_at < v_cutoff; get diagnostics v_ops = row_count;
  delete from arnold.audit_events a where a.recorded_at < v_cutoff; get diagnostics v_audit = row_count;
  delete from arnold.onboarding_sessions s where s.status <> 'COMPLETED' and s.expires_at < v_cutoff; get diagnostics v_sessions = row_count;
  return query select v_ops, v_audit, v_sessions;
end $$;
revoke all on function arnold.start_watch_pairing(bytea, bytea, text, integer), arnold.approve_watch_pairing(bytea, text), arnold.preview_watch_pairing(bytea), arnold.redeem_watch_pairing(bytea, bytea, text), arnold.resolve_watch_token(bytea) from public;
grant execute on function arnold.start_watch_pairing(bytea, bytea, text, integer), arnold.approve_watch_pairing(bytea, text), arnold.preview_watch_pairing(bytea), arnold.redeem_watch_pairing(bytea, bytea, text), arnold.resolve_watch_token(bytea) to arnold_app;
-- Private tables/functions are never reachable through Supabase's API roles.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on arnold.watch_devices, arnold.watch_pairings, arnold.health_consents, arnold.workout_recordings, arnold.workout_health from %I', r);
      execute format('revoke all on function arnold.start_watch_pairing(bytea,bytea,text,integer), arnold.approve_watch_pairing(bytea,text), arnold.preview_watch_pairing(bytea), arnold.redeem_watch_pairing(bytea,bytea,text), arnold.resolve_watch_token(bytea) from %I', r);
    end if;
  end loop;
end $$;
