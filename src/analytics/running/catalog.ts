import {
  HARD_RUN_TYPES,
  RUN_TYPES,
  type RunEnvironment,
  type RunType,
} from "../../shared/run-contract.js";

/**
 * Run type catalog (ARN-RUN, spec "Laufarten"): the 14 run types with their
 * standard structure per experience. Pure data; `prescription.ts` turns it
 * into a prescription. All values are the engine's own decisions inside the
 * ranges of the spec; they change only together with `RUN_RULES_VERSION`.
 */

export const RUN_EXPERIENCES = [
  "beginner",
  "intermediate",
  "advanced",
] as const;
export type RunExperience = (typeof RUN_EXPERIENCES)[number];

/**
 * Experience as the plan engine uses it. A beginner has under three months of
 * running experience or runs under about 15 km a week (spec "Wochenplanung";
 * 90 minutes a week at an easy pace); an advanced runner has at least two
 * years and at least four hours a week. Unknown input counts as beginner:
 * the cautious reading, never the other way round.
 */
export function runExperience(profile: {
  readonly running_experience_months: number | null;
  readonly base_minutes_per_week: number | null;
}): RunExperience {
  const months = profile.running_experience_months;
  const minutes = profile.base_minutes_per_week;
  if (months === null || minutes === null) return "beginner";
  if (months < 3 || minutes < 90) return "beginner";
  if (months >= 24 && minutes >= 240) return "advanced";
  return "intermediate";
}

/** Name on the watch (at most 24 characters). */
export const RUN_TYPE_NAMES: Readonly<Record<RunType, string>> = {
  recovery: "Regeneration",
  base: "Grundlage",
  long: "Langer Lauf",
  progression: "Steigerungslauf",
  tempo: "Tempodauerlauf",
  threshold_intervals: "Schwellenintervalle",
  intervals: "Intervalle",
  repetitions: "Kurze Wiederholungen",
  strides: "Steigerungen",
  hills: "Bergläufe",
  fartlek: "Fahrtspiel",
  run_walk: "Lauf-Geh",
  test: "Test / Wettkampf",
  free: "Freier Lauf",
};

/**
 * Expected effort (RPE 1–10) per run type: the spec range and the value the
 * watch preselects (the middle, rounded up). Free runs have none: the user
 * rates them. Strides follow their main run (easy).
 */
export const RUN_TYPE_RPE: Readonly<
  Record<RunType, { range: readonly [number, number]; expected: number | null }>
> = {
  recovery: { range: [1, 2], expected: 2 },
  base: { range: [2, 4], expected: 3 },
  long: { range: [3, 5], expected: 4 },
  progression: { range: [5, 6], expected: 6 },
  tempo: { range: [6, 7], expected: 7 },
  threshold_intervals: { range: [6, 7], expected: 7 },
  intervals: { range: [8, 9], expected: 9 },
  repetitions: { range: [7, 9], expected: 8 },
  strides: { range: [2, 4], expected: 3 },
  hills: { range: [7, 8], expected: 8 },
  fartlek: { range: [5, 7], expected: 6 },
  run_walk: { range: [3, 5], expected: 4 },
  test: { range: [9, 10], expected: 10 },
  free: { range: [1, 10], expected: null },
};

/** Short hint on the watch (at most 160 characters with the environment tail). */
export const RUN_TYPE_HINTS: Readonly<Record<RunType, string>> = {
  recovery:
    "Sehr locker, Puls in Zone 1. Reden geht mühelos. Bei Alarm Tempo rausnehmen oder gehen.",
  base: "Locker laufen, Puls bis Zone 2, Gespräch möglich. Bei Alarm langsamer werden.",
  long: "Gleichmäßig und locker, Puls bis Zone 2. Ab Minute 60 alle 30 Minuten trinken.",
  progression:
    "Drittel locker, Drittel zügig (Zone 3), Drittel nahe Schwellentempo. Jedes Drittel etwas schneller.",
  tempo:
    "Einlaufen, dann gleichmäßig im Schwellentempo: hart, aber kontrolliert. Locker auslaufen.",
  threshold_intervals:
    "Schwellenblöcke mit kurzen Trabpausen. Gleichmäßig bleiben, nicht zu schnell beginnen.",
  intervals:
    "Harte Belastungen, dazwischen gleich lang traben. Lieber gleichmäßig als zu schnell beginnen.",
  repetitions:
    "Kurz und schnell, dazwischen in Ruhe erholen. Nur Zeit und Countdown, kein Tempoalarm.",
  strides:
    "Locker laufen, am Ende kurze Steigerungen. Dazwischen gehen oder traben.",
  hills:
    "Bergauf kräftig, bergab locker traben. Nach Anstrengung laufen, nicht nach Tempo.",
  fartlek: "Wechsel nach Zeit: zügig und locker. Die Uhr meldet jeden Wechsel.",
  run_walk:
    "Laufen und Gehen im Wechsel, im Laufteil Puls bis Zone 2. Die Gehpausen gehören zum Plan.",
  test: "Gleichmäßig so schnell wie möglich, kein Alarm. Das Ergebnis kann die neue Referenz werden.",
  free: "Freier Lauf ohne Ziel. Die Uhr meldet jeden Kilometer.",
};

export const HINT_TREADMILL = " Laufband: nach Zeit und Puls.";

/** What the spec says each run type is (for cards and for ChatGPT). */
export interface RunTypeSpec {
  readonly type: RunType;
  readonly name: string;
  /** Standard structure in words (spec "Aufbau"). */
  readonly structure: string;
  /** Target and alarm on the watch (spec "Ziel und Alarm"). */
  readonly target: string;
  readonly hard: boolean;
  readonly rpe: readonly [number, number];
  /** Environments the type can be prescribed for. */
  readonly environments: readonly RunEnvironment[];
}

const ALL_ENV: readonly RunEnvironment[] = ["outdoor", "treadmill", "track"];

const STRUCTURE: Readonly<Record<RunType, readonly [string, string]>> = {
  recovery: [
    "20 bis 40 min durchgehend",
    "Puls Zone 1, Alarm bei Überschreitung",
  ],
  base: [
    "30 bis 75 min durchgehend",
    "Puls bis Zone 2, Alarm bei Überschreitung",
  ],
  long: [
    "60 bis 150 min, optional letzte 10 bis 20 min zügiger",
    "Puls bis Zone 2; Trinkerinnerung alle 30 min ab Minute 60",
  ],
  progression: [
    "Drittel locker, Drittel Zone 3, Drittel unteres Schwellentempo",
    "Puls- oder Tempoband je Drittel",
  ],
  tempo: [
    "10 bis 15 min einlaufen, 15 bis 40 min Schwelle, 10 min auslaufen",
    "Tempoband T oder Zone 4, Alarm bei Abweichung",
  ],
  threshold_intervals: [
    "3 bis 5 × 6 bis 10 min Schwelle, 1 bis 2 min traben",
    "Tempoband T, Alarm in Belastungen",
  ],
  intervals: [
    "4 bis 8 × 2 bis 5 min oder 400 bis 1200 m, Erholung gleich lang traben",
    "Tempoband I in Belastungen ab 2 min oder 400 m; kürzere ohne Alarm",
  ],
  repetitions: [
    "6 bis 12 × 15 bis 60 s schnell, 1 bis 3 min gehen oder traben",
    "Nur Zeit und Countdown, kein Tempoalarm",
  ],
  strides: [
    "4 bis 8 × 15 bis 20 s, als Anhang an einen lockeren Lauf",
    "Nur Zeit und Countdown",
  ],
  hills: [
    "6 bis 10 × 30 bis 90 s bergauf hart, bergab traben",
    "Zeit und Anstrengung, kein Tempoziel",
  ],
  fartlek: [
    "Wechsel nach Zeit, zum Beispiel 8 × 1 min zügig, 1 min locker",
    "Zeitwechsel mit Signal",
  ],
  run_walk: [
    "Zum Beispiel 8 × (2 min laufen, 1 min gehen)",
    "Wechsel mit Signal; Puls bis Zone 2 im Laufteil",
  ],
  test: [
    "Distanz oder 30 min, mit Ein- und Auslaufen",
    "Kein Alarm, Zwischenzeiten",
  ],
  free: ["offen", "Kein Ziel; Kilometersignal"],
};

/** The 14 run types, in `RUN_TYPES` order. */
export const RUN_CATALOG: readonly RunTypeSpec[] = RUN_TYPES.map((type) => ({
  type,
  name: RUN_TYPE_NAMES[type],
  structure: STRUCTURE[type][0],
  target: STRUCTURE[type][1],
  hard: HARD_RUN_TYPES.includes(type),
  rpe: RUN_TYPE_RPE[type].range,
  // hill repeats need a slope: not on a track (a treadmill needs its incline set)
  environments: type === "hills" ? ["outdoor", "treadmill"] : ALL_ENV,
}));

/* ------------------------------------------------------- parameter tables */

/** A value range: smallest, standard start and largest allowed value. */
export interface Span {
  readonly min: number;
  readonly def: number;
  readonly max: number;
}
export type ByExperience<T> = Readonly<Record<RunExperience, T>>;
const span = (min: number, def: number, max: number): Span => ({
  min,
  def,
  max,
});

/** Warm-up and cool-down of structured sessions, in seconds. */
export const WARMUP_S: ByExperience<number> = {
  beginner: 600,
  intermediate: 720,
  advanced: 900,
};
export const COOLDOWN_S = 600;
/** Walking warm-up and cool-down of run-walk sessions, in seconds. */
export const RUN_WALK_BUFFER_S = 300;

/** Continuous run types: minutes of the whole run and minutes added per level. */
export const CONTINUOUS_MINUTES: Readonly<
  Record<
    "recovery" | "base" | "long" | "progression" | "free",
    { readonly span: ByExperience<Span>; readonly step: number }
  >
> = {
  recovery: {
    span: {
      beginner: span(20, 20, 30),
      intermediate: span(20, 30, 40),
      advanced: span(20, 30, 40),
    },
    step: 0,
  },
  base: {
    span: {
      beginner: span(20, 30, 45),
      intermediate: span(30, 45, 75),
      advanced: span(30, 60, 75),
    },
    step: 5,
  },
  long: {
    span: {
      beginner: span(45, 50, 75),
      intermediate: span(60, 75, 120),
      advanced: span(75, 90, 150),
    },
    step: 10,
  },
  progression: {
    span: {
      beginner: span(30, 30, 45),
      intermediate: span(35, 45, 60),
      advanced: span(40, 50, 75),
    },
    step: 5,
  },
  free: {
    span: {
      beginner: span(5, 5, 60),
      intermediate: span(5, 5, 120),
      advanced: span(5, 5, 180),
    },
    step: 0,
  },
};

/** Minutes of the faster finish of a long run (spec: 10 to 20). */
export const FAST_FINISH_MINUTES: ByExperience<number> = {
  beginner: 10,
  intermediate: 10,
  advanced: 15,
};

/** Minutes at threshold in a tempo run (step: +5 per level). */
export const TEMPO_MINUTES: ByExperience<Span> = {
  beginner: span(15, 15, 20),
  intermediate: span(15, 20, 30),
  advanced: span(20, 25, 40),
};

/** Repetition structures (reps, work seconds, recovery seconds). */
export const THRESHOLD_INTERVALS = {
  reps: {
    beginner: span(3, 3, 4),
    intermediate: span(3, 4, 5),
    advanced: span(3, 4, 5),
  } as ByExperience<Span>,
  work_s: {
    beginner: span(360, 360, 480),
    intermediate: span(360, 480, 600),
    advanced: span(480, 600, 600),
  } as ByExperience<Span>,
  step_s: 60,
  rest_s: {
    beginner: 120,
    intermediate: 90,
    advanced: 60,
  } as ByExperience<number>,
};

export const INTERVALS = {
  reps: {
    beginner: span(3, 4, 5),
    intermediate: span(4, 5, 6),
    advanced: span(5, 6, 8),
  } as ByExperience<Span>,
  work_s: {
    beginner: span(120, 120, 180),
    intermediate: span(120, 180, 240),
    advanced: span(180, 240, 300),
  } as ByExperience<Span>,
  step_s: 30,
  /** Track with a reference: repetitions by distance (400 to 1200 m). */
  work_m: {
    beginner: span(400, 400, 800),
    intermediate: span(400, 800, 1000),
    advanced: span(600, 1000, 1200),
  } as ByExperience<Span>,
  step_m: 100,
};

export const REPETITIONS = {
  reps: {
    beginner: span(6, 6, 8),
    intermediate: span(6, 8, 10),
    advanced: span(8, 8, 12),
  } as ByExperience<Span>,
  work_s: {
    beginner: span(15, 20, 30),
    intermediate: span(20, 30, 45),
    advanced: span(20, 30, 60),
  } as ByExperience<Span>,
  step_reps: 2,
  step_s: 5,
  rest_s: {
    beginner: 150,
    intermediate: 120,
    advanced: 90,
  } as ByExperience<number>,
};

export const HILLS = {
  reps: {
    beginner: span(4, 4, 6),
    intermediate: span(6, 6, 8),
    advanced: span(6, 8, 10),
  } as ByExperience<Span>,
  work_s: {
    beginner: span(30, 30, 45),
    intermediate: span(30, 45, 60),
    advanced: span(45, 60, 90),
  } as ByExperience<Span>,
  step_s: 5,
  /** Downhill jog = 1.5 × the climb, rounded up to 5 s. */
  rest_factor: 1.5,
};

export const FARTLEK = {
  reps: {
    beginner: span(5, 6, 8),
    intermediate: span(6, 8, 10),
    advanced: span(8, 10, 12),
  } as ByExperience<Span>,
  fast_s: {
    beginner: span(60, 60, 60),
    intermediate: span(60, 60, 90),
    advanced: span(60, 90, 120),
  } as ByExperience<Span>,
  step_s: 15,
  easy_s: {
    beginner: 120,
    intermediate: 60,
    advanced: 60,
  } as ByExperience<number>,
  warmup_s: {
    beginner: 600,
    intermediate: 600,
    advanced: 720,
  } as ByExperience<number>,
};

export const STRIDES = {
  main_minutes: {
    beginner: span(20, 25, 40),
    intermediate: span(20, 30, 45),
    advanced: span(25, 40, 60),
  } as ByExperience<Span>,
  reps: {
    beginner: span(4, 4, 6),
    intermediate: span(4, 6, 8),
    advanced: span(6, 6, 8),
  } as ByExperience<Span>,
  stride_s: {
    beginner: 15,
    intermediate: 20,
    advanced: 20,
  } as ByExperience<number>,
  rest_s: {
    beginner: 90,
    intermediate: 75,
    advanced: 60,
  } as ByExperience<number>,
};

export const RUN_WALK = {
  /** Running part, seconds (step: +30 per level up to the largest). */
  run_s: {
    beginner: span(60, 60, 300),
    intermediate: span(120, 120, 300),
    advanced: span(180, 240, 600),
  } as ByExperience<Span>,
  run_step_s: 30,
  /** Walking part, seconds (step: −15 per level down to the smallest). */
  walk_s: {
    beginner: span(30, 90, 90),
    intermediate: span(30, 60, 60),
    advanced: span(30, 60, 60),
  } as ByExperience<Span>,
  walk_step_s: 15,
  reps: { beginner: 8, intermediate: 8, advanced: 6 } as ByExperience<number>,
  /** Largest total of the session in minutes, walking buffers included. */
  max_minutes: {
    beginner: 45,
    intermediate: 50,
    advanced: 60,
  } as ByExperience<number>,
  min_minutes: 15,
};

/** Test and race: distance limits in metres, the 30-minute test in seconds. */
export const TEST = {
  default_m: 5000,
  min_m: 3000,
  max_m: {
    beginner: 5000,
    intermediate: 10_000,
    advanced: 21_097,
  } as ByExperience<number>,
  time_s: 1800,
  warmup_s: {
    beginner: 600,
    intermediate: 720,
    advanced: 900,
  } as ByExperience<number>,
};

/** Seconds per km only to turn a distance into a duration for safety limits. */
export const ASSUMED_EASY_PACE_S_PER_KM: ByExperience<number> = {
  beginner: 480,
  intermediate: 390,
  advanced: 345,
};
