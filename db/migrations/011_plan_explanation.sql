-- Plan explanation (Skybridge frontend, 26.11.2026): why a proposed plan
-- looks the way it does, written by ChatGPT with the proposal and shown in
-- the plan card ("Erklärung zum Plan"). Only words: the set counts and the
-- example week next to it are computed by Arnold from the plan itself.
--
-- Additive. Nullable on purpose and without a default: null means "none was
-- written" (older plans, plans built by hand). Existing rows stay unchanged.
--
-- The column belongs to arnold.plan_versions, so row level security (policy
-- own_rows of 001) covers it unchanged, and arnold_app keeps its table
-- grants (select, insert, update), which include new columns.
--
-- Undo: db/rollback/011_down.sql (only with the owner's explicit yes).

alter table arnold.plan_versions add column explanation jsonb;
