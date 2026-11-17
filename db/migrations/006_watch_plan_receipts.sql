-- Honest watch status (UX-007): which plan state each watch has confirmed.
--
-- The server computes a short mark over exactly what GET /plan delivers. The
-- watch sends that mark back (POST /plan/ack) only after a complete sync. One
-- row per watch keeps the last confirmed mark and when it came. Without a row
-- the server does not know what the watch holds, so it never says "arrived".
--
-- Additive. Same rules as 001–005: every row belongs to one user, row level
-- security (policy own_rows) lets only that user's rows through, and deleting
-- the account or the device removes the row through the cascade.
--
-- Undo: db/rollback/006_down.sql (only with the owner's explicit yes).

create table arnold.watch_plan_receipts (
  user_id text not null references arnold.users (user_id) on delete cascade,
  device_id text not null,
  plan_mark text not null check (plan_mark ~ '^[0-9a-f]{16}$'),
  confirmed_at timestamptz not null default now(),
  primary key (user_id, device_id),
  foreign key (user_id, device_id) references arnold.watch_devices (user_id, device_id) on delete cascade
);

alter table arnold.watch_plan_receipts enable row level security;
create policy own_rows on arnold.watch_plan_receipts for all to arnold_app
  using (user_id = arnold.current_user_id())
  with check (user_id = arnold.current_user_id());
grant select, insert, update on arnold.watch_plan_receipts to arnold_app;

-- Private table: never reachable through Supabase's API roles.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on arnold.watch_plan_receipts from %I', r);
    end if;
  end loop;
end $$;
