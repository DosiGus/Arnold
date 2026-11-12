/**
 * Running: the shared vocabulary and the watch payloads (ARN-RUN).
 *
 * Only schemas and pure helpers live here: no routes, no tools, no rules.
 * The stored rows (runs, segments, run sessions, run profile) are part of the
 * raw data schema in `arnold-schema-v1.ts`; this file defines the values they
 * use and the compact JSON the watch exchanges under `/api/watch/v1/runs`.
 *
 * Wire conventions, as for the strength routes: integers are seconds, metres,
 * whole minutes or beats per minute; nothing is rounded on the wire; a value
 * that is not known stays null, never 0. GPS coordinates never appear here
 * (D-RUN-08). Heart-rate values are optional everywhere and only stored with
 * the health consent (D-RUN-07).
 */
import { z } from "zod";

// This module is a leaf: arnold-schema-v1.ts builds the stored run rows from
// it, so it must not import that file (or watch-contract.ts, which does).
// The two schemas below therefore repeat RunIdSchema and
// utc; tests/run-contract.test.ts keeps them equal.

/** Same rule as RunIdSchema, capped for the watch. */
export const RunIdSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value),
    "ID darf keine Rand-Leerzeichen oder Steuerzeichen enthalten.",
  );
const utc = z.iso
  .datetime()
  .refine(
    (value) => value.endsWith("Z"),
    "Zeitstempel muss UTC mit Z verwenden.",
  );
/** Watch API version of the run routes; equal to WATCH_API_VERSION. */
export const RUN_WATCH_API_VERSION = 1;

/* ------------------------------------------------------------- vocabulary */

/**
 * Run types (spec "Laufarten"). The position in this list is the wire code
 * `k`, so the list is append-only: never reorder or remove an entry.
 */
export const RUN_TYPES = [
  "recovery", // 0 Regeneration
  "base", // 1 Grundlage (Zone 2)
  "long", // 2 Langer Lauf
  "progression", // 3 Steigerungslauf
  "tempo", // 4 Tempodauerlauf
  "threshold_intervals", // 5 Schwellenintervalle
  "intervals", // 6 Intervalle (VO2max)
  "repetitions", // 7 Kurze Wiederholungen, Sprints
  "strides", // 8 Steigerungen
  "hills", // 9 Bergläufe
  "fartlek", // 10 Fahrtspiel
  "run_walk", // 11 Lauf-Geh
  "test", // 12 Test, Wettkampf
  "free", // 13 Freier Lauf
] as const;
export const RunTypeSchema = z.enum(RUN_TYPES);
export type RunType = z.infer<typeof RunTypeSchema>;

/** Hard run types (spec "Wochenplanung": at most two per week). */
export const HARD_RUN_TYPES: readonly RunType[] = [
  "tempo",
  "threshold_intervals",
  "intervals",
  "repetitions",
  "hills",
  "test",
];

/** Where the run happens. Position = wire code `e` (append-only). */
export const RUN_ENVIRONMENTS = ["outdoor", "treadmill", "track"] as const;
export const RunEnvironmentSchema = z.enum(RUN_ENVIRONMENTS);
export type RunEnvironment = z.infer<typeof RunEnvironmentSchema>;

/** Where a run's distance comes from (D-RUN-13: treadmill is "sensor"). */
export const RunDistanceSourceSchema = z.enum([
  "gps",
  "sensor",
  "corrected",
  "manual",
]);
/** Who delivered a run's result. */
export const RunResultSourceSchema = z.enum(["watch", "chat", "screenshot"]);

/**
 * Why heart-rate values of a run are there or not ("NULL mit Grund").
 * Only `recorded` carries values; everything else leaves them null.
 */
export const RunHrStatusSchema = z.enum([
  "recorded",
  "no_consent",
  "no_sensor",
  "not_provided",
  "consent_revoked",
]);

/** Segment kinds. Position = wire code (append-only). `lap` only in results. */
export const RUN_SEGMENT_KINDS = [
  "warmup", // 0 Aufwärmen
  "work", // 1 Belastung
  "recovery", // 2 Erholung
  "cooldown", // 3 Auslaufen
  "rest", // 4 Stehpause
  "lap", // 5 Kilometerrunde eines freien Laufs (nur Ergebnis)
] as const;
export const RunSegmentKindSchema = z.enum(RUN_SEGMENT_KINDS);
/** The kinds a prescription may use (0–4). */
export const RUN_PRESCRIPTION_SEGMENT_KINDS = 5;

/** Duration types. Position = wire code. */
export const RUN_DURATION_TYPES = ["open", "seconds", "meters"] as const;
export const RunDurationTypeSchema = z.enum(RUN_DURATION_TYPES);

/** Target types. Position = wire code. */
export const RUN_TARGET_TYPES = [
  "none", // 0
  "hr_zone", // 1 Pulszone von, bis (1–5)
  "pace", // 2 Tempo in s/km: schnell, langsam
  "hr_bpm", // 3 Puls in Schlägen von, bis
  "rpe", // 4 Anstrengung von, bis (1–10)
] as const;
export const RunTargetTypeSchema = z.enum(RUN_TARGET_TYPES);

/** How a finished segment ended. */
export const RunSegmentStatusSchema = z.enum([
  "completed",
  "skipped",
  "ended_early",
]);

/** Run goals in version 1 (D-RUN-10). */
export const RunGoalSchema = z.enum(["fitness", "5k", "10k", "half_marathon"]);
/** Where a reference performance comes from (never a normal training run). */
export const RunReferenceSourceSchema = z.enum(["test", "race", "user"]);

/* ------------------------------------------------------------------ limits */

/** Upper bounds shared by schema, database checks and the watch memory plan. */
export const RUN_LIMITS = {
  /** Seconds of one run (10 h). */
  maxSeconds: 36_000,
  /** Metres of one run or segment (100 km). */
  maxMeters: 100_000,
  /** Executed segments of one run, wire segments of one prescription. */
  maxSegments: 80,
  /** 100 m splits: 60 km. */
  maxSplits: 600,
  /** Name on the wire, in characters. */
  wireName: 24,
  /** Hint on the wire, in characters. */
  wireHint: 160,
  /** Planned runs in `GET /runs/upcoming` (today + six days). */
  upcomingRuns: 7,
} as const;

/** Wire budgets in UTF-8 bytes (spec "Uhr-Schnittstelle"). */
export const RUN_WATCH_BUDGET_BYTES = {
  upcoming: 1500,
  prescriptionTypical: 1500,
  prescription: 3000,
  result: 64 * 1024,
} as const;

/** UTF-8 size of a JSON body as the watch receives it. */
export const jsonBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

const int = z.number().int();
const nonneg = int.nonnegative();
const positive = int.positive();
const seconds = nonneg.max(RUN_LIMITS.maxSeconds);
const meters = nonneg.max(RUN_LIMITS.maxMeters);
const bpm = int.min(30).max(250);
const rpe = int.min(1).max(10);
const code = (values: readonly string[]) => nonneg.max(values.length - 1);
/** Short text without control characters, e.g. a name on the watch. */
const wireText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value),
      "Keine Rand-Leerzeichen oder Steuerzeichen.",
    );

/* ------------------------------------------------------- segment encoding */

/**
 * One prescribed segment as numbers: [kind, duration type, duration value,
 * target type, low, high].
 *
 * - kind 0–4: warmup, work, recovery, cooldown, rest.
 * - duration type 0 open (until the lap key, value 0), 1 seconds, 2 metres.
 * - target type 0 none (low = high = 0), 1 heart-rate zone (1–5), 2 pace in
 *   seconds per km (low = fast, high = slow), 3 heart rate in bpm, 4 effort
 *   (RPE 1–10). Always low ≤ high.
 */
export const RunSegmentTupleSchema = z
  .tuple([
    code(RUN_SEGMENT_KINDS).max(RUN_PRESCRIPTION_SEGMENT_KINDS - 1),
    code(RUN_DURATION_TYPES),
    nonneg,
    code(RUN_TARGET_TYPES),
    nonneg,
    nonneg,
  ])
  .superRefine(([, durationType, value, targetType, low, high], ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (durationType === 0 && value !== 0)
      issue("An open segment has duration value 0.");
    if (durationType === 1 && (value < 1 || value > RUN_LIMITS.maxSeconds))
      issue("Seconds out of range.");
    if (durationType === 2 && (value < 1 || value > RUN_LIMITS.maxMeters))
      issue("Metres out of range.");
    const range: Record<number, [number, number]> = {
      0: [0, 0],
      1: [1, 5],
      2: [120, 1200],
      3: [30, 250],
      4: [1, 10],
    };
    const [min, max] = range[targetType];
    if (low < min || high > max || low > high)
      issue("Target bounds out of range or low > high.");
  });
export type RunSegmentTuple = z.infer<typeof RunSegmentTupleSchema>;

/** [first segment, last segment, count]: segments first..last run count times. */
export const RunRepeatSchema = z
  .tuple([nonneg, nonneg, int.min(2).max(50)])
  .refine(([first, last]) => first <= last, "first > last.");

/**
 * Alarm parameters of one alarm (D-RUN-11): [dwell s, tolerance, warm-up s,
 * repeat lock s]. Tolerance is bpm for heart rate, s/km for pace. The
 * warm-up is the time at the start of the run (heart rate) or of the segment
 * (pace) in which the alarm stays silent.
 */
export const RunAlarmTupleSchema = z.tuple([
  int.min(1).max(600),
  int.min(0).max(120),
  int.min(0).max(3600),
  int.min(0).max(3600),
]);
/** Alarms of a prescription; an absent key means that alarm is off. */
export const RunAlarmsSchema = z.strictObject({
  /** Heart rate too high. */
  hi: RunAlarmTupleSchema.optional(),
  /** Heart rate too low (only with heart-rate targets in tempo work). */
  lo: RunAlarmTupleSchema.optional(),
  /** Pace outside the band (only segments ≥ 2 min or ≥ 400 m, D-RUN-12). */
  pace: RunAlarmTupleSchema.optional(),
});

/** Expanded number of segments a prescription runs through. */
export function expandedSegmentCount(
  segments: readonly unknown[],
  repeats: readonly (readonly [number, number, number])[] = [],
): number {
  let total = segments.length;
  for (const [first, last, count] of repeats)
    total += (last - first + 1) * (count - 1);
  return total;
}

/**
 * A prescription ("Vorgabe"), compact. Stored as the snapshot in
 * `runs.prescription` and sent to the watch by `GET /runs/:id`.
 *
 * k=run type code, n=name, e=environment code, s=segments, rp=repeats,
 * a=alarms, h=hint, dr=drink reminder [from minute, every minutes],
 * r=expected effort (preselected on the watch).
 */
export const RunPrescriptionSchema = z
  .strictObject({
    k: code(RUN_TYPES),
    n: wireText(RUN_LIMITS.wireName),
    e: code(RUN_ENVIRONMENTS),
    s: z.array(RunSegmentTupleSchema).min(1).max(RUN_LIMITS.maxSegments),
    rp: z.array(RunRepeatSchema).max(10).optional(),
    a: RunAlarmsSchema.optional(),
    h: wireText(RUN_LIMITS.wireHint).optional(),
    dr: z.tuple([int.min(1).max(600), int.min(1).max(600)]).optional(),
    r: rpe.optional(),
  })
  .superRefine((value, ctx) => {
    const repeats = value.rp ?? [];
    let previousLast = -1;
    repeats.forEach(([first, last], i) => {
      if (last >= value.s.length)
        ctx.addIssue({
          code: "custom",
          path: ["rp", i],
          message: "Repeat refers to a missing segment.",
        });
      if (first <= previousLast)
        ctx.addIssue({
          code: "custom",
          path: ["rp", i],
          message: "Repeats must be sorted and must not overlap.",
        });
      previousLast = last;
    });
    if (expandedSegmentCount(value.s, repeats) > RUN_LIMITS.maxSegments)
      ctx.addIssue({
        code: "custom",
        path: ["rp"],
        message: `At most ${RUN_LIMITS.maxSegments} segments after repeats.`,
      });
  })
  .readonly();
export type RunPrescription = z.infer<typeof RunPrescriptionSchema>;

/**
 * Template of a run session in a plan version (`plan_run_sessions.template`):
 * the starting level of the progression and the bounds the engine keeps to.
 * Ranges are [min, max]. The engine (src/analytics/running) gives the levels
 * their meaning.
 */
export const RunSessionTemplateSchema = z
  .strictObject({
    level: nonneg.max(100),
    minutes: z.tuple([positive, positive]).nullable().optional(),
    meters: z.tuple([positive, positive]).nullable().optional(),
    repetitions: z.tuple([positive, positive]).nullable().optional(),
    environment: RunEnvironmentSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    for (const key of ["minutes", "meters", "repetitions"] as const) {
      const range = value[key];
      if (range && range[0] > range[1])
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "min > max.",
        });
    }
  })
  .readonly();
export type RunSessionTemplate = z.infer<typeof RunSessionTemplateSchema>;

/** Alarm preferences of the run profile. */
export const RunAlarmSettingsSchema = z
  .strictObject({
    hr: z.boolean(),
    pace: z.boolean(),
    km_split: z.boolean(),
  })
  .readonly();

/**
 * Heart-rate zone bounds from the Garmin profile (D-RUN-06): six ascending
 * values, as Garmin delivers them (zone 1 from b[0] to b[1] … zone 5 up to
 * b[5]).
 */
export const RunHrZoneBoundsSchema = z
  .array(bpm)
  .length(6)
  .refine(
    (b) => b.every((value, i) => i === 0 || value > b[i - 1]),
    "Zone bounds must be strictly ascending.",
  );

/** Seconds in heart-rate zones 1–5. */
export const RunZoneSecondsSchema = z.array(seconds).length(5);

/** Cumulative timer seconds at each full 100 m (D-RUN-14), non-decreasing. */
export const RunSplitsSchema = z
  .array(seconds)
  .max(RUN_LIMITS.maxSplits)
  .refine(
    (splits) => splits.every((value, i) => i === 0 || value >= splits[i - 1]),
    "Splits must not decrease.",
  );

/* ------------------------------------------------------- watch payloads */

const envelope = {
  api_version: z.literal(RUN_WATCH_API_VERSION),
  min_app_version: z.string().regex(/^\d+\.\d+\.\d+$/),
};

/**
 * One entry of `GET /runs/upcoming`: id (planned workout or plan run
 * session), d=date (absent for the next run from the plan), n=name, k=run
 * type code, m=minutes, dm=metres (null when the run is not set by it),
 * e=environment code, tag=ETag of `GET /runs/:id`.
 */
export const WatchRunEntrySchema = z.strictObject({
  id: RunIdSchema,
  d: z.iso.date().optional(),
  n: wireText(RUN_LIMITS.wireName),
  k: code(RUN_TYPES),
  m: int.min(1).max(600).nullable(),
  dm: int.min(1).max(RUN_LIMITS.maxMeters).nullable(),
  e: code(RUN_ENVIRONMENTS),
  tag: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/),
});

/**
 * `GET /runs/upcoming`: d=today in the user's time zone, hc=health consent
 * (heart-rate values may be sent), runs=planned runs today and the next six
 * days (dated, ascending), next=the next run session of the active plan.
 */
export const WatchRunsUpcomingSchema = z
  .strictObject({
    ...envelope,
    d: z.iso.date(),
    hc: z.boolean(),
    runs: z.array(WatchRunEntrySchema).max(RUN_LIMITS.upcomingRuns),
    next: WatchRunEntrySchema.nullable(),
  })
  .superRefine((value, ctx) => {
    value.runs.forEach((run, i) => {
      if (!run.d)
        ctx.addIssue({
          code: "custom",
          path: ["runs", i, "d"],
          message: "Planned runs carry their date.",
        });
      else if (run.d < value.d || (i > 0 && run.d < value.runs[i - 1].d!))
        ctx.addIssue({
          code: "custom",
          path: ["runs", i, "d"],
          message: "Planned runs start today and are sorted by date.",
        });
    });
    if (value.next?.d)
      ctx.addIssue({
        code: "custom",
        path: ["next", "d"],
        message: "The next plan session has no date.",
      });
  });
export type WatchRunsUpcoming = z.infer<typeof WatchRunsUpcomingSchema>;

/** `GET /runs/:id`: the prescription of one planned run or plan session. */
export const WatchRunDetailSchema = z.strictObject({
  ...envelope,
  id: RunIdSchema,
  p: RunPrescriptionSchema,
});
export type WatchRunDetail = z.infer<typeof WatchRunDetailSchema>;

/**
 * One executed segment in `POST /runs`: i=index in execution order,
 * rep=repetition number inside its block (null outside a repeat), kind,
 * st=status, t=timer seconds, dm=metres, tz=seconds in the target band (null
 * without a target), hr=[avg, max] only with consent.
 */
export const WatchRunSegmentResultSchema = z.strictObject({
  i: nonneg.max(RUN_LIMITS.maxSegments - 1),
  rep: int.min(1).max(50).nullable(),
  kind: code(RUN_SEGMENT_KINDS),
  st: code(RunSegmentStatusSchema.options),
  t: seconds,
  dm: meters,
  tz: seconds.nullable(),
  hr: z.tuple([bpm, bpm]).nullable().optional(),
});

/**
 * Heart-rate summary of a run; only with the health consent. Sent without
 * consent, the server discards it and says so (spec "Fehlerfälle").
 */
export const WatchRunHeartRateSchema = z
  .strictObject({
    avg: bpm,
    max: bpm,
    zone_s: RunZoneSecondsSchema.nullable(),
    zones: RunHrZoneBoundsSchema.nullable(),
    zones_sport: z.enum(["running", "generic"]).nullable(),
  })
  .refine((v) => v.avg <= v.max, "avg > max.");

/**
 * `POST /runs`: one finished run. At most one of planned_workout_id or
 * plan_version_id + session_id; neither is a free run.
 */
export const WatchRunRequestSchema = z
  .strictObject({
    request_id: z.string().min(1).max(128),
    session_uuid: z.uuid(),
    planned_workout_id: RunIdSchema.optional(),
    plan_version_id: RunIdSchema.optional(),
    session_id: RunIdSchema.optional(),
    workout_date_local: z.iso.date(),
    utc_offset_min: int.min(-840).max(840),
    started_at_utc: utc,
    ended_at_utc: utc,
    environment: RunEnvironmentSchema,
    run_type: RunTypeSchema,
    timer_s: seconds,
    elapsed_s: seconds,
    distance_m: meters,
    distance_source: RunDistanceSourceSchema,
    ascent_m: meters.nullable().optional(),
    descent_m: meters.nullable().optional(),
    cadence_spm: int.min(1).max(300).nullable().optional(),
    calories_kcal: int.min(0).max(20_000).nullable().optional(),
    te_aerobic: z.number().min(0).max(5).nullable().optional(),
    te_anaerobic: z.number().min(0).max(5).nullable().optional(),
    splits: RunSplitsSchema,
    pauses: nonneg.max(1000),
    segments: z.array(WatchRunSegmentResultSchema).max(RUN_LIMITS.maxSegments),
    hr: WatchRunHeartRateSchema.nullable().optional(),
    rpe: rpe.nullable().optional(),
    confirm_duplicate: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (Date.parse(v.ended_at_utc) < Date.parse(v.started_at_utc))
      issue("ended_at_utc", "Run end precedes start.");
    if (v.timer_s > v.elapsed_s)
      issue("timer_s", "Timer time exceeds elapsed time.");
    if ((v.plan_version_id === undefined) !== (v.session_id === undefined))
      issue("session_id", "plan_version_id and session_id come together.");
    if (v.planned_workout_id !== undefined && v.session_id !== undefined)
      issue(
        "planned_workout_id",
        "Either a planned run or a plan session, not both.",
      );
    if (v.splits.length * 100 > v.distance_m + 100)
      issue("splits", "More splits than the distance allows.");
    if (v.splits.some((split) => split > v.timer_s))
      issue("splits", "Split after the end of the run.");
    v.segments.forEach((segment, i) => {
      if (segment.i !== i) issue("segments", "Segments in execution order.");
      if (segment.tz !== null && segment.tz > segment.t)
        issue("segments", "Time in band exceeds segment time.");
      if (segment.hr && segment.hr[0] > segment.hr[1])
        issue("segments", "Segment avg > max.");
    });
  });
export type WatchRunRequest = z.infer<typeof WatchRunRequestSchema>;

/** hr_discarded: heart-rate values were sent without consent and dropped. */
export const WatchRunResponseSchema = z.strictObject({
  ...envelope,
  workout_id: RunIdSchema,
  replayed: z.boolean(),
  hr_discarded: z.boolean(),
});

/** `PATCH /runs/:session_uuid/rpe`. */
export const WatchRunRpeRequestSchema = z.strictObject({
  request_id: z.string().min(1).max(128),
  rpe,
});
export const WatchRunRpeResponseSchema = z.strictObject({
  ...envelope,
  workout_id: RunIdSchema,
  rpe,
  replayed: z.boolean(),
});

/** Wire code → name; throws on a code outside the list. */
export function fromCode<T extends string>(
  values: readonly T[],
  value: number,
) {
  const name = values[value];
  if (name === undefined) throw new RangeError(`Unknown code ${value}.`);
  return name;
}
/** Name → wire code. */
export const toCode = <T extends string>(values: readonly T[], name: T) =>
  values.indexOf(name);
