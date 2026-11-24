-- Mat for the morning routine (ARN-REDESIGN, decision D-07): whether the
-- user has a mat for floor exercises in the morning. Only true lets floor
-- exercises (catalog needs_mat) into a morning routine.
--
-- Additive. Nullable on purpose and without a default: null means "not asked
-- yet" (D-09, no values the user did not name). Existing profiles keep null;
-- this migration changes no existing row.
--
-- The column belongs to arnold.mobility_profiles, so row level security
-- (policy own_rows of 009) covers it unchanged, and arnold_app keeps the
-- table grants of 009 (select, insert, update), which include new columns.
--
-- Undo: db/rollback/010_down.sql (only with the owner's explicit yes).

alter table arnold.mobility_profiles add column has_mat boolean;
