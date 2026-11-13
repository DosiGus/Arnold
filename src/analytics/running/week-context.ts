import type { RunEnvironment, RunType } from "../../shared/run-contract.js";
import {
  addDays,
  compareDate,
  daysBetween,
  isCalendarDate,
  weekStart,
} from "../period.js";
import {
  CONTINUOUS_MINUTES,
  runExperience,
  type RunExperience,
} from "./catalog.js";

/**
 * Context of a planning week (ARN-RUN, spec "Wochenplanung"): everything the
 * week rules need that follows from the profile, the run history and today's
 * date — experience, pause and re-entry, block phase and tapering, the 3:1
 * cycle, the volume cap, the long-run cap and the number of hard runs
 * allowed. Pure: no I/O, no clock; today is an argument.
 *
 * The planning week is the window of seven days from today (what
 * `schedule_run_week` plans); "Vorwoche" is the seven days before it. Hard
 * runs are also counted per calendar week (Monday to Sunday). Calendar days
 * come only from `workout_date_local`.
 */

/* ---------------------------------------------------------------- values */

/** Share of the planned running time that is easy (zone 1–2), at least. */
export const EASY_SHARE_MIN = 0.8;
/** Hard runs per week, at most (spec: two; beginners one). */
export const MAX_HARD_RUNS = 2;
export const MAX_HARD_RUNS_BEGINNER = 1;
/** With strength as the main goal (spec "Interferenz"). */
export const MAX_HARD_RUNS_STRENGTH_FOCUS = 1;
/** In the base phase of a race block (engine decision). */
export const MAX_HARD_RUNS_BASE_PHASE = 1;
/** Beginners: the first four weeks only strides, no hard run. */
export const BEGINNER_FIRST_WEEKS_DAYS = 28;
/**
 * Long run: share of the week's running time, at most — depending on how many
 * runs the week has (RUN-013). A flat 30 % made the long run impossible for
 * hybrid athletes with three runs (it would have to be a 45-minute run next to
 * two 20-minute runs, so it always became an easy run). The fewer the runs,
 * the larger the share a long run has to take; from five runs on the
 * classic 30 % rule holds. One run is the whole week: no meaningful share.
 * Planner and checker both read the limit here, so they never disagree.
 */
export const LONG_SHARE_MAX_BY_RUNS = {
  1: 1,
  2: 0.5,
  3: 0.4,
  4: 0.35,
  5: 0.3,
} as const;
/** Long run share limit for a week with `runCount` runs (planned runs in the window). */
export function longShareMax(runCount: number): number {
  const n = Math.max(1, Math.min(5, Math.floor(runCount)));
  return LONG_SHARE_MAX_BY_RUNS[n as 1 | 2 | 3 | 4 | 5];
}
/** Long run: minutes longer than the longest run of the last four weeks, at most. */
export const LONG_GROWTH_MAX_MIN = 15;
/** Weekly volume (time) over the week before, at most. */
export const VOLUME_GROWTH_MAX = 0.1;
/** Build weeks before a deload week (3:1). */
export const BUILD_WEEKS = 3;
/** Volume of a deload week relative to the week before (−25 %). */
export const DELOAD_FACTOR = 0.75;
/** A week at or under this share of the week before counts as easier (deload, pause). */
export const DELOAD_DETECT_SHARE = 0.8;
/** Hard runs need at least this many calendar days between them (48 h). */
export const HARD_SPACING_DAYS = 2;
/** Re-entry after a pause (full days without a run before today). */
export const REENTRY = {
  short: { over_days: 7, factor: 0.8 },
  long: { over_days: 14, factor: 0.65 },
  restart: { over_days: 28 },
} as const;
/** Tapering before a race: days and volume factor (gleiche Intensität). */
export const TAPER = {
  "5k": { days: 7, factor: 0.7 },
  "10k": { days: 10, factor: 0.65 },
  half_marathon: { days: 14, factor: 0.6 },
} as const;
/** Block phases: weeks of peak and build before the taper. */
export const PEAK_WEEKS = 2;
export const BUILD_PHASE_WEEKS = {
  "5k": 4,
  "10k": 4,
  half_marathon: 5,
} as const;
/** Under this many weeks a block has only build and taper (with a hint). */
export const SHORT_BLOCK_WEEKS = 6;
/** Weekly minutes when neither history nor profile knows the volume. */
export const DEFAULT_START_MINUTES: Readonly<Record<RunExperience, number>> = {
  beginner: 60,
  intermediate: 120,
  advanced: 180,
};

/* ----------------------------------------------------------------- input */

export type RunGoal = "fitness" | "5k" | "10k" | "half_marathon";
export type RaceGoal = Exclude<RunGoal, "fitness">;
export type TrainingFocus = "running" | "strength";

/** The run profile fields the week rules read (`run_profiles`). */
export interface WeekRunProfile {
  readonly goal: RunGoal;
  readonly race_date: string | null;
  readonly running_experience_months: number | null;
  readonly runs_per_week: number;
  /** 1 = Monday … 7 = Sunday. */
  readonly long_run_weekday: number | null;
  readonly preferred_environment: RunEnvironment;
  readonly base_minutes_per_week: number | null;
  readonly longest_run_4w_min: number | null;
}

/**
 * A run from the history. Only completed runs count; `timer_s` null means the
 * duration is unknown (never 0).
 */
export interface WeekHistoryRun {
  readonly workout_date_local: string;
  readonly run_type: RunType;
  readonly status:
    "planned" | "in_progress" | "completed" | "cancelled" | "voided";
  readonly timer_s: number | null;
}

export interface WeekContextInput {
  /** Today in the user's time zone (`YYYY-MM-DD`), the first day of the window. */
  readonly today: string;
  readonly profile: WeekRunProfile;
  readonly history: readonly WeekHistoryRun[];
  /** Main goal; null = running for a race goal, else strength if strength days exist. */
  readonly focus?: TrainingFocus | null;
  /** True when the user also trains strength (decides the default focus). */
  readonly has_strength?: boolean;
  /** First day of the race block (e.g. when the goal was set); null = today. */
  readonly block_start?: string | null;
}

/* ---------------------------------------------------------------- output */

export type WeekPhase =
  "none" | "base" | "build" | "peak" | "taper" | "race_over";
export type Reentry = "none" | "short" | "long" | "restart" | "new";

export type VolumeBasis =
  | "previous_week"
  | "before_deload"
  | "before_pause"
  | "before_taper"
  | "profile"
  | "default";

export interface WeekNote {
  readonly code: WeekNoteCode;
  readonly text: string;
  readonly date?: string;
  readonly session_id?: string;
}

export const WEEK_NOTE_CODES = [
  "assumed_volume",
  "partly_unknown_volume",
  "unknown_longest_run",
  "reentry",
  "deload",
  "return_after_deload",
  "phase",
  "short_block",
  "taper",
  "race_day",
  "race_over",
  "beginner_first_weeks",
  "strength_focus",
  "hard_on_leg_day",
  "easy_on_leg_day",
  "unknown_leg_load",
  "session_dropped",
  "session_converted",
  "session_shortened",
  "level_lowered",
  "adaptation",
  "slow_down",
  "fixed_run",
  "environment_changed",
] as const;
export type WeekNoteCode = (typeof WEEK_NOTE_CODES)[number];

export interface VolumeCap {
  /** Planned minutes of the window, at most. */
  readonly minutes: number;
  /** Volume the cap is derived from, with its source. */
  readonly reference_minutes: number;
  readonly basis: VolumeBasis;
  /** True when some completed runs had no duration (the known part is used). */
  readonly partly_unknown: boolean;
  /** Why the cap is what it is, in German. */
  readonly reasons: readonly string[];
}

export interface WeekContext {
  readonly today: string;
  /** The seven days from today. */
  readonly window: readonly string[];
  readonly experience: RunExperience;
  readonly beginner_first_weeks: boolean;
  readonly focus: TrainingFocus;
  /** Full days without a run before today; null without any run. */
  readonly pause_days: number | null;
  readonly reentry: Reentry;
  readonly phase: WeekPhase;
  readonly race_date: string | null;
  readonly deload: boolean;
  readonly volume: VolumeCap;
  /** Longest run of the last four weeks; null = unknown. */
  readonly longest_4w_min: number | null;
  /** Minutes of a long run, at most (growth rule). */
  readonly long_cap_min: number;
  /** Hard runs in the window and in each calendar week, at most. */
  readonly max_hard: number;
  readonly max_hard_reasons: readonly string[];
  readonly notes: readonly WeekNote[];
}

/* --------------------------------------------------------------- helpers */

/** Fail closed: a date that is not a real calendar day is an error, never a guess. */
export function day(date: string): string {
  if (!isCalendarDate(date))
    throw new RangeError(`Kein Kalenderdatum: ${date}`);
  return date;
}

/** 1 = Monday … 7 = Sunday. */
export const weekdayOf = (date: string) =>
  daysBetween(weekStart(date), date) + 1;

export const WEEKDAY_NAMES = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

/** "Mittwoch, 18.11." */
export function dayLabel(date: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(date) - 1]}, ${date.slice(8, 10)}.${date.slice(5, 7)}.`;
}

export const floor5 = (minutes: number) => Math.floor(minutes / 5) * 5;

const completedBefore = (history: readonly WeekHistoryRun[], today: string) =>
  history.filter(
    (run) =>
      run.status === "completed" &&
      compareDate(day(run.workout_date_local), today) < 0,
  );

/** Minutes of completed runs in [from, to]; null when none of them has a duration. */
export function minutesBetween(
  runs: readonly WeekHistoryRun[],
  from: string,
  to: string,
): { minutes: number; runs: number; unknown: number } {
  let minutes = 0;
  let count = 0;
  let unknown = 0;
  for (const run of runs) {
    const date = run.workout_date_local;
    if (compareDate(date, from) < 0 || compareDate(date, to) > 0) continue;
    count += 1;
    if (run.timer_s === null) unknown += 1;
    else minutes += run.timer_s / 60;
  }
  return { minutes, runs: count, unknown };
}

const isRace = (goal: RunGoal): goal is RaceGoal => goal !== "fitness";

/* ----------------------------------------------------------------- phase */

export interface PhaseInfo {
  readonly phase: WeekPhase;
  readonly days_to_race: number | null;
  readonly short_block: boolean;
}

/**
 * Block phase on `date` (spec: Grundlage, Aufbau, Spitze, Tapering). The
 * phases count back from the race: taper days, then the peak weeks, then the
 * build weeks, everything earlier is base. A block under six weeks (from
 * `block_start`) has only build and taper.
 */
export function blockPhase(
  profile: Pick<WeekRunProfile, "goal" | "race_date">,
  date: string,
  block_start: string | null = null,
): PhaseInfo {
  day(date);
  if (!isRace(profile.goal) || profile.race_date === null)
    return { phase: "none", days_to_race: null, short_block: false };
  const race = day(profile.race_date);
  const toRace = daysBetween(date, race);
  if (toRace < 0)
    return { phase: "race_over", days_to_race: toRace, short_block: false };
  const taper = TAPER[profile.goal].days;
  const start = block_start === null ? date : day(block_start);
  const blockDays = daysBetween(
    compareDate(start, date) < 0 ? start : date,
    race,
  );
  const short = blockDays < SHORT_BLOCK_WEEKS * 7;
  if (toRace <= taper)
    return { phase: "taper", days_to_race: toRace, short_block: short };
  if (short) return { phase: "build", days_to_race: toRace, short_block: true };
  const beforeTaper = toRace - taper;
  if (beforeTaper <= PEAK_WEEKS * 7)
    return { phase: "peak", days_to_race: toRace, short_block: false };
  if (beforeTaper <= (PEAK_WEEKS + BUILD_PHASE_WEEKS[profile.goal]) * 7)
    return { phase: "build", days_to_race: toRace, short_block: false };
  return { phase: "base", days_to_race: toRace, short_block: false };
}

const PHASE_NAMES: Record<WeekPhase, string> = {
  none: "ohne Wettkampf",
  base: "Grundlage",
  build: "Aufbau",
  peak: "Spitze",
  taper: "Tapering",
  race_over: "nach dem Wettkampf",
};
export const phaseName = (phase: WeekPhase) => PHASE_NAMES[phase];

/* --------------------------------------------------------------- context */

/** Start volume from the profile, else the default of the experience. */
function profileVolume(profile: WeekRunProfile, experience: RunExperience) {
  const minutes = profile.base_minutes_per_week;
  return minutes !== null && Number.isFinite(minutes) && minutes > 0
    ? { minutes, basis: "profile" as const }
    : { minutes: DEFAULT_START_MINUTES[experience], basis: "default" as const };
}

/**
 * Seven-day blocks before today: block 1 is the seven days right before
 * today. A block is a build block when it is not easier than the block
 * before (over 80 % of it) and has running time; the 3:1 cycle asks for a
 * deload after three build blocks in a row.
 */
function blocks(runs: readonly WeekHistoryRun[], today: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    minutesBetween(
      runs,
      addDays(today, -7 * (i + 1)),
      addDays(today, -7 * i - 1),
    ),
  );
}

export function weekContext(input: WeekContextInput): WeekContext {
  const today = day(input.today);
  const profile = input.profile;
  const experience = runExperience(profile);
  const window = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const runs = completedBefore(input.history, today);
  const notes: WeekNote[] = [];
  const reasons: string[] = [];

  /* pause and re-entry */
  const last = runs.reduce<string | null>(
    (latest, run) =>
      latest === null || compareDate(run.workout_date_local, latest) > 0
        ? run.workout_date_local
        : latest,
    null,
  );
  const pause = last === null ? null : daysBetween(last, today) - 1;
  const reentry: Reentry =
    pause === null
      ? "new"
      : pause > REENTRY.restart.over_days
        ? "restart"
        : pause > REENTRY.long.over_days
          ? "long"
          : pause > REENTRY.short.over_days
            ? "short"
            : "none";

  /* beginner: the first four weeks only strides */
  const first = runs.reduce<string | null>(
    (earliest, run) =>
      earliest === null || compareDate(run.workout_date_local, earliest) < 0
        ? run.workout_date_local
        : earliest,
    null,
  );
  const months = profile.running_experience_months;
  const beginner_first_weeks =
    experience === "beginner" &&
    (months === null || months < 1) &&
    (first === null || daysBetween(first, today) < BEGINNER_FIRST_WEEKS_DAYS);

  /* focus */
  const focus: TrainingFocus =
    input.focus ??
    (isRace(profile.goal)
      ? "running"
      : input.has_strength
        ? "strength"
        : "running");

  /* phase */
  const phaseInfo = blockPhase(profile, today, input.block_start ?? null);
  const phase = phaseInfo.phase;
  const race_date =
    phase === "none" || phase === "race_over" ? null : profile.race_date;

  /* reference volume and cap */
  const fallback = profileVolume(profile, experience);
  let partly_unknown = false;
  let reference: { minutes: number; basis: VolumeBasis };
  let cap: number;
  let deload = false;
  const [b1, b2, b3, b4] = blocks(runs, today, 4);
  const known = (b: { minutes: number; runs: number; unknown: number }) =>
    b.runs > b.unknown;

  if (reentry === "new" || reentry === "restart") {
    reference = fallback;
    cap = fallback.minutes;
    reasons.push(
      reentry === "new"
        ? "Neue Ausgangslage aus dem Laufprofil (noch keine Läufe bei Arnold)."
        : `Über ${REENTRY.restart.over_days} Tage ohne Lauf: neue Ausgangslage aus dem Laufprofil, eine Woche ohne harte Einheit.`,
    );
  } else if (reentry === "long" || reentry === "short") {
    const before = minutesBetween(runs, addDays(last!, -6), last!);
    partly_unknown = before.unknown > 0;
    reference = known(before)
      ? { minutes: before.minutes, basis: "before_pause" }
      : fallback;
    const factor = REENTRY[reentry].factor;
    cap = reference.minutes * factor;
    reasons.push(
      `${pause} Tage ohne Lauf: Wiedereinstieg mit ${Math.round((1 - factor) * 100)} % weniger Umfang` +
        (reentry === "long" ? " und ohne harte Einheit." : "."),
    );
  } else {
    // Normal week: the seven days before (or the last block with runs).
    const prev = known(b1) ? b1 : known(b2) ? b2 : null;
    partly_unknown = (prev?.unknown ?? 0) > 0;
    reference = prev
      ? { minutes: prev.minutes, basis: "previous_week" }
      : fallback;
    cap = reference.minutes * (1 + VOLUME_GROWTH_MAX);
    const blockKnown = [b1, b2, b3, b4].map((b) => (known(b) ? b.minutes : 0));
    const isBuild = (i: number) =>
      blockKnown[i] > 0 &&
      (blockKnown[i + 1] === undefined ||
        blockKnown[i + 1] === 0 ||
        blockKnown[i] > DELOAD_DETECT_SHARE * blockKnown[i + 1]);
    const lastWasEasier =
      blockKnown[0] > 0 &&
      blockKnown[1] > 0 &&
      blockKnown[0] <= DELOAD_DETECT_SHARE * blockKnown[1];
    if (phase === "taper") {
      // handled below
    } else if (isBuild(0) && isBuild(1) && isBuild(2)) {
      deload = true;
      cap = reference.minutes * DELOAD_FACTOR;
      reasons.push(
        `Nach ${BUILD_WEEKS} Aufbauwochen folgt eine Entlastungswoche mit ${Math.round((1 - DELOAD_FACTOR) * 100)} % weniger Umfang.`,
      );
      notes.push({
        code: "deload",
        text: `Entlastungswoche: ${Math.round((1 - DELOAD_FACTOR) * 100)} % weniger Umfang nach drei Aufbauwochen, damit der Körper die Belastung verarbeitet.`,
      });
    } else if (lastWasEasier) {
      reference = { minutes: blockKnown[1], basis: "before_deload" };
      partly_unknown = b2.unknown > 0;
      cap = blockKnown[1];
      reasons.push(
        "Nach einer leichteren Woche zurück auf den Umfang davor, ohne weitere Steigerung.",
      );
      notes.push({
        code: "return_after_deload",
        text: "Die Vorwoche war leichter: Arnold plant wieder den Umfang der Woche davor, ohne zusätzliche Steigerung.",
      });
    } else if (phase === "peak") {
      cap = reference.minutes;
      reasons.push("Spitzenphase: Umfang halten, keine weitere Steigerung.");
    } else {
      reasons.push(
        `Höchstens ${Math.round(VOLUME_GROWTH_MAX * 100)} % mehr Umfang als in den sieben Tagen davor.`,
      );
    }
  }

  if (phase === "taper" && profile.race_date !== null && isRace(profile.goal)) {
    const taper = TAPER[profile.goal];
    const taperStart = addDays(profile.race_date, -taper.days);
    const before =
      compareDate(taperStart, today) <= 0
        ? minutesBetween(runs, addDays(taperStart, -7), addDays(taperStart, -1))
        : null;
    if (before !== null && known(before)) {
      reference = { minutes: before.minutes, basis: "before_taper" };
      partly_unknown = before.unknown > 0;
    }
    const taperCap = reference.minutes * taper.factor;
    cap = Math.min(cap, taperCap);
    reasons.push(
      `Tapering vor dem Wettkampf: ${Math.round((1 - taper.factor) * 100)} % weniger Umfang bei gleicher Intensität.`,
    );
    notes.push({
      code: "taper",
      text: `Tapering: ${taper.days} Tage vor dem Wettkampf ${Math.round((1 - taper.factor) * 100)} % weniger Umfang, die Intensität bleibt.`,
    });
  }

  if (reference.basis === "default" || reference.basis === "profile")
    notes.push({
      code: "assumed_volume",
      text:
        reference.basis === "profile"
          ? `Ausgangsumfang aus dem Laufprofil: ${Math.round(reference.minutes)} Minuten pro Woche.`
          : `Ausgangsumfang unbekannt: Arnold beginnt vorsichtig mit ${reference.minutes} Minuten pro Woche. Trag deinen Umfang im Laufprofil ein.`,
    });
  if (partly_unknown)
    notes.push({
      code: "partly_unknown_volume",
      text: "Bei einigen Läufen fehlt die Dauer: Arnold rechnet nur mit den bekannten Minuten.",
    });
  if (reentry === "short" || reentry === "long" || reentry === "restart")
    notes.push({ code: "reentry", text: reasons[0] });

  /* longest run of the last four weeks */
  const recent = runs.filter(
    (run) => compareDate(run.workout_date_local, addDays(today, -28)) >= 0,
  );
  const recentKnown = recent.filter((run) => run.timer_s !== null);
  let longest: number | null = recentKnown.length
    ? Math.max(...recentKnown.map((run) => run.timer_s! / 60))
    : null;
  if (
    longest === null &&
    runs.length === 0 &&
    profile.longest_run_4w_min !== null
  )
    longest =
      profile.longest_run_4w_min > 0 ? profile.longest_run_4w_min : null;
  const longDef = CONTINUOUS_MINUTES.long.span[experience].def;
  const long_cap_min =
    longest === null ? longDef : Math.floor(longest + LONG_GROWTH_MAX_MIN);
  if (longest === null)
    notes.push({
      code: "unknown_longest_run",
      text: `Längster Lauf der letzten vier Wochen unbekannt: der lange Lauf beginnt mit höchstens ${longDef} Minuten.`,
    });

  /* hard runs */
  const hardReasons: string[] = [];
  let max_hard = MAX_HARD_RUNS;
  const limit = (value: number, why: string) => {
    if (value < max_hard) {
      max_hard = value;
      hardReasons.push(why);
    } else if (value === max_hard && value < MAX_HARD_RUNS)
      hardReasons.push(why);
  };
  if (experience === "beginner")
    limit(
      MAX_HARD_RUNS_BEGINNER,
      "Einsteiger: höchstens eine harte Einheit pro Woche.",
    );
  if (focus === "strength")
    limit(
      MAX_HARD_RUNS_STRENGTH_FOCUS,
      "Hauptziel Kraft: höchstens eine harte Laufeinheit pro Woche.",
    );
  if (phase === "base")
    limit(
      MAX_HARD_RUNS_BASE_PHASE,
      "Grundlagenphase: höchstens eine harte Einheit.",
    );
  if (beginner_first_weeks)
    limit(
      0,
      "Die ersten vier Wochen als Einsteiger: nur Steigerungen, keine harte Einheit.",
    );
  if (reentry === "long" || reentry === "restart")
    limit(
      0,
      "Wiedereinstieg nach langer Pause: eine Woche ohne harte Einheit.",
    );
  if (beginner_first_weeks)
    notes.push({
      code: "beginner_first_weeks",
      text: "In den ersten vier Wochen als Einsteiger gibt es statt harter Einheiten nur Steigerungen am Ende lockerer Läufe.",
    });
  if (focus === "strength" && max_hard >= 1)
    notes.push({
      code: "strength_focus",
      text: "Hauptziel Kraft: höchstens eine harte Laufeinheit pro Woche, damit die Beine für das Krafttraining frisch bleiben.",
    });

  if (phase !== "none")
    notes.push({
      code: phase === "race_over" ? "race_over" : "phase",
      text:
        phase === "race_over"
          ? "Der Wettkampf liegt hinter dir: Arnold plant ohne Blockphasen weiter. Trag ein neues Ziel ein, wenn du eins hast."
          : `Phase: ${phaseName(phase)} (${phaseInfo.days_to_race} Tage bis zum Wettkampf).`,
    });
  if (phaseInfo.short_block)
    notes.push({
      code: "short_block",
      text: `Bis zum Wettkampf sind es weniger als ${SHORT_BLOCK_WEEKS} Wochen: nur Aufbau und Tapering, keine eigene Grundlagenphase. Erwarte keine großen Sprünge.`,
    });

  return {
    today,
    window,
    experience,
    beginner_first_weeks,
    focus,
    pause_days: pause,
    reentry,
    phase,
    race_date,
    deload,
    volume: {
      minutes: Math.max(0, Math.floor(cap)),
      reference_minutes: Math.round(reference.minutes),
      basis: reference.basis,
      partly_unknown,
      reasons,
    },
    longest_4w_min: longest === null ? null : Math.round(longest),
    long_cap_min,
    max_hard,
    max_hard_reasons: hardReasons,
    notes,
  };
}
