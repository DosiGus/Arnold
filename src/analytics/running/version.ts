/**
 * Version of the running plan rules (D-RUN-03): zones, VDOT paces, the run
 * type catalog and the prescription rules in `src/analytics/running` (the
 * metrics have their own `RUN_METRICS_VERSION`). Every prescription carries
 * it. Bump it whenever a bound, a table value, a threshold, a text that
 * decides something or a rule changes, so stored prescriptions stay
 * explainable (semantic versioning: major = a rule that changes what is
 * allowed, minor = new run types or options, patch = wording).
 *
 * 1.2.0 (RUN-013): long run share of the week depends on the number of runs
 * (30/35/40/50 % at 5+/4/3/2 runs, `longShareMax`); at the volume cap the
 * week planner shortens sessions to their minimum first (hard ones first) and
 * drops a session (a hard one first) only when every other one is at minimum.
 */
export const RUN_RULES_VERSION = "1.2.0";
