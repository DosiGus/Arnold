import {
  HARD_RUN_TYPES,
  jsonBytes,
  RUN_ENVIRONMENTS,
  RUN_TYPES,
  RUN_WATCH_BUDGET_BYTES,
  RunPrescriptionSchema,
  toCode,
  type RunEnvironment,
  type RunPrescription,
  type RunSegmentTuple,
  type RunType,
} from "../../shared/run-contract.js";
import {
  ASSUMED_EASY_PACE_S_PER_KM,
  CONTINUOUS_MINUTES,
  COOLDOWN_S,
  FARTLEK,
  FAST_FINISH_MINUTES,
  HILLS,
  HINT_TREADMILL,
  INTERVALS,
  REPETITIONS,
  RUN_EXPERIENCES,
  RUN_TYPE_HINTS,
  RUN_TYPE_NAMES,
  RUN_TYPE_RPE,
  RUN_WALK,
  RUN_WALK_BUFFER_S,
  STRIDES,
  TEMPO_MINUTES,
  TEST,
  THRESHOLD_INTERVALS,
  WARMUP_S,
  type RunExperience,
  type Span,
} from "./catalog.js";
import { describeZoneTarget, hrZones, type HrZones } from "./zones.js";
import {
  formatPace,
  paceMid,
  type PaceBand,
  type TempoZones,
  type VdotReason,
} from "./vdot.js";
import { RUN_RULES_VERSION } from "./version.js";

/**
 * The prescription of one run (ARN-RUN, spec "Laufarten", D-RUN-03/11/12/13):
 * run type, optional duration or distance, environment and experience in; a
 * compact prescription for the watch, the reasoning and the safety limits
 * that were applied out. Pure: no I/O, no clock.
 *
 * What always holds, whatever the input:
 * - Every prescription passes `RunPrescriptionSchema` and the watch budget
 *   (violations throw: that would be a bug of the engine, never a silent one).
 * - Pace targets only with a valid reference (`paces`), never on a treadmill
 *   (D-RUN-13) and never for a work segment under 2 min or 400 m (D-RUN-12).
 *   Without a pace the target is a heart-rate zone or an effort: no pace is
 *   ever made up.
 * - A pace alarm exists only if a segment has a pace target.
 * - Requested durations and distances are clamped to the limits of the run
 *   type and the experience; every clamp is reported in `adjustments`.
 *
 * Alarm contract with the watch (D-RUN-11): a heart-rate alarm compares with
 * the heart-rate target of the segment that is running (upper bound plus the
 * tolerance); warm-up and cool-down segments carry no heart-rate target and
 * so never raise one. The pace alarm compares with the pace band of the
 * segment. Both stay silent during the warm-up time of the alarm tuple and
 * are locked for the repeat lock after each signal.
 */

export type RunPlanFailure = "invalid_input" | "environment_not_supported";

export interface RunPlanInput {
  readonly run_type: RunType;
  readonly environment: RunEnvironment;
  readonly experience: RunExperience;
  /** Duration of the whole run in minutes (not together with `meters`). */
  readonly minutes?: number | null;
  /** Distance in metres (not together with `minutes`). */
  readonly meters?: number | null;
  /** Progression step of the session (0 = standard start of the experience). */
  readonly level?: number | null;
  /** Tempo zones from `referenceTempoZones`; null = no valid reference. */
  readonly paces?: TempoZones | null;
  /** Why there are no paces (for the explanation only). */
  readonly pace_reason?: VdotReason | null;
  /** Zones for the explanation in beats; without them "laut Uhr". */
  readonly hr_zones?: HrZones | null;
  /** Long run only: the last 10–15 minutes faster. */
  readonly fast_finish?: boolean;
  /** Alarm settings of the run profile; both on by default. */
  readonly alarms?: { readonly hr: boolean; readonly pace: boolean } | null;
}

export interface RunPlanAdjustment {
  readonly field: "minutes" | "meters" | "level";
  readonly requested: number;
  readonly applied: number;
  readonly reason: string;
}

export const RUN_PLAN_NOTE_CODES = [
  "beginner_hard",
  "distance_converted",
  "treadmill_distance_estimated",
  "treadmill_no_pace",
  "no_pace_reference",
  "hills_treadmill_incline",
  "test_treadmill_no_reference",
  "test_time_instead_of_distance",
  "level_at_ceiling",
  "level_not_used",
  "fast_finish_ignored",
  "recovery_not_progressive",
] as const;
export type RunPlanNoteCode = (typeof RUN_PLAN_NOTE_CODES)[number];

export interface RunPlanNote {
  readonly code: RunPlanNoteCode;
  readonly text: string;
}

export interface RunPlanSummary {
  readonly run_type: RunType;
  readonly environment: RunEnvironment;
  readonly experience: RunExperience;
  /** Level applied (0 = standard start). */
  readonly level: number;
  /** Highest level of this session type for the experience. */
  readonly level_ceiling: number;
  /** Planned time of the whole run; null for an open free run. */
  readonly total_s: number | null;
  /** Planned time of the work segments. */
  readonly work_s: number | null;
  /** Distance when the run is defined by distance, else null. */
  readonly distance_m: number | null;
  /** True when a distance was turned into time with a pace estimate. */
  readonly time_is_estimate: boolean;
  readonly hard: boolean;
  /** True when pace targets were prescribed. */
  readonly pace_targets: boolean;
}

export type RunPlan =
  | {
      readonly ok: true;
      readonly rules_version: string;
      readonly prescription: RunPrescription;
      readonly summary: RunPlanSummary;
      /** What the run is and why, in German, for the card and for ChatGPT. */
      readonly rationale: readonly string[];
      readonly adjustments: readonly RunPlanAdjustment[];
      readonly notes: readonly RunPlanNote[];
    }
  | {
      readonly ok: false;
      readonly reason: RunPlanFailure;
      readonly message: string;
    };

/** Types whose quality part gets a pace target when a reference exists. */
export const PACE_TARGET_TYPES: readonly RunType[] = [
  "progression",
  "tempo",
  "threshold_intervals",
  "intervals",
];

/** Alarm values (D-RUN-11): [dwell s, tolerance, warm-up s, repeat lock s]. */
export const ALARM_DEFAULTS = {
  hi: { dwell_s: 20, tolerance_bpm: 0, warmup_s: 300, lock_s: 60 },
  /** Recovery: zone 1 upper bound plus about half of zone 2 (spec). */
  hi_recovery_tolerance_bpm: 8,
  lo: { dwell_s: 30, tolerance_bpm: 0, lock_s: 60, settle_s: 180 },
  pace: { dwell_s: 15, tolerance_s_per_km: 3, warmup_s: 20, lock_s: 60 },
} as const;

/** A work segment gets a pace target only from this length on (D-RUN-12). */
export const PACE_MIN_SECONDS = 120;
export const PACE_MIN_METERS = 400;

/* ------------------------------------------------------------------ levels */

interface Dim {
  readonly key: string;
  readonly def: number;
  /** Largest value for a positive step, smallest for a negative one. */
  readonly limit: number;
  readonly step: number;
}
type StepMode = "alternate" | "together";

const saturated = (dim: Dim, value: number) =>
  dim.step > 0 ? value >= dim.limit : value <= dim.limit;

/**
 * Progression (spec "Anpassung nach Läufen", stages per run type): each level
 * changes the dimensions by their step. "alternate" changes one dimension per
 * level in turn (one repetition more, then 30 s longer; a saturated one is
 * skipped), "together" changes all at once.
 */
function stepLevels(dims: readonly Dim[], mode: StepMode, level: number) {
  const values: Record<string, number> = {};
  for (const dim of dims) values[dim.key] = dim.def;
  const history = [{ ...values }];
  let next = 0;
  for (let guard = 0; guard < 500; guard += 1) {
    const open = dims.filter((dim) => !saturated(dim, values[dim.key]));
    if (open.length === 0) break;
    const apply = (dim: Dim) => {
      const moved = values[dim.key] + dim.step;
      values[dim.key] =
        dim.step > 0 ? Math.min(dim.limit, moved) : Math.max(dim.limit, moved);
    };
    if (mode === "together") open.forEach(apply);
    else {
      let index = next;
      while (saturated(dims[index], values[dims[index].key]))
        index = (index + 1) % dims.length;
      apply(dims[index]);
      next = (index + 1) % dims.length;
    }
    history.push({ ...values });
  }
  const ceiling = history.length - 1;
  const applied = Math.min(Math.max(0, Math.floor(level)), ceiling);
  return { values: history[applied], applied, ceiling };
}

const up = (s: Span, step: number, key: string): Dim => ({
  key,
  def: s.def,
  limit: s.max,
  step,
});

/** Dimensions that progress with the level, per run type. */
function levelPlan(
  type: RunType,
  exp: RunExperience,
  byDistance: boolean,
): { dims: Dim[]; mode: StepMode } {
  switch (type) {
    case "base":
    case "long":
    case "progression": {
      const cfg = CONTINUOUS_MINUTES[type];
      return {
        dims: [up(cfg.span[exp], cfg.step, "minutes")],
        mode: "alternate",
      };
    }
    case "tempo":
      return {
        dims: [up(TEMPO_MINUTES[exp], 5, "minutes")],
        mode: "alternate",
      };
    case "threshold_intervals":
      return {
        dims: [
          up(THRESHOLD_INTERVALS.reps[exp], 1, "reps"),
          up(
            THRESHOLD_INTERVALS.work_s[exp],
            THRESHOLD_INTERVALS.step_s,
            "work",
          ),
        ],
        mode: "alternate",
      };
    case "intervals":
      return {
        dims: [
          up(INTERVALS.reps[exp], 1, "reps"),
          byDistance
            ? up(INTERVALS.work_m[exp], INTERVALS.step_m, "work")
            : up(INTERVALS.work_s[exp], INTERVALS.step_s, "work"),
        ],
        mode: "alternate",
      };
    case "repetitions":
      return {
        dims: [
          up(REPETITIONS.reps[exp], REPETITIONS.step_reps, "reps"),
          up(REPETITIONS.work_s[exp], REPETITIONS.step_s, "work"),
        ],
        mode: "alternate",
      };
    case "hills":
      return {
        dims: [
          up(HILLS.reps[exp], 1, "reps"),
          up(HILLS.work_s[exp], HILLS.step_s, "work"),
        ],
        mode: "alternate",
      };
    case "fartlek":
      return {
        dims: [
          up(FARTLEK.reps[exp], 1, "reps"),
          up(FARTLEK.fast_s[exp], FARTLEK.step_s, "work"),
        ],
        mode: "alternate",
      };
    case "strides":
      return { dims: [up(STRIDES.reps[exp], 1, "reps")], mode: "alternate" };
    case "run_walk": {
      const run = RUN_WALK.run_s[exp];
      const walk = RUN_WALK.walk_s[exp];
      return {
        dims: [
          {
            key: "run",
            def: run.def,
            limit: run.max,
            step: RUN_WALK.run_step_s,
          },
          {
            key: "walk",
            def: walk.def,
            limit: walk.min,
            step: -RUN_WALK.walk_step_s,
          },
        ],
        mode: "together",
      };
    }
    default:
      return { dims: [], mode: "alternate" };
  }
}

const runWalkTotalSeconds = (exp: RunExperience, run: number, walk: number) =>
  2 * RUN_WALK_BUFFER_S + RUN_WALK.reps[exp] * (run + walk);

/** Run-walk levels end before the session would exceed its largest total. */
function runWalkLevel(exp: RunExperience, level: number) {
  const { dims } = levelPlan("run_walk", exp, false);
  let ceiling = 0;
  for (let k = 1; k <= 200; k += 1) {
    const step = stepLevels(dims, "together", k);
    if (step.applied < k) break;
    if (
      runWalkTotalSeconds(exp, step.values.run, step.values.walk) >
      RUN_WALK.max_minutes[exp] * 60
    )
      break;
    ceiling = k;
  }
  const applied = Math.min(Math.max(0, Math.floor(level)), ceiling);
  return {
    values: stepLevels(dims, "together", applied).values,
    applied,
    ceiling,
  };
}

function resolveLevel(
  type: RunType,
  exp: RunExperience,
  level: number,
  byDistance: boolean,
) {
  if (type === "run_walk") return runWalkLevel(exp, level);
  const { dims, mode } = levelPlan(type, exp, byDistance);
  return stepLevels(dims, mode, level);
}

/** Intervals on a track with a reference run by distance (400–1200 m). */
export const intervalsByDistance = (
  type: RunType,
  environment: RunEnvironment,
  hasPaces: boolean,
) => type === "intervals" && environment === "track" && hasPaces;

/** Highest level of a run type for an experience (the week planner uses it). */
export function runLevelCeiling(
  type: RunType,
  experience: RunExperience,
  environment: RunEnvironment = "outdoor",
  hasPaces = false,
): number {
  return resolveLevel(
    type,
    experience,
    Number.MAX_SAFE_INTEGER,
    intervalsByDistance(type, environment, hasPaces),
  ).ceiling;
}

/* ---------------------------------------------------------------- building */

type Dur = readonly ["s", number] | readonly ["m", number] | readonly ["o"];
type Target = readonly [number, number, number];

const NONE: Target = [0, 0, 0];
const hr = (from: number, to: number): Target => [1, from, to];
const rpe = (from: number, to: number): Target => [4, from, to];
const paceTarget = (band: PaceBand): Target => [
  2,
  band.fast_s_per_km,
  band.slow_s_per_km,
];
const secs = (value: number): Dur => ["s", Math.round(value)];
const meters = (value: number): Dur => ["m", Math.round(value)];

const KIND = { warmup: 0, work: 1, recovery: 2, cooldown: 3 } as const;
const WARMUP_TARGET = rpe(2, 4);
const COOLDOWN_TARGET = rpe(1, 3);

class Builder {
  readonly segments: RunSegmentTuple[] = [];
  readonly repeats: [number, number, number][] = [];
  add(kind: number, dur: Dur, target: Target) {
    this.segments.push([
      kind,
      dur[0] === "o" ? 0 : dur[0] === "s" ? 1 : 2,
      dur[0] === "o" ? 0 : dur[1],
      target[0],
      target[1],
      target[2],
    ] as unknown as RunSegmentTuple);
  }
  /** The segments added by `body` run `count` times. */
  block(count: number, body: () => void) {
    const first = this.segments.length;
    body();
    this.repeats.push([first, this.segments.length - 1, count]);
  }
}

interface Context {
  readonly type: RunType;
  readonly env: RunEnvironment;
  readonly exp: RunExperience;
  readonly level: number;
  /** Tempo zones usable for targets (null on a treadmill or without a reference). */
  readonly paces: TempoZones | null;
  minutes: number | null;
  meters: number | null;
  readonly fastFinish: boolean;
  readonly builder: Builder;
  readonly notes: RunPlanNote[];
  readonly adjustments: RunPlanAdjustment[];
  /** What the run is, in words (set by the builder of the type). */
  description: string;
  /** Distance (m) when the run is defined by distance. */
  distance: number | null;
  /** True when a distance was turned into time with a pace estimate. */
  estimate: boolean;
  appliedLevel: number;
  levelCeiling: number;
  /** Pace bands of segments with a pace target, named for the explanation. */
  paceLines: string[];
}

const addNote = (ctx: Context, code: RunPlanNoteCode, text: string) => {
  if (!ctx.notes.some((n) => n.code === code)) ctx.notes.push({ code, text });
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const roundTo = (value: number, step: number) =>
  Math.round(value / step) * step;

/** Pace (s/km) that only turns a distance into a duration, never a target. */
const estimatedPace = (ctx: Context) =>
  ctx.paces ? paceMid(ctx.paces.e) : ASSUMED_EASY_PACE_S_PER_KM[ctx.exp];

function adjust(
  ctx: Context,
  field: RunPlanAdjustment["field"],
  requested: number,
  applied: number,
  reason: string,
) {
  if (requested !== applied)
    ctx.adjustments.push({ field, requested, applied, reason });
}

/** Level of the type; a requested duration or distance replaces the level. */
function useLevel(ctx: Context, byDistance = false) {
  const info = resolveLevel(ctx.type, ctx.exp, ctx.level, byDistance);
  ctx.levelCeiling = info.ceiling;
  if (ctx.minutes !== null || ctx.meters !== null) {
    if (ctx.level > 0)
      addNote(
        ctx,
        "level_not_used",
        "Weil Dauer oder Distanz genannt wurde, bestimmt sie den Umfang, nicht die Stufe.",
      );
    ctx.appliedLevel = 0;
    return resolveLevel(ctx.type, ctx.exp, 0, byDistance);
  }
  if (ctx.level > info.ceiling) {
    adjust(
      ctx,
      "level",
      ctx.level,
      info.ceiling,
      "Höchste Stufe dieser Laufart für diese Erfahrung erreicht.",
    );
    addNote(
      ctx,
      "level_at_ceiling",
      "Die höchste Stufe dieser Laufart ist erreicht; mehr Umfang kommt über andere Einheiten.",
    );
  }
  ctx.appliedLevel = info.applied;
  return info;
}

/** Requested total time of a structured session in seconds (null: none asked). */
function requestedSeconds(ctx: Context): number | null {
  if (ctx.minutes !== null) return ctx.minutes * 60;
  if (ctx.meters === null) return null;
  ctx.estimate = true;
  addNote(
    ctx,
    "distance_converted",
    "Diese Laufart wird nach Zeit geführt: die Distanz wurde mit einem vorsichtig geschätzten Lauftempo in Minuten umgerechnet.",
  );
  return Math.round((ctx.meters / 1000) * estimatedPace(ctx));
}

/** Number of repetitions that fits the requested total, inside its limits. */
function fitReps(
  ctx: Context,
  reps: Span,
  perRep: number,
  fixed: number,
  standard: number,
): number {
  const requested = requestedSeconds(ctx);
  if (requested === null) return standard;
  const fitted = clamp(
    Math.round((requested - fixed) / perRep),
    reps.min,
    reps.max,
  );
  const total = fixed + fitted * perRep;
  if (Math.abs(total - requested) >= 120)
    adjust(
      ctx,
      "minutes",
      Math.round(requested / 60),
      Math.round(total / 60),
      `${reps.min} bis ${reps.max} Wiederholungen für diese Laufart und Erfahrung.`,
    );
  return fitted;
}

/** Duration or distance of a continuous run, clamped to the type's limits. */
function resolveAmount(ctx: Context, limits: Span, levelMinutes: number) {
  const pace = estimatedPace(ctx);
  if (ctx.meters !== null) {
    const estimated = ((ctx.meters / 1000) * pace) / 60;
    const clamped = clamp(estimated, limits.min, limits.max);
    let appliedMeters = ctx.meters;
    if (clamped !== estimated) {
      appliedMeters = roundTo(((clamped * 60) / pace) * 1000, 100);
      adjust(
        ctx,
        "meters",
        ctx.meters,
        appliedMeters,
        `Sicherheitsgrenze: ${limits.min} bis ${limits.max} Minuten (bei geschätztem Lauftempo).`,
      );
    }
    if (ctx.env === "treadmill") {
      ctx.estimate = true;
      addNote(
        ctx,
        "treadmill_distance_estimated",
        "Auf dem Laufband läuft die Einheit nach Zeit; die Distanz ist nur geschätzt.",
      );
      return { minutes: Math.round(clamped), meters: null };
    }
    return { minutes: clamped, meters: appliedMeters };
  }
  if (ctx.minutes !== null) {
    const clamped = clamp(ctx.minutes, limits.min, limits.max);
    adjust(
      ctx,
      "minutes",
      ctx.minutes,
      clamped,
      `Sicherheitsgrenze: ${limits.min} bis ${limits.max} Minuten für diese Laufart und Erfahrung.`,
    );
    return { minutes: clamped, meters: null };
  }
  return { minutes: levelMinutes, meters: null };
}

const kmText = (m: number) =>
  `${(m / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`;

function buildContinuous(
  ctx: Context,
  type: "recovery" | "base" | "long" | "free",
) {
  const limits = CONTINUOUS_MINUTES[type].span[ctx.exp];
  const b = ctx.builder;
  const target: Target =
    type === "free" ? NONE : type === "recovery" ? hr(1, 1) : hr(1, 2);
  if (type === "recovery" && ctx.level > 0)
    addNote(
      ctx,
      "recovery_not_progressive",
      "Regeneration wird nicht gesteigert: sie bleibt kurz und locker.",
    );
  const info = useLevel(ctx);
  if (type === "free" && ctx.minutes === null && ctx.meters === null) {
    b.add(KIND.work, ["o"], target);
    ctx.description = "Freier Lauf, offen bis zum Ende.";
    return;
  }
  const amount = resolveAmount(ctx, limits, info.values.minutes ?? limits.def);
  if (amount.meters !== null) {
    b.add(KIND.work, meters(amount.meters), target);
    ctx.distance = amount.meters;
    ctx.description = `${kmText(amount.meters)}${type === "free" ? "" : " locker"}.`;
    if (type === "long" && ctx.fastFinish)
      addNote(
        ctx,
        "fast_finish_ignored",
        "Der schnellere Schluss gilt nur bei Läufen nach Zeit; bei einer Distanz entfällt er.",
      );
    return;
  }
  const minutes = Math.round(amount.minutes);
  if (type === "long" && ctx.fastFinish) {
    const fast = FAST_FINISH_MINUTES[ctx.exp];
    if (ctx.exp === "beginner" || minutes < 60) {
      addNote(
        ctx,
        "fast_finish_ignored",
        ctx.exp === "beginner"
          ? "Einsteiger laufen den langen Lauf gleichmäßig locker; der schnellere Schluss entfällt."
          : "Ein schnellerer Schluss lohnt erst ab 60 Minuten Laufzeit.",
      );
    } else {
      b.add(KIND.work, secs((minutes - fast) * 60), target);
      b.add(KIND.work, secs(fast * 60), hr(3, 3));
      ctx.description = `${minutes} Minuten, die letzten ${fast} Minuten zügiger (Zone 3).`;
      return;
    }
  }
  b.add(KIND.work, secs(minutes * 60), target);
  ctx.description =
    type === "free"
      ? `${minutes} Minuten ohne Ziel.`
      : `${minutes} Minuten ${type === "recovery" ? "sehr " : ""}locker.`;
}

/** A pace target (or the fallback) for one work segment. */
function workTarget(
  ctx: Context,
  band: PaceBand | null,
  label: string,
  fallback: Target,
  workSeconds: number | null,
  workMeters: number | null = null,
): Target {
  const long =
    (workSeconds !== null && workSeconds >= PACE_MIN_SECONDS) ||
    (workMeters !== null && workMeters >= PACE_MIN_METERS);
  if (ctx.paces && band && long) {
    const line = `${label} ${formatPace(band.fast_s_per_km)}–${formatPace(band.slow_s_per_km)} /km`;
    if (!ctx.paceLines.includes(line)) ctx.paceLines.push(line);
    return paceTarget(band);
  }
  return fallback;
}

function buildProgression(ctx: Context) {
  const limits = CONTINUOUS_MINUTES.progression.span[ctx.exp];
  const info = useLevel(ctx);
  const amount = resolveAmount(ctx, limits, info.values.minutes ?? limits.def);
  const b = ctx.builder;
  const zones = ctx.paces;
  const hard = zones
    ? ({
        fast_s_per_km: paceMid(zones.t),
        slow_s_per_km: zones.t.slow_s_per_km,
      } satisfies PaceBand)
    : null;
  const thirds: Target[] = [
    hr(1, 2),
    hr(3, 3),
    hard
      ? workTarget(ctx, hard, "unteres Schwellentempo", hr(4, 4), 600)
      : hr(4, 4),
  ];
  if (amount.meters !== null) {
    const third = Math.max(100, roundTo(amount.meters / 3, 100));
    thirds.forEach((target, i) =>
      b.add(
        KIND.work,
        meters(i === 2 ? Math.max(100, amount.meters! - 2 * third) : third),
        i === 2 && hard
          ? workTarget(
              ctx,
              hard,
              "unteres Schwellentempo",
              hr(4, 4),
              null,
              third,
            )
          : target,
      ),
    );
    ctx.distance = amount.meters;
    ctx.description = `${kmText(amount.meters)} in drei Dritteln, jedes etwas schneller.`;
    return;
  }
  const minutes = Math.round(amount.minutes);
  const third = Math.round((minutes * 60) / 3);
  thirds.forEach((target, i) =>
    b.add(KIND.work, secs(i === 2 ? minutes * 60 - 2 * third : third), target),
  );
  ctx.description = `${minutes} Minuten in drei Dritteln: locker, zügig, nahe Schwellentempo.`;
}

function buildTempo(ctx: Context) {
  const span = TEMPO_MINUTES[ctx.exp];
  const info = useLevel(ctx);
  const warm = WARMUP_S[ctx.exp];
  let minutes = info.values.minutes ?? span.def;
  const requested = requestedSeconds(ctx);
  if (requested !== null) {
    minutes = clamp(
      Math.round((requested - warm - COOLDOWN_S) / 60),
      span.min,
      span.max,
    );
    const total = warm + COOLDOWN_S + minutes * 60;
    if (Math.abs(total - requested) >= 120)
      adjust(
        ctx,
        "minutes",
        Math.round(requested / 60),
        Math.round(total / 60),
        `Schwellenteil ${span.min} bis ${span.max} Minuten für diese Erfahrung.`,
      );
  }
  const b = ctx.builder;
  b.add(KIND.warmup, secs(warm), WARMUP_TARGET);
  b.add(
    KIND.work,
    secs(minutes * 60),
    workTarget(
      ctx,
      ctx.paces?.t ?? null,
      "Schwelle (T)",
      hr(4, 4),
      minutes * 60,
    ),
  );
  b.add(KIND.cooldown, secs(COOLDOWN_S), COOLDOWN_TARGET);
  ctx.description = `${warm / 60} Minuten einlaufen, ${minutes} Minuten Schwelle, ${COOLDOWN_S / 60} Minuten auslaufen.`;
}

function buildThresholdIntervals(ctx: Context) {
  const exp = ctx.exp;
  const info = useLevel(ctx);
  const warm = WARMUP_S[exp];
  const work = info.values.work;
  const rest = THRESHOLD_INTERVALS.rest_s[exp];
  const reps = fitReps(
    ctx,
    THRESHOLD_INTERVALS.reps[exp],
    work + rest,
    warm + COOLDOWN_S,
    info.values.reps,
  );
  const b = ctx.builder;
  b.add(KIND.warmup, secs(warm), WARMUP_TARGET);
  b.block(reps, () => {
    b.add(
      KIND.work,
      secs(work),
      workTarget(ctx, ctx.paces?.t ?? null, "Schwelle (T)", hr(4, 4), work),
    );
    b.add(KIND.recovery, secs(rest), NONE);
  });
  b.add(KIND.cooldown, secs(COOLDOWN_S), COOLDOWN_TARGET);
  ctx.description = `${warm / 60} Minuten einlaufen, ${reps} × ${work / 60} Minuten Schwelle mit ${rest} s Trabpause, ${COOLDOWN_S / 60} Minuten auslaufen.`;
}

function buildIntervals(ctx: Context) {
  const exp = ctx.exp;
  const byDistance = intervalsByDistance(ctx.type, ctx.env, ctx.paces !== null);
  const info = useLevel(ctx, byDistance);
  const warm = WARMUP_S[exp];
  const work = info.values.work;
  // Recovery as long as the work (spec); by distance the work time comes from
  // the interval pace of the reference.
  const workSeconds = byDistance
    ? roundTo((work / 1000) * paceMid(ctx.paces!.i), 5)
    : work;
  const reps = fitReps(
    ctx,
    INTERVALS.reps[exp],
    2 * workSeconds,
    warm + COOLDOWN_S,
    info.values.reps,
  );
  const b = ctx.builder;
  b.add(KIND.warmup, secs(warm), WARMUP_TARGET);
  b.block(reps, () => {
    b.add(
      KIND.work,
      byDistance ? meters(work) : secs(work),
      workTarget(
        ctx,
        ctx.paces?.i ?? null,
        "Intervall (I)",
        rpe(8, 9),
        byDistance ? null : work,
        byDistance ? work : null,
      ),
    );
    b.add(KIND.recovery, secs(workSeconds), NONE);
  });
  b.add(KIND.cooldown, secs(COOLDOWN_S), COOLDOWN_TARGET);
  const piece = byDistance ? `${work} m` : `${work / 60} Minuten`;
  ctx.description = `${warm / 60} Minuten einlaufen, ${reps} × ${piece} schnell mit gleich langer Trabpause, ${COOLDOWN_S / 60} Minuten auslaufen.`;
}

function buildRepetitions(ctx: Context) {
  const exp = ctx.exp;
  const info = useLevel(ctx);
  const warm = WARMUP_S[exp];
  const work = info.values.work;
  const rest = REPETITIONS.rest_s[exp];
  const reps = fitReps(
    ctx,
    REPETITIONS.reps[exp],
    work + rest,
    warm + COOLDOWN_S,
    info.values.reps,
  );
  const b = ctx.builder;
  b.add(KIND.warmup, secs(warm), WARMUP_TARGET);
  b.block(reps, () => {
    b.add(KIND.work, secs(work), rpe(7, 9));
    b.add(KIND.recovery, secs(rest), NONE);
  });
  b.add(KIND.cooldown, secs(COOLDOWN_S), COOLDOWN_TARGET);
  ctx.description = `${warm / 60} Minuten einlaufen, ${reps} × ${work} s schnell mit ${rest} s Pause, ${COOLDOWN_S / 60} Minuten auslaufen.`;
}

function buildStrides(ctx: Context) {
  const exp = ctx.exp;
  const info = useLevel(ctx);
  const main = STRIDES.main_minutes[exp];
  const stride = STRIDES.stride_s[exp];
  const rest = STRIDES.rest_s[exp];
  const reps = info.values.reps;
  const block = reps * (stride + rest);
  let minutes = main.def;
  const requested = requestedSeconds(ctx);
  if (requested !== null) {
    minutes = clamp(Math.round((requested - block) / 60), main.min, main.max);
    const total = minutes * 60 + block;
    if (Math.abs(total - requested) >= 120)
      adjust(
        ctx,
        "minutes",
        Math.round(requested / 60),
        Math.round(total / 60),
        `Lockerer Teil ${main.min} bis ${main.max} Minuten für diese Erfahrung.`,
      );
  }
  const b = ctx.builder;
  b.add(KIND.work, secs(minutes * 60), hr(1, 2));
  b.block(reps, () => {
    b.add(KIND.work, secs(stride), rpe(5, 7));
    b.add(KIND.recovery, secs(rest), NONE);
  });
  ctx.description = `${minutes} Minuten locker, danach ${reps} × ${stride} s Steigerung mit ${rest} s Gehen oder Traben.`;
}

function buildHills(ctx: Context) {
  const exp = ctx.exp;
  const info = useLevel(ctx);
  const warm = WARMUP_S[exp];
  const work = info.values.work;
  const rest = Math.ceil((work * HILLS.rest_factor) / 5) * 5;
  const reps = fitReps(
    ctx,
    HILLS.reps[exp],
    work + rest,
    warm + COOLDOWN_S,
    info.values.reps,
  );
  const b = ctx.builder;
  b.add(KIND.warmup, secs(warm), WARMUP_TARGET);
  b.block(reps, () => {
    b.add(KIND.work, secs(work), rpe(7, 8));
    b.add(KIND.recovery, secs(rest), NONE);
  });
  b.add(KIND.cooldown, secs(COOLDOWN_S), COOLDOWN_TARGET);
  ctx.description = `${warm / 60} Minuten einlaufen, ${reps} × ${work} s bergauf hart, ${rest} s bergab traben, ${COOLDOWN_S / 60} Minuten auslaufen.`;
  if (ctx.env === "treadmill")
    addNote(
      ctx,
      "hills_treadmill_incline",
      "Auf dem Laufband die Steigung für die Belastung selbst einstellen und danach wieder flach stellen.",
    );
}

function buildFartlek(ctx: Context) {
  const exp = ctx.exp;
  const info = useLevel(ctx);
  const warm = FARTLEK.warmup_s[exp];
  const fast = info.values.work;
  const easy = FARTLEK.easy_s[exp];
  const reps = fitReps(
    ctx,
    FARTLEK.reps[exp],
    fast + easy,
    warm + COOLDOWN_S,
    info.values.reps,
  );
  const b = ctx.builder;
  b.add(KIND.warmup, secs(warm), WARMUP_TARGET);
  b.block(reps, () => {
    b.add(KIND.work, secs(fast), rpe(6, 7));
    b.add(KIND.recovery, secs(easy), NONE);
  });
  b.add(KIND.cooldown, secs(COOLDOWN_S), COOLDOWN_TARGET);
  ctx.description = `${warm / 60} Minuten einlaufen, ${reps} × (${fast} s zügig, ${easy} s locker), ${COOLDOWN_S / 60} Minuten auslaufen.`;
}

function buildRunWalk(ctx: Context) {
  const exp = ctx.exp;
  const info = useLevel(ctx);
  const run = info.values.run;
  const walk = info.values.walk;
  const fixed = 2 * RUN_WALK_BUFFER_S;
  let reps = RUN_WALK.reps[exp];
  const requested = requestedSeconds(ctx);
  if (requested !== null) {
    const most = Math.floor(
      (RUN_WALK.max_minutes[exp] * 60 - fixed) / (run + walk),
    );
    const least = Math.max(
      3,
      Math.ceil((RUN_WALK.min_minutes * 60 - fixed) / (run + walk)),
    );
    reps = clamp(
      Math.round((requested - fixed) / (run + walk)),
      least,
      Math.max(least, most),
    );
    const total = fixed + reps * (run + walk);
    if (Math.abs(total - requested) >= 120)
      adjust(
        ctx,
        "minutes",
        Math.round(requested / 60),
        Math.round(total / 60),
        `${RUN_WALK.min_minutes} bis ${RUN_WALK.max_minutes[exp]} Minuten Gesamtdauer für diese Erfahrung.`,
      );
  }
  const b = ctx.builder;
  b.add(KIND.warmup, secs(RUN_WALK_BUFFER_S), NONE);
  b.block(reps, () => {
    b.add(KIND.work, secs(run), hr(1, 2));
    b.add(KIND.recovery, secs(walk), NONE);
  });
  b.add(KIND.cooldown, secs(RUN_WALK_BUFFER_S), NONE);
  ctx.description = `${RUN_WALK_BUFFER_S / 60} Minuten gehen, ${reps} × (${run} s laufen, ${walk} s gehen), ${RUN_WALK_BUFFER_S / 60} Minuten auslaufen.`;
}

function buildTest(ctx: Context) {
  const exp = ctx.exp;
  const warm = TEST.warmup_s[exp];
  const b = ctx.builder;
  const treadmill = ctx.env === "treadmill";
  let testMeters: number | null = null;
  if (ctx.minutes !== null) {
    // Only the 30-minute test exists as a time test.
    adjust(
      ctx,
      "minutes",
      ctx.minutes,
      TEST.time_s / 60,
      "Der Zeittest dauert 30 Minuten.",
    );
  } else if (ctx.meters !== null) {
    if (treadmill) {
      addNote(
        ctx,
        "test_time_instead_of_distance",
        "Auf dem Laufband ist die Distanz nur geschätzt: Arnold plant statt des Distanztests den 30-Minuten-Test.",
      );
    } else {
      testMeters = clamp(ctx.meters, TEST.min_m, TEST.max_m[exp]);
      adjust(
        ctx,
        "meters",
        ctx.meters,
        testMeters,
        `Testdistanz ${TEST.min_m / 1000} bis ${TEST.max_m[exp] / 1000} km für diese Erfahrung.`,
      );
    }
  } else if (!treadmill) testMeters = TEST.default_m;
  if (treadmill)
    addNote(
      ctx,
      "test_treadmill_no_reference",
      "Ein Laufbandtest kann nicht als Referenzleistung dienen: seine Distanz ist nur geschätzt.",
    );
  b.add(KIND.warmup, secs(warm), WARMUP_TARGET);
  if (testMeters !== null) {
    b.add(KIND.work, meters(testMeters), NONE);
    ctx.distance = testMeters;
    ctx.description = `${warm / 60} Minuten einlaufen, ${kmText(testMeters)} so schnell wie möglich gleichmäßig, ${COOLDOWN_S / 60} Minuten auslaufen.`;
  } else {
    b.add(KIND.work, secs(TEST.time_s), NONE);
    ctx.description = `${warm / 60} Minuten einlaufen, 30 Minuten gleichmäßig so schnell wie möglich, ${COOLDOWN_S / 60} Minuten auslaufen.`;
  }
  b.add(KIND.cooldown, secs(COOLDOWN_S), COOLDOWN_TARGET);
}

/* ----------------------------------------------------------- derived values */

function expandedSegments(b: Builder): RunSegmentTuple[] {
  const out: RunSegmentTuple[] = [];
  let i = 0;
  const repeatAt = new Map(b.repeats.map((r) => [r[0], r]));
  while (i < b.segments.length) {
    const rep = repeatAt.get(i);
    if (rep) {
      for (let n = 0; n < rep[2]; n += 1)
        for (let j = rep[0]; j <= rep[1]; j += 1) out.push(b.segments[j]);
      i = rep[1] + 1;
    } else {
      out.push(b.segments[i]);
      i += 1;
    }
  }
  return out;
}

function segmentSeconds(seg: RunSegmentTuple, ctx: Context): number | null {
  if (seg[1] === 0) return null;
  if (seg[1] === 1) return seg[2];
  const pace = seg[3] === 2 ? (seg[4] + seg[5]) / 2 : estimatedPace(ctx);
  return Math.round((seg[2] / 1000) * pace);
}

function summarize(ctx: Context, input: RunPlanInput) {
  const segments = expandedSegments(ctx.builder);
  let total: number | null = 0;
  let work: number | null = 0;
  let estimated = ctx.estimate;
  for (const seg of segments) {
    const seconds = segmentSeconds(seg, ctx);
    if (seconds === null) {
      total = null;
      work = null;
      break;
    }
    if (seg[1] === 2) estimated = true;
    total! += seconds;
    if (seg[0] === KIND.work) work! += seconds;
  }
  return {
    total_s: total,
    work_s: work,
    time_is_estimate: estimated,
    distance_m: ctx.distance,
    input,
  };
}

type AlarmTuple = readonly [number, number, number, number];

/** Alarms of the prescription (D-RUN-11/12), from the targets it contains. */
function buildAlarms(
  ctx: Context,
  segments: readonly RunSegmentTuple[],
  enabled: { hr: boolean; pace: boolean },
): { hi?: AlarmTuple; lo?: AlarmTuple; pace?: AlarmTuple } {
  const work = ctx.builder.segments.filter((s) => s[0] === KIND.work);
  const hrWork = work.filter((s) => s[3] === 1 || s[3] === 3);
  const paceWork = work.filter(
    (s) =>
      s[3] === 2 &&
      ((s[1] === 1 && s[2] >= PACE_MIN_SECONDS) ||
        (s[1] === 2 && s[2] >= PACE_MIN_METERS)),
  );
  const alarms: { hi?: AlarmTuple; lo?: AlarmTuple; pace?: AlarmTuple } = {};
  if (enabled.hr && hrWork.length > 0) {
    alarms.hi = [
      ALARM_DEFAULTS.hi.dwell_s,
      ctx.type === "recovery"
        ? ALARM_DEFAULTS.hi_recovery_tolerance_bpm
        : ALARM_DEFAULTS.hi.tolerance_bpm,
      ALARM_DEFAULTS.hi.warmup_s,
      ALARM_DEFAULTS.hi.lock_s,
    ];
    // Too low only where the heart rate is the target of quality work.
    if (ctx.type === "tempo" || ctx.type === "threshold_intervals") {
      let before = 0;
      for (const seg of segments) {
        if (seg[0] === KIND.work) break;
        before += seg[1] === 1 ? seg[2] : 0;
      }
      alarms.lo = [
        ALARM_DEFAULTS.lo.dwell_s,
        ALARM_DEFAULTS.lo.tolerance_bpm,
        Math.min(3600, before + ALARM_DEFAULTS.lo.settle_s),
        ALARM_DEFAULTS.lo.lock_s,
      ];
    }
  }
  if (enabled.pace && paceWork.length > 0)
    alarms.pace = [
      ALARM_DEFAULTS.pace.dwell_s,
      ALARM_DEFAULTS.pace.tolerance_s_per_km,
      ALARM_DEFAULTS.pace.warmup_s,
      ALARM_DEFAULTS.pace.lock_s,
    ];
  return alarms;
}

const WHY: Readonly<Record<RunType, string>> = {
  recovery:
    "Sehr lockere Läufe fördern die Erholung zwischen harten Einheiten, ohne zusätzlichen Stress aufzubauen.",
  base: "Lockere Grundlagenläufe bauen die Ausdauer auf; der größte Teil der Laufzeit gehört in Zone 1 bis 2.",
  long: "Der lange Lauf trainiert die Ausdauer und bleibt locker (Zone 1 bis 2), damit er gut verträglich ist.",
  progression:
    "Ein Steigerungslauf endet schneller, als er beginnt: so übst du Tempogefühl, ohne am Anfang zu überziehen.",
  tempo:
    "Der Tempodauerlauf trainiert, länger gleichmäßig schnell zu laufen: er verschiebt die Schwelle nach oben.",
  threshold_intervals:
    "Schwellenintervalle bringen mehr Zeit im Schwellentempo als ein Dauerlauf, weil die Trabpausen erholen.",
  intervals:
    "Intervalle im Bereich der maximalen Sauerstoffaufnahme; die Erholung ist so lang wie die Belastung.",
  repetitions:
    "Kurze schnelle Wiederholungen verbessern Schnelligkeit und Laufökonomie; die langen Pausen halten die Qualität hoch.",
  strides:
    "Kurze Steigerungen halten die Beine locker und schnell und ermüden kaum; sie hängen an einem lockeren Lauf.",
  hills:
    "Bergläufe kräftigen Beine und Laufstil mit wenig Tempo-Stress; geführt wird nach Anstrengung, nicht nach Tempo.",
  fartlek:
    "Das Fahrtspiel bringt Tempowechsel nach Zeit ohne feste Tempovorgabe; gut für Abwechslung und Gefühl.",
  run_walk:
    "Gehpausen machen Laufen verträglich und lassen die Ausdauer wachsen; mit jeder Stufe wird der Laufteil länger.",
  test: "Test oder Wettkampf liefern eine Referenzleistung, aus der Arnold deine Tempozonen berechnet.",
  free: "Freier Lauf: Arnold zeichnet auf, ohne etwas vorzugeben.",
};

const VDOT_REASON_TEXT: Readonly<Record<VdotReason, string>> = {
  reference_missing: "Es gibt noch keine Referenzleistung",
  reference_source_invalid:
    "Die Referenzleistung stammt nicht aus Test, Wettkampf oder deiner Angabe",
  reference_distance_out_of_range:
    "Die Referenzleistung liegt nicht zwischen 3 und 21,1 km",
  reference_time_invalid: "Die Zeit der Referenzleistung ist ungültig",
  reference_date_invalid: "Das Datum der Referenzleistung ist ungültig",
  reference_in_future: "Die Referenzleistung liegt in der Zukunft",
  reference_too_old: "Die Referenzleistung ist älter als 12 Wochen",
  vdot_below_table:
    "Die Referenzleistung liegt unter dem Bereich der Tempotabelle",
  vdot_above_table:
    "Die Referenzleistung liegt über dem Bereich der Tempotabelle",
};

function explain(
  ctx: Context,
  input: RunPlanInput,
  alarms: { hi?: AlarmTuple; lo?: AlarmTuple; pace?: AlarmTuple },
  segments: readonly RunSegmentTuple[],
): string[] {
  const lines = [
    `${RUN_TYPE_NAMES[ctx.type]}: ${ctx.description}`,
    WHY[ctx.type],
  ];
  const zones = input.hr_zones ?? hrZones();
  const zoneTargets = new Set<string>();
  for (const seg of segments)
    if (seg[0] === KIND.work && seg[3] === 1)
      zoneTargets.add(describeZoneTarget(zones, seg[4], seg[5]));
  if (zoneTargets.size > 0)
    lines.push(`Pulsziel: ${[...zoneTargets].join(", dann ")}.`);
  if (ctx.paceLines.length > 0)
    lines.push(
      `Tempoziel aus deiner Referenzleistung (VDOT ${ctx.paces!.vdot.toFixed(1)}): ${ctx.paceLines.join("; ")}.`,
    );
  const wantsPace = PACE_TARGET_TYPES.includes(ctx.type);
  if (wantsPace && ctx.env === "treadmill")
    lines.push(
      "Auf dem Laufband gibt es kein Tempoziel: geführt wird nach Zeit, Puls und Anstrengung.",
    );
  else if (wantsPace && ctx.paceLines.length === 0 && ctx.paces === null)
    lines.push(
      `${input.pace_reason ? `${VDOT_REASON_TEXT[input.pace_reason]}: ` : "Ohne gültige Referenzleistung: "}Arnold steuert nach Puls und Anstrengung, nicht nach Tempo.`,
    );
  if (segments.some((s) => s[0] === KIND.work && s[3] === 4))
    lines.push(
      "Anstrengungsziele (1 sehr leicht bis 10 maximal) statt Tempo: bei kurzen Belastungen reagiert das GPS-Tempo zu träge.",
    );
  if (alarms.hi) {
    const [dwell, tol, warm, lock] = alarms.hi;
    lines.push(
      `Pulsalarm: ${dwell} s über der Zielgrenze${tol > 0 ? ` (plus ${tol} Schläge)` : ""} lösen eine Vibration aus; in den ersten ${warm / 60} Minuten und im Aufwärmen bleibt die Uhr ruhig, danach frühestens alle ${lock} s.`,
    );
  }
  if (alarms.lo)
    lines.push(
      `Zu niedriger Puls: ${alarms.lo[0]} s unter der Untergrenze der Belastung: eine kurze Vibration.`,
    );
  if (alarms.pace)
    lines.push(
      `Tempoalarm: ${alarms.pace[0]} s außerhalb des Tempobands in Belastungen ab 2 Minuten oder 400 m; die ersten ${alarms.pace[2]} s eines Abschnitts sind ausgenommen.`,
    );
  if (
    segments.some(
      (s) =>
        s[0] === KIND.work &&
        ((s[1] === 1 && s[2] < PACE_MIN_SECONDS) ||
          (s[1] === 2 && s[2] < PACE_MIN_METERS)),
    )
  )
    lines.push(
      "Belastungen unter 2 Minuten oder 400 m laufen ohne Tempoalarm: die Uhr zählt nur Zeit und Countdown herunter.",
    );
  return lines;
}

const BUILDERS: Readonly<Record<RunType, (ctx: Context) => void>> = {
  recovery: (ctx) => buildContinuous(ctx, "recovery"),
  base: (ctx) => buildContinuous(ctx, "base"),
  long: (ctx) => buildContinuous(ctx, "long"),
  free: (ctx) => buildContinuous(ctx, "free"),
  progression: buildProgression,
  tempo: buildTempo,
  threshold_intervals: buildThresholdIntervals,
  intervals: buildIntervals,
  repetitions: buildRepetitions,
  strides: buildStrides,
  hills: buildHills,
  fartlek: buildFartlek,
  run_walk: buildRunWalk,
  test: buildTest,
};

const invalid = (message: string): RunPlan => ({
  ok: false,
  reason: "invalid_input",
  message,
});

const positiveNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Prescription of one run. Returns a refusal (never a guess) for input that
 * makes no sense; everything else yields a safe prescription, clamped where
 * needed and explained in `adjustments`, `notes` and `rationale`.
 */
export function buildRunPrescription(input: RunPlanInput): RunPlan {
  if (!(RUN_TYPES as readonly string[]).includes(input.run_type))
    return invalid("Unbekannte Laufart.");
  if (!(RUN_ENVIRONMENTS as readonly string[]).includes(input.environment))
    return invalid("Unbekannte Umgebung.");
  if (!(RUN_EXPERIENCES as readonly string[]).includes(input.experience))
    return invalid("Unbekannte Erfahrung.");
  const minutes = input.minutes ?? null;
  const metersAsked = input.meters ?? null;
  if (minutes !== null && !positiveNumber(minutes))
    return invalid("Die Dauer muss eine positive Zahl in Minuten sein.");
  if (metersAsked !== null && !positiveNumber(metersAsked))
    return invalid("Die Distanz muss eine positive Zahl in Metern sein.");
  if (minutes !== null && metersAsked !== null)
    return invalid("Dauer oder Distanz, nicht beides.");
  const level = input.level ?? 0;
  if (typeof level !== "number" || !Number.isFinite(level) || level < 0)
    return invalid("Die Stufe muss 0 oder größer sein.");
  if (input.run_type === "hills" && input.environment === "track")
    return {
      ok: false,
      reason: "environment_not_supported",
      message: "Bergläufe brauchen eine Steigung: nicht auf der Bahn.",
    };

  const type = input.run_type;
  const env = input.environment;
  const exp = input.experience;
  const builder = new Builder();
  const ctx: Context = {
    type,
    env,
    exp,
    level: Math.floor(level),
    paces: env === "treadmill" ? null : (input.paces ?? null),
    minutes: minutes === null ? null : Math.max(1, Math.round(minutes)),
    meters: metersAsked === null ? null : Math.max(1, Math.round(metersAsked)),
    fastFinish: input.fast_finish === true,
    builder,
    notes: [],
    adjustments: [],
    description: "",
    distance: null,
    estimate: false,
    appliedLevel: 0,
    levelCeiling: 0,
    paceLines: [],
  };
  if (PACE_TARGET_TYPES.includes(type) && input.paces) {
    if (env === "treadmill")
      addNote(
        ctx,
        "treadmill_no_pace",
        "Auf dem Laufband gibt es keine Tempoziele (GPS-frei, Distanz geschätzt): Arnold führt nach Zeit und Puls.",
      );
  } else if (PACE_TARGET_TYPES.includes(type) && env !== "treadmill") {
    addNote(
      ctx,
      "no_pace_reference",
      "Ohne gültige Referenzleistung (Test oder Wettkampf, höchstens 12 Wochen alt) gibt es keine Tempoziele: Arnold führt nach Puls und Anstrengung.",
    );
  }
  if (HARD_RUN_TYPES.includes(type) && exp === "beginner")
    addNote(
      ctx,
      "beginner_hard",
      "Harte Einheit für Einsteiger: bewusst kurz und mit Grenzen; höchstens eine harte Einheit pro Woche.",
    );

  BUILDERS[type](ctx);

  const enabled = {
    hr: input.alarms?.hr ?? true,
    pace: input.alarms?.pace ?? true,
  };
  const expanded = expandedSegments(builder);
  const alarms = buildAlarms(ctx, builder.segments, enabled);
  const sum = summarize(ctx, input);

  const raw: Record<string, unknown> = {
    k: toCode(RUN_TYPES, type),
    n: RUN_TYPE_NAMES[type],
    e: toCode(RUN_ENVIRONMENTS, env),
    s: builder.segments,
    h: RUN_TYPE_HINTS[type] + (env === "treadmill" ? HINT_TREADMILL : ""),
  };
  if (builder.repeats.length > 0) raw.rp = builder.repeats;
  if (Object.keys(alarms).length > 0) raw.a = alarms;
  if (type === "long" && sum.total_s !== null && sum.total_s >= 3600)
    raw.dr = [60, 30];
  const expected = RUN_TYPE_RPE[type].expected;
  if (expected !== null) raw.r = expected;

  const prescription = RunPrescriptionSchema.parse(raw);
  const bytes = jsonBytes(prescription);
  if (bytes > RUN_WATCH_BUDGET_BYTES.prescription)
    throw new Error(
      `Prescription of ${type} is ${bytes} bytes, over the budget of ${RUN_WATCH_BUDGET_BYTES.prescription}.`,
    );

  return {
    ok: true,
    rules_version: RUN_RULES_VERSION,
    prescription,
    summary: {
      run_type: type,
      environment: env,
      experience: exp,
      level: ctx.appliedLevel,
      level_ceiling: ctx.levelCeiling,
      total_s: sum.total_s,
      work_s: sum.work_s,
      distance_m: sum.distance_m,
      time_is_estimate: sum.time_is_estimate,
      hard: HARD_RUN_TYPES.includes(type),
      pace_targets: expanded.some((s) => s[3] === 2),
    },
    rationale: explain(ctx, input, alarms, builder.segments),
    adjustments: ctx.adjustments,
    notes: ctx.notes,
  };
}

/** The standard session of a run type for an experience and environment. */
export const standardRunPlan = (
  type: RunType,
  experience: RunExperience,
  environment: RunEnvironment,
  paces: TempoZones | null = null,
) =>
  buildRunPrescription({
    run_type: type,
    environment,
    experience,
    paces,
  });
