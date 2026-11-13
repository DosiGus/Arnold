/**
 * Version of the running plan rules (D-RUN-03): zones, VDOT paces, the run
 * type catalog and the prescription rules in `src/analytics/running` (the
 * metrics have their own `RUN_METRICS_VERSION`). Every prescription carries
 * it. Bump it whenever a bound, a table value, a threshold, a text that
 * decides something or a rule changes, so stored prescriptions stay
 * explainable (semantic versioning: major = a rule that changes what is
 * allowed, minor = new run types or options, patch = wording).
 */
export const RUN_RULES_VERSION = "1.1.0";
