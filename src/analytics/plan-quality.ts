/**
 * Plan quality check (ARN-REDESIGN D-10). Pure, no I/O.
 *
 * The server judges a proposed plan itself instead of trusting the model:
 * time budget per session, number of sessions against training days, weekly
 * sets per muscle group, focus muscle groups, and a few sensible-session
 * rules. Rules follow `planungsregeln.md` (sections 3 and 5).
 *
 * `block` = the plan must be revised. `hint` = worth saying, no hard stop.
 * Unknown stays unknown: an exercise without a muscle group or a set count is
 * reported in `unknown`, never counted as 0 and never used to block.
 */
import { addDays } from "./period.js";
import {
  isHardRun,
  isLegMuscle,
  legLoadOn,
  plannedStrengthDay,
  type StrengthDay,
} from "./running/interference.js";

/* ---------------------------------------------------------------- values */

/** Minutes for warm-up and changeover per session (planungsregeln 5). */
export const WARMUP_MINUTES = 8;
/** Minutes for one set of a basic (compound) lift, set plus rest. */
export const COMPOUND_SET_MINUTES = 3;
/** Minutes for one isolation set, set plus rest. */
export const ISOLATION_SET_MINUTES = 2;
/** Tolerated overshoot of the session time before the check blocks. */
export const TIME_TOLERANCE = 0.1;
/** Share of a set that counts for a clearly co-trained muscle. */
export const SECONDARY_SET_WEIGHT = 0.5;
/** Weekly sets per main muscle group for muscle gain (planungsregeln 3). */
export const WEEKLY_SETS_MIN = 10;
export const WEEKLY_SETS_MAX = 20;
/** A focus group needs at least this many sets more than the median. */
export const FOCUS_MARGIN_SETS = 2;
/** Groups the volume and focus rules look at; small muscles are exempt. */
export const MAIN_GROUPS: readonly string[] = [
  "chest",
  "back",
  "shoulders",
  "legs",
];

/* ----------------------------------------------------------------- input */

/** The catalog fields the check reads. */
export interface PlanQualityExercise {
  readonly exercise_id: string;
  readonly primary_muscle: string | null;
  /** Clearly co-trained muscles; each counts half. */
  readonly secondary_muscles?: readonly string[];
  /** True for isolation lifts; null/absent = unknown (counted as a basic lift). */
  readonly isolation?: boolean | null;
}

/** A planned strength exercise (structurally a `PlannedExerciseInput`). */
export interface PlanQualityItem {
  readonly exercise_id: string;
  /** Null or absent = unknown. */
  readonly target_sets?: number | null;
}

type RunType = Parameters<typeof isHardRun>[0];

/** A strength session; `weekday` (1 = Monday) only matters for run rules. */
export interface PlanQualitySession {
  readonly session_name: string;
  readonly exercises: readonly PlanQualityItem[];
  readonly weekday?: number | null;
}

export interface PlanQualityRun {
  readonly session_name: string;
  readonly run_type: RunType;
  /** ISO weekday, 1 = Monday; null = no preference. */
  readonly preferred_weekday: number | null;
}

export interface PlanQualityInput {
  readonly sessions: readonly PlanQualitySession[];
  readonly runs?: readonly PlanQualityRun[];
  readonly catalog: readonly PlanQualityExercise[];
  readonly profile: {
    readonly days_per_week: number;
    readonly session_minutes: number;
    readonly focus_muscle_groups?: readonly string[];
    /** Training goal; the set range rule only applies for "muscle_gain". */
    readonly goal?: string | null;
  };
}

/* ---------------------------------------------------------------- output */

export type PlanQualityCode =
  | "time_budget_exceeded"
  | "too_many_sessions"
  | "weekly_sets_low"
  | "weekly_sets_high"
  | "focus_not_emphasised"
  | "leg_day_accessory"
  | "hard_run_after_leg_day"
  | "unknown_sets"
  | "unknown_muscle";

export interface PlanQualityFinding {
  readonly code: PlanQualityCode;
  readonly severity: "block" | "hint";
  /** One German sentence. */
  readonly detail: string;
  /** Session name, if the finding concerns one. */
  readonly session?: string;
  /** Muscle group, if the finding concerns one. */
  readonly muscle_group?: string;
}

export interface PlanQualityResult {
  readonly findings: readonly PlanQualityFinding[];
  /** True when at least one finding blocks. */
  readonly blocked: boolean;
  /** Fractional weekly sets per muscle group (lower bounds if `unknown` is set). */
  readonly weekly_sets: Readonly<Record<string, number>>;
  /** Exercises whose muscle group is not known; their sets are not counted. */
  readonly unknown: Readonly<{
    exercise_ids: readonly string[];
    sessions_without_set_count: readonly string[];
  }>;
}

/* --------------------------------------------------------------- helpers */

const LABEL: Record<string, string> = {
  chest: "Brust",
  back: "Rücken",
  shoulders: "Schultern",
  arms: "Arme",
  legs: "Beine",
  glutes: "Po",
  core: "Bauch",
};
const label = (muscle: string) => LABEL[muscle] ?? muscle;
const round1 = (n: number) => Math.round(n * 10) / 10;

const muscleKey = (muscle: string) => muscle.trim().toLowerCase();

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Fixed reference week (2001-01-08 is a Monday) for cyclic weekday maths. */
const REF_MONDAY = "2001-01-08";
const refDate = (weekday: number, week: 0 | -1) =>
  addDays(REF_MONDAY, weekday - 1 + (week === 0 ? 0 : -7));

/* ----------------------------------------------------------------- check */

export function checkPlanQuality(input: PlanQualityInput): PlanQualityResult {
  const { sessions, profile } = input;
  const catalog = new Map(input.catalog.map((e) => [e.exercise_id, e]));
  const findings: PlanQualityFinding[] = [];
  const unknownIds = new Set<string>();
  const noSetCount = new Set<string>();
  const sets = new Map<string, number>();
  const add = (muscle: string, value: number) =>
    sets.set(muscleKey(muscle), (sets.get(muscleKey(muscle)) ?? 0) + value);

  const sessionStats = sessions.map((session) => {
    let minutes = WARMUP_MINUTES;
    let setsKnown = true;
    let legSets = 0;
    let knownSets = 0;
    const accessories: { muscle: string; name: string }[] = [];
    for (const item of session.exercises) {
      const exercise = catalog.get(item.exercise_id);
      const count = item.target_sets;
      if (count === null || count === undefined) {
        setsKnown = false;
        noSetCount.add(session.session_name);
      }
      const primary = exercise?.primary_muscle ?? null;
      if (primary === null) unknownIds.add(item.exercise_id);
      if (count === null || count === undefined) continue;
      minutes +=
        count *
        (exercise?.isolation === true
          ? ISOLATION_SET_MINUTES
          : COMPOUND_SET_MINUTES);
      knownSets += count;
      if (primary === null) continue;
      add(primary, count);
      for (const secondary of exercise?.secondary_muscles ?? [])
        add(secondary, count * SECONDARY_SET_WEIGHT);
      if (isLegMuscle(primary) || muscleKey(primary) === "glutes")
        legSets += count;
      const key = muscleKey(primary);
      if (
        key === "core" ||
        (key === "shoulders" && exercise?.isolation === true)
      )
        accessories.push({ muscle: key, name: item.exercise_id });
    }
    return { session, minutes, setsKnown, legSets, knownSets, accessories };
  });

  // 1. Time budget per session.
  const limit = profile.session_minutes * (1 + TIME_TOLERANCE);
  for (const s of sessionStats) {
    if (!s.setsKnown) continue;
    if (s.minutes > limit)
      findings.push({
        code: "time_budget_exceeded",
        severity: "block",
        detail: `„${s.session.session_name}“ braucht etwa ${Math.round(s.minutes)} Minuten, geplant sind ${profile.session_minutes}.`,
        session: s.session.session_name,
      });
  }
  for (const name of noSetCount)
    findings.push({
      code: "unknown_sets",
      severity: "hint",
      detail: `In „${name}“ fehlt bei mindestens einer Übung die Satzzahl, die Dauer lässt sich nicht prüfen.`,
      session: name,
    });

  // 2. More sessions than training days.
  if (sessions.length > profile.days_per_week)
    findings.push({
      code: "too_many_sessions",
      severity: "block",
      detail: `Der Plan hat ${sessions.length} Krafteinheiten, aber nur ${profile.days_per_week} Trainingstage pro Woche.`,
    });

  const hasUnknown = unknownIds.size > 0;
  if (hasUnknown)
    findings.push({
      code: "unknown_muscle",
      severity: "hint",
      detail: `Bei ${unknownIds.size} Übung(en) ist die Muskelgruppe unbekannt, ihre Sätze zählen nicht mit; die Satzprüfung ist eingeschränkt.`,
    });

  // 3. Weekly sets per main group (muscle gain only).
  if (profile.goal === "muscle_gain")
    for (const group of MAIN_GROUPS) {
      const value = sets.get(group) ?? 0;
      if (value > WEEKLY_SETS_MAX)
        findings.push({
          code: "weekly_sets_high",
          severity: "hint",
          detail: `${label(group)} hat ${round1(value)} Wochensätze, mehr als ${WEEKLY_SETS_MAX} bringt wenig und kostet Erholung.`,
          muscle_group: group,
        });
      else if (value < WEEKLY_SETS_MIN && !hasUnknown)
        findings.push({
          code: "weekly_sets_low",
          severity: "hint",
          detail: `${label(group)} hat nur ${round1(value)} Wochensätze, für Muskelaufbau sind mindestens ${WEEKLY_SETS_MIN} sinnvoll.`,
          muscle_group: group,
        });
    }

  // 4. Focus groups must clearly stand out from the other main groups.
  if (!hasUnknown && noSetCount.size === 0)
    for (const focus of profile.focus_muscle_groups ?? []) {
      const key = muscleKey(focus);
      const others = MAIN_GROUPS.filter(
        (g) =>
          g !== key &&
          !(profile.focus_muscle_groups ?? []).some(
            (f) => muscleKey(f) === g,
          ) &&
          (sets.get(g) ?? 0) > 0,
      ).map((g) => sets.get(g)!);
      if (others.length === 0) continue;
      const need = median(others) + FOCUS_MARGIN_SETS;
      const have = sets.get(key) ?? 0;
      if (have < need)
        findings.push({
          code: "focus_not_emphasised",
          severity: "block",
          detail: `Schwerpunkt ${label(key)} hat ${round1(have)} Wochensätze, braucht mindestens ${round1(need)} (Median der übrigen Hauptgruppen plus ${FOCUS_MARGIN_SETS}).`,
          muscle_group: key,
        });
    }

  // 5. Core or shoulder isolation inside a leg session.
  for (const s of sessionStats) {
    if (s.knownSets === 0 || s.legSets * 2 < s.knownSets) continue;
    for (const group of new Set(s.accessories.map((a) => a.muscle)))
      findings.push({
        code: "leg_day_accessory",
        severity: "hint",
        detail: `„${s.session.session_name}“ ist ein Beintag, ${group === "core" ? "Bauch" : "Schulterisolation"} gehört besser in eine andere Einheit.`,
        session: s.session.session_name,
        muscle_group: group,
      });
  }

  // 6. Hard run the day after a heavy leg day (weekday known for both).
  const strengthDays: StrengthDay[] = [];
  for (const s of sessionStats) {
    const weekday = s.session.weekday;
    if (!weekday || !s.setsKnown) continue;
    for (const week of [0, -1] as const) {
      const items = s.session.exercises.map((item) => ({
        target_sets: item.target_sets ?? null,
        primary_muscle: catalog.get(item.exercise_id)?.primary_muscle ?? null,
      }));
      strengthDays.push(plannedStrengthDay(refDate(weekday, week), items));
    }
  }
  for (const run of input.runs ?? []) {
    if (!run.preferred_weekday || !isHardRun(run.run_type)) continue;
    const before = legLoadOn(
      strengthDays,
      addDays(refDate(run.preferred_weekday, 0), -1),
    );
    if (before.heavy === true)
      findings.push({
        code: "hard_run_after_leg_day",
        severity: "hint",
        detail: `„${run.session_name}“ ist ein harter Lauf direkt nach einem schweren Beintag, besser einen Tag Abstand lassen.`,
        session: run.session_name,
      });
  }

  return {
    findings,
    blocked: findings.some((f) => f.severity === "block"),
    weekly_sets: Object.fromEntries(
      [...sets.entries()].map(([k, v]) => [k, round1(v)]),
    ),
    unknown: {
      exercise_ids: [...unknownIds],
      sessions_without_set_count: [...noSetCount],
    },
  };
}
