import type { RunEnvironment, RunType } from "../../shared/run-contract.js";
import { compareDate } from "../period.js";
import { decoupling, runFulfilment } from "./metrics/run.js";
import type { RunInput, RunSegmentInput } from "./metrics/types.js";
import { RUN_TYPE_RPE, type RunExperience } from "./catalog.js";
import { runLevelCeiling } from "./prescription.js";
import type { WeekHistoryRun } from "./week-context.js";

/**
 * Adaptation after runs (ARN-RUN, spec "Anpassung nach Läufen"): for one run
 * type the last two completed runs decide the next level — next level, hold
 * or one level back. Easy runs that were regularly too hard and a long run
 * with a heart-rate decoupling over 5 % stop a step up. The levels are those
 * of `prescription.ts` (`runLevelCeiling`). Unknown data never counts as
 * fulfilled: it holds the level. Pure: no I/O.
 */

/** Both runs at least this fulfilled (and effort as expected): next level. */
export const ADAPT_NEXT_FULFILMENT = 0.9;
/** Under this fulfilment (in both runs): one level back. */
export const ADAPT_BACK_FULFILMENT = 0.75;
/** Effort this many points over the expected one (in both runs): one level back. */
export const ADAPT_BACK_RPE_OVER = 2;
/** An easy run is too hard with more than this share of its zone time in zones 3–5. */
export const EASY_TOO_HARD_SHARE = 0.2;
/** Long run: no extension with a decoupling over this percentage. */
export const LONG_DECOUPLING_MAX_PERCENT = 5;
/** Runs the decision looks at. */
export const ADAPT_RUNS = 2;

/** Easy run types whose heart rate is checked ("lockere Läufe zu hart"). */
export const EASY_CHECK_TYPES: readonly RunType[] = [
  "recovery",
  "base",
  "long",
  "run_walk",
];

/**
 * A run of the history as the adaptation reads it. Segments come from the
 * watch; `planned_minutes` (from the stored prescription) lets a run without
 * segments count by its time. Heart-rate fields only with consent.
 */
export type AdaptationRun = WeekHistoryRun &
  Partial<
    Pick<
      RunInput,
      | "rpe"
      | "environment"
      | "distance_m"
      | "distance_source"
      | "splits_100m"
      | "hr_status"
      | "hr_zone_seconds"
      | "hr_samples"
      | "started_at_utc"
    >
  > & {
    readonly segments?: readonly RunSegmentInput[];
    readonly planned_minutes?: number | null;
  };

export type LevelDecisionKind = "next" | "hold" | "back";

export interface LevelDecision {
  readonly run_type: RunType;
  readonly previous_level: number;
  readonly level: number;
  readonly decision: LevelDecisionKind;
  /** Why, in German, for the card and for ChatGPT. */
  readonly reasons: readonly string[];
  readonly runs_considered: number;
  readonly easy_too_hard: boolean;
  readonly decoupling_percent: number | null;
  /** Beginners whose easy runs were too hard: walking breaks help. */
  readonly suggest_walk_breaks: boolean;
}

export interface AdaptationInput {
  readonly run_type: RunType;
  /** Level of the session now (0 = standard start). */
  readonly level: number;
  readonly experience: RunExperience;
  readonly environment?: RunEnvironment;
  readonly has_paces?: boolean;
  /** The run history (any run types; the function picks what it needs). */
  readonly history: readonly AdaptationRun[];
}

const newestFirst = (a: AdaptationRun, b: AdaptationRun) => {
  const byDate = compareDate(b.workout_date_local, a.workout_date_local);
  if (byDate !== 0) return byDate;
  return (b.started_at_utc ?? "") < (a.started_at_utc ?? "") ? -1 : 1;
};

const completed = (runs: readonly AdaptationRun[]) =>
  runs.filter((run) => run.status === "completed");

/** Fulfilment of one run: from its segments, else its time against the plan. */
export function fulfilmentOf(run: AdaptationRun): number | null {
  if (run.segments && run.segments.length > 0) {
    const value = runFulfilment(run.segments).value;
    if (value !== null) return value;
  }
  if (
    run.planned_minutes !== null &&
    run.planned_minutes !== undefined &&
    run.planned_minutes > 0 &&
    run.timer_s !== null
  )
    return Math.min(1, run.timer_s / 60 / run.planned_minutes);
  return null;
}

/** Share of the zone time in zones 3–5; null without zone times. */
export function shareAboveZone2(run: AdaptationRun): number | null {
  const zones = run.hr_status === "recorded" ? run.hr_zone_seconds : null;
  if (!zones || zones.length !== 5) return null;
  const total = zones.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  return (zones[2] + zones[3] + zones[4]) / total;
}

/**
 * Easy runs regularly too hard: each of the last two easy runs with zone
 * times spent more than 20 % of it above zone 2.
 */
export function easyRunsTooHard(history: readonly AdaptationRun[]): {
  readonly too_hard: boolean;
  readonly shares: readonly number[];
} {
  const shares = completed(history)
    .filter((run) => EASY_CHECK_TYPES.includes(run.run_type))
    .sort(newestFirst)
    .map(shareAboveZone2)
    .filter((share): share is number => share !== null)
    .slice(0, ADAPT_RUNS);
  return {
    too_hard:
      shares.length === ADAPT_RUNS &&
      shares.every((share) => share > EASY_TOO_HARD_SHARE),
    shares,
  };
}

/** Decoupling of a run in percent, when the metrics can compute it. */
export function decouplingPercent(run: AdaptationRun): number | null {
  if (
    run.hr_status !== "recorded" ||
    !run.splits_100m ||
    !run.hr_samples ||
    run.environment === undefined
  )
    return null;
  const value = decoupling({
    ...run,
    distance_m: run.distance_m ?? null,
    distance_source: run.distance_source ?? null,
  } as unknown as RunInput).value;
  return value === null ? null : value.percent;
}

const pct = (value: number) => `${Math.round(value * 100)} %`;

export function adaptRunLevel(input: AdaptationInput): LevelDecision {
  const type = input.run_type;
  const previous = Math.max(0, Math.floor(input.level));
  const ceiling = runLevelCeiling(
    type,
    input.experience,
    input.environment ?? "outdoor",
    input.has_paces ?? false,
  );
  const runs = completed(input.history)
    .filter((run) => run.run_type === type)
    .sort(newestFirst)
    .slice(0, ADAPT_RUNS);
  const reasons: string[] = [];
  const decide = (
    decision: LevelDecisionKind,
    extra: Partial<LevelDecision> = {},
  ): LevelDecision => ({
    run_type: type,
    previous_level: previous,
    level:
      decision === "next"
        ? Math.min(previous + 1, ceiling)
        : decision === "back"
          ? Math.max(previous - 1, 0)
          : Math.min(previous, ceiling),
    decision,
    reasons,
    runs_considered: runs.length,
    easy_too_hard: false,
    decoupling_percent: null,
    suggest_walk_breaks: false,
    ...extra,
  });

  const expected = RUN_TYPE_RPE[type].expected;
  if (ceiling === 0 || expected === null) {
    reasons.push("Diese Laufart wird nicht in Stufen gesteigert.");
    return decide("hold");
  }
  if (runs.length < ADAPT_RUNS) {
    reasons.push(
      `Erst nach ${ADAPT_RUNS} Durchführungen passt Arnold die Stufe an (bisher ${runs.length}).`,
    );
    return decide("hold");
  }

  const rated = runs.map((run) => ({
    fulfilment: fulfilmentOf(run),
    over:
      run.rpe === null || run.rpe === undefined ? null : run.rpe - expected,
  }));
  const back = rated.every(
    (r) =>
      (r.over !== null && r.over >= ADAPT_BACK_RPE_OVER) ||
      (r.fulfilment !== null && r.fulfilment < ADAPT_BACK_FULFILMENT),
  );
  const next = rated.every(
    (r) =>
      r.fulfilment !== null &&
      r.fulfilment >= ADAPT_NEXT_FULFILMENT &&
      r.over !== null &&
      r.over <= 0,
  );

  const easy = EASY_CHECK_TYPES.includes(type)
    ? easyRunsTooHard(input.history)
    : { too_hard: false, shares: [] };
  const latestDecoupling =
    type === "long" ? decouplingPercent(runs[0]) : null;
  const extra: Partial<LevelDecision> = {
    easy_too_hard: easy.too_hard,
    decoupling_percent: latestDecoupling,
    suggest_walk_breaks: easy.too_hard && input.experience === "beginner",
  };

  if (back) {
    reasons.push(
      "Die letzten zwei Läufe dieser Art waren deutlich zu schwer (Anstrengung zwei Punkte über der Erwartung oder unter 75 % erfüllt): eine Stufe zurück.",
    );
    return decide(previous === 0 ? "hold" : "back", extra);
  }

  const blockers: string[] = [];
  if (easy.too_hard)
    blockers.push(
      `Lockere Läufe waren zu hart (${easy.shares.map(pct).join(" und ")} der Zeit über Zone 2): langsamer laufen` +
        (input.experience === "beginner" ? " und Gehpausen einbauen." : "."),
    );
  if (latestDecoupling !== null && latestDecoupling > LONG_DECOUPLING_MAX_PERCENT)
    blockers.push(
      `Puls-Entkopplung im letzten langen Lauf ${latestDecoupling.toFixed(1)} % (über ${LONG_DECOUPLING_MAX_PERCENT} %): den langen Lauf noch nicht verlängern.`,
    );

  if (next && blockers.length === 0) {
    if (previous >= ceiling) {
      reasons.push("Zweimal gut erfüllt, aber die höchste Stufe ist erreicht.");
      return decide("hold", extra);
    }
    reasons.push(
      "Zweimal mindestens 90 % erfüllt und die Anstrengung höchstens wie erwartet: nächste Stufe.",
    );
    return decide("next", extra);
  }

  reasons.push(...blockers);
  if (!next) {
    if (rated.some((r) => r.fulfilment === null || r.over === null))
      reasons.push(
        "Erfüllung oder Anstrengung eines Laufs ist unbekannt: Stufe halten.",
      );
    else
      reasons.push(
        "Anstrengung über der Erwartung oder nur 75 bis 90 % erfüllt: Stufe halten.",
      );
  }
  return decide("hold", extra);
}
