/**
 * Mobility: preferences, routine templates, tools, cards and the watch
 * payloads (ARN-MOB, D-MOB-02 … D-MOB-11).
 *
 * Only schemas and constants live here: no service, no route, no rule. The
 * seconds of a routine come from the timing engine
 * (`src/analytics/mobility/timing.ts`); the stored rows are part of the raw
 * data schema in `arnold-schema-v1.ts`, which builds on this file.
 *
 * Product rules carried by these shapes:
 *   - Mobility sends no heart rate to Arnold (no pulse field anywhere).
 *   - Mobility is neither a training day nor load; it has its own
 *     "Dranbleiben" figure.
 *   - A routine ended early on the watch is stored as ended early.
 *   - No user id in any input: it always comes from the verified token.
 *
 * Import rule: this module must not import arnold-schema-v1.ts,
 * watch-contract.ts, plan-contract.ts or onboarding-contract.ts (they import
 * it). Its only dependencies are leaves.
 */
import { z } from "zod";
import {
  MOBILITY_CATALOG_VERSION,
  MOBILITY_REPS_MAX,
  MOBILITY_REPS_MIN,
  MOBILITY_TEXT_LIMITS,
  MobilityAreaSchema,
  MobilityExerciseIdSchema,
} from "./mobility-catalog.js";
import { RUN_WATCH_API_VERSION, RunIdSchema } from "./run-contract.js";
import { WEEKDAYS, WeekdaySchema } from "./weekdays.js";
import { toolErrorSchema } from "./write-recovery.js";

export { MOBILITY_CATALOG_VERSION };

const int = z.number().int();
const nonneg = int.nonnegative();
const id = RunIdSchema;
const requestId = z.string().min(1).max(128);
const utc = z.iso
  .datetime()
  .refine(
    (value) => value.endsWith("Z"),
    "Zeitstempel muss UTC mit Z verwenden.",
  );
/** Short text without control characters or edge spaces. */
const wireText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value),
      "Keine Rand-Leerzeichen oder Steuerzeichen.",
    );
const noDuplicates = <T>(values: readonly T[]) =>
  new Set(values).size === values.length;

/* ------------------------------------------------------------- vocabulary */

/** Morning routine (standing, 5–15 min) or mobility session (15–30 min). */
export const MOBILITY_KINDS = ["morning", "session"] as const;
export const MobilityKindSchema = z.enum(MOBILITY_KINDS);
export type MobilityKind = z.infer<typeof MobilityKindSchema>;

export const MOBILITY_MORNING_MINUTES = [5, 10, 15] as const;
export const MOBILITY_SESSION_MINUTES = [15, 20, 30] as const;
export const MobilityMorningMinutesSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
]);
export const MobilitySessionMinutesSchema = z.union([
  z.literal(15),
  z.literal(20),
  z.literal(30),
]);

/** Where mobility sessions go in the week (the preference). */
export const MOBILITY_PLACEMENTS = [
  "own_days",
  "after_strength",
  "arnold_decides",
] as const;
export const MobilityPlacementSchema = z.enum(MOBILITY_PLACEMENTS);
export type MobilityPlacement = z.infer<typeof MobilityPlacementSchema>;

/** Most exercises in one routine; most result entries from the watch. */
export const MOBILITY_LIMITS = {
  exercises: 15,
  resultItems: 20,
  todayItems: 5,
  recent: 5,
  /** Longest routine the watch reports, in seconds (3 h). */
  maxSeconds: 10_800,
  /** Minutes a routine logged in chat may have. */
  logMinutesMax: 120,
} as const;

/* ------------------------------------------------------------ preference */

export const MobilityMorningPrefSchema = z.strictObject({
  weekdays: z
    .array(WeekdaySchema)
    .min(1)
    .max(7)
    .refine(noDuplicates, "Jeder Wochentag nur einmal."),
  minutes: MobilityMorningMinutesSchema,
});
export type MobilityMorningPref = z.infer<typeof MobilityMorningPrefSchema>;

export const MobilitySessionsPrefSchema = z.strictObject({
  placement: MobilityPlacementSchema,
  per_week: int.min(1).max(3),
  minutes: MobilitySessionMinutesSchema,
});
export type MobilitySessionsPref = z.infer<typeof MobilitySessionsPrefSchema>;

/** The answer "yes, mobility": at least a morning routine or sessions. */
export const MobilityWantedPreferenceSchema = z
  .strictObject({
    wants: z.literal(true),
    morning: MobilityMorningPrefSchema.nullable(),
    sessions: MobilitySessionsPrefSchema.nullable(),
    stiff_areas: z.array(MobilityAreaSchema).max(8),
  })
  .superRefine((value, ctx) => {
    if (value.morning === null && value.sessions === null)
      ctx.addIssue({
        code: "custom",
        path: ["morning"],
        message: "Morgenroutine oder Mobility-Einheiten wählen.",
      });
    if (!noDuplicates(value.stiff_areas))
      ctx.addIssue({
        code: "custom",
        path: ["stiff_areas"],
        message: "Jeder Bereich nur einmal.",
      });
  });
export type MobilityWantedPreference = z.infer<
  typeof MobilityWantedPreferenceSchema
>;

export const MobilityDeclinedPreferenceSchema = z.strictObject({
  wants: z.literal(false),
});

/** The mobility answer of the setup; absent means "not asked yet". */
export const MobilityPreferenceSchema = z.discriminatedUnion("wants", [
  MobilityDeclinedPreferenceSchema,
  MobilityWantedPreferenceSchema,
]);
export type MobilityPreference = z.infer<typeof MobilityPreferenceSchema>;

/** What Arnold proposes when the user wants mobility but names no details. */
export const MOBILITY_DEFAULTS = Object.freeze({
  morning: Object.freeze({
    weekdays: Object.freeze([...WEEKDAYS]),
    minutes: 10,
  }),
  sessions: Object.freeze({ per_week: 2, minutes: 20 }),
} as const);

/* --------------------------------------------------------------- template */

/** One timed exercise of a routine, as the timing engine returns it. */
export const MobilityRoutineItemSchema = z.strictObject({
  exercise_id: MobilityExerciseIdSchema,
  sides: z.union([z.literal(1), z.literal(2)]),
  seconds_per_side: int.min(5).max(600),
  reps: int.min(MOBILITY_REPS_MIN).max(MOBILITY_REPS_MAX).nullable(),
});
export type MobilityRoutineItem = z.infer<typeof MobilityRoutineItemSchema>;

/**
 * A stored routine: the chosen exercises and the seconds Arnold computed for
 * them, with the catalog and rules versions they were computed by.
 */
export const MobilityTemplateSchema = z
  .strictObject({
    catalog_version: z.string().min(1).max(32),
    rules_version: z.string().min(1).max(32),
    exercise_ids: z
      .array(MobilityExerciseIdSchema)
      .min(1)
      .max(MOBILITY_LIMITS.exercises),
    items: z
      .array(MobilityRoutineItemSchema)
      .min(1)
      .max(MOBILITY_LIMITS.exercises),
    total_s: nonneg.max(MOBILITY_LIMITS.maxSeconds),
  })
  .superRefine((value, ctx) => {
    if (!noDuplicates(value.exercise_ids))
      ctx.addIssue({
        code: "custom",
        path: ["exercise_ids"],
        message: "Jede Übung nur einmal.",
      });
    if (
      value.items.length !== value.exercise_ids.length ||
      value.items.some((item, i) => item.exercise_id !== value.exercise_ids[i])
    )
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Die Positionen folgen den Übungen in derselben Reihenfolge.",
      });
  });
export type MobilityTemplate = z.infer<typeof MobilityTemplateSchema>;

/* ---------------------------------------------------------- plan session */

/** Where a mobility session of a plan sits: its own weekday, or after strength. */
export const PlanMobilityPlacementSchema = z.enum([
  "own_day",
  "after_strength",
]);
export type PlanMobilityPlacement = z.infer<typeof PlanMobilityPlacementSchema>;

/**
 * The shape rules of a mobility session, shared by the plan view and the
 * stored row in arnold-schema-v1.ts.
 *
 * - morning: 5/10/15 minutes on 1–7 distinct weekdays, own_day, no anchor.
 * - session own_day: 15/20/30 minutes on exactly one weekday.
 * - session after_strength: 15/20/30 minutes, no weekday, follows a
 *   strength session (after_session_id).
 */
export function checkMobilitySessionShape(
  row: {
    kind: "morning" | "session";
    placement: PlanMobilityPlacement;
    weekdays: readonly number[];
    after_session_id: string | null;
    minutes: number;
  },
  ctx: z.RefinementCtx,
) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (new Set(row.weekdays).size !== row.weekdays.length)
    issue("weekdays", "Jeder Wochentag nur einmal.");
  if (row.kind === "morning") {
    if (!(MOBILITY_MORNING_MINUTES as readonly number[]).includes(row.minutes))
      issue("minutes", "Die Morgenroutine dauert 5, 10 oder 15 Minuten.");
    if (row.weekdays.length < 1)
      issue(
        "weekdays",
        "Die Morgenroutine braucht mindestens einen Wochentag.",
      );
    if (row.placement !== "own_day")
      issue("placement", "Die Morgenroutine steht an eigenen Tagen.");
    if (row.after_session_id !== null)
      issue("after_session_id", "Die Morgenroutine folgt keiner Krafteinheit.");
    return;
  }
  if (!(MOBILITY_SESSION_MINUTES as readonly number[]).includes(row.minutes))
    issue("minutes", "Eine Mobility-Einheit dauert 15, 20 oder 30 Minuten.");
  if (row.placement === "own_day") {
    if (row.weekdays.length !== 1)
      issue(
        "weekdays",
        "Eine eigene Mobility-Einheit hat genau einen Wochentag.",
      );
    if (row.after_session_id !== null)
      issue(
        "after_session_id",
        "Eine eigene Einheit folgt keiner Krafteinheit.",
      );
  } else {
    if (row.weekdays.length !== 0)
      issue(
        "weekdays",
        "Nach dem Krafttraining gibt es keinen eigenen Wochentag.",
      );
    if (row.after_session_id === null)
      issue(
        "after_session_id",
        "Nach welcher Krafteinheit? after_session_id fehlt.",
      );
  }
}

/* ----------------------------------------------------------------- result */

export const MOBILITY_RESULT_STATUSES = ["done", "skipped", "partial"] as const;
export const MobilityResultStatusSchema = z.enum(MOBILITY_RESULT_STATUSES);

/** One exercise of a finished routine: c=exercise, st=status, t=seconds. */
export const MobilityResultItemSchema = z.strictObject({
  c: MobilityExerciseIdSchema,
  st: MobilityResultStatusSchema,
  t: nonneg.max(MOBILITY_LIMITS.maxSeconds),
});
export type MobilityResultItem = z.infer<typeof MobilityResultItemSchema>;
export const MobilityResultItemsSchema = z
  .array(MobilityResultItemSchema)
  .max(MOBILITY_LIMITS.resultItems);

/** Who delivered a mobility result. */
export const MobilityResultSourceSchema = z.enum(["watch", "chat"]);

/* --------------------------------------------------------------- overview */

export const MobilityProfileStateSchema = z.enum(["not_asked", "no", "yes"]);

export const MobilityProfileViewSchema = z
  .strictObject({
    state: MobilityProfileStateSchema,
    preference: MobilityPreferenceSchema.nullable(),
  })
  .refine(
    (v) =>
      v.state === "not_asked"
        ? v.preference === null
        : v.preference !== null && v.preference.wants === (v.state === "yes"),
    "Zustand und Präferenz widersprechen sich.",
  );
export type MobilityProfileView = z.infer<typeof MobilityProfileViewSchema>;

export const MobilityTodayItemSchema = z.strictObject({
  session_id: id,
  kind: MobilityKindSchema,
  session_name: z.string().min(1).max(120),
  minutes: int.min(1).max(MOBILITY_LIMITS.logMinutesMax),
  done: z.boolean(),
  template: MobilityTemplateSchema,
});

export const MobilityAdherenceViewSchema = z
  .strictObject({
    planned_count: nonneg,
    done_count: nonneg,
    /** Null when nothing was planned: unknown, never 0. */
    ratio: z.number().min(0).max(1).nullable(),
    streak_days: nonneg,
    days: int.min(1).max(366),
  })
  .refine(
    (v) => (v.planned_count === 0) === (v.ratio === null),
    "ratio ist genau dann null, wenn nichts geplant war.",
  );

export const MobilityRecentSchema = z.strictObject({
  workout_id: id,
  date_local: z.iso.date(),
  kind: MobilityKindSchema,
  session_name: z.string().nullable(),
  /** Null when the duration is not known (chat log without minutes). */
  timer_s: nonneg.max(MOBILITY_LIMITS.maxSeconds).nullable(),
  exercises_done: nonneg.max(MOBILITY_LIMITS.resultItems),
  exercises_total: nonneg.max(MOBILITY_LIMITS.resultItems),
  source: MobilityResultSourceSchema,
  /**
   * True when the user stopped the routine on the watch. Optional: an older
   * answer without it means "not stated", never "finished".
   */
  ended_early: z.boolean().optional(),
});

/** `get_mobility_overview`. */
export const MobilityOverviewSchema = z.strictObject({
  profile: MobilityProfileViewSchema,
  today: z.strictObject({
    date_local: z.iso.date(),
    items: z.array(MobilityTodayItemSchema).max(MOBILITY_LIMITS.todayItems),
  }),
  adherence: MobilityAdherenceViewSchema,
  recent: z.array(MobilityRecentSchema).max(MOBILITY_LIMITS.recent),
});
export type MobilityOverview = z.infer<typeof MobilityOverviewSchema>;

/* ------------------------------------------------------------ tool inputs */

export const MOBILITY_WRITE_OPERATIONS = [
  "update_mobility_profile",
  "log_mobility",
] as const;
export type MobilityWriteOperation = (typeof MOBILITY_WRITE_OPERATIONS)[number];

/**
 * The user's IANA time zone. "Today" and the date of a routine logged in chat
 * are the user's calendar day in this zone, never the UTC day. Absent: the
 * service falls back to the zone of the user's last workout and otherwise
 * refuses (it never guesses UTC).
 */
export const MobilityTimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unbekannte Zeitzone (IANA, z. B. Europe/Berlin).");

export const MobilityToolInputs = {
  get_mobility_overview: z.strictObject({
    timezone: MobilityTimezoneSchema.optional().describe(
      "Zeitzone des Nutzers (IANA, z. B. Europe/Berlin); „heute“ wird in dieser Zone bestimmt.",
    ),
  }),
  update_mobility_profile: z.strictObject({
    request_id: requestId,
    preference: MobilityPreferenceSchema,
  }),
  log_mobility: z.strictObject({
    request_id: requestId,
    kind: MobilityKindSchema,
    /** The planned routine that was done; absent for a free routine. */
    session_id: id.optional(),
    /** Local calendar day; absent means today in the user's time zone. */
    workout_date_local: z.iso.date().optional(),
    /** Only what the user said; absent means unknown, never 0. */
    minutes: int.min(1).max(MOBILITY_LIMITS.logMinutesMax).optional(),
    /** Only after the user said yes to logging the same routine twice that day. */
    confirm_duplicate: z.boolean().optional(),
    /** Zone of the user; decides "today" when no date is given. */
    timezone: MobilityTimezoneSchema.optional(),
  }),
} as const;
export type MobilityToolName = keyof typeof MobilityToolInputs;

export const MOBILITY_ERROR_CODES = [
  "VALIDATION_ERROR",
  /** Same day and same session_id already logged. */
  "DUPLICATE_MOBILITY",
  "DUPLICATE_OPERATION",
  "MOBILITY_SESSION_NOT_FOUND",
  "DATE_IN_FUTURE",
  "REVISION_CONFLICT",
  "SETUP_REQUIRED",
  "SCHEMA_MISMATCH",
  "TEMPLATE_WRITE_FORBIDDEN",
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "STORAGE_UNAVAILABLE",
] as const;
export const MobilityErrorCodeSchema = z.enum(MOBILITY_ERROR_CODES);
export type MobilityErrorCode = z.infer<typeof MobilityErrorCodeSchema>;

const okOrError = (
  value: { ok: boolean; replayed: boolean; error: unknown },
  present: boolean,
  ctx: z.RefinementCtx,
) => {
  if (
    value.ok
      ? !present || value.error !== null
      : present || value.error === null || value.replayed
  )
    ctx.addIssue({
      code: "custom",
      message:
        "Ergebnis und Fehler widersprechen dem bestätigten Operationsstatus.",
    });
};

export const UpdateMobilityProfileResponseSchema = z
  .strictObject({
    ok: z.boolean(),
    replayed: z.boolean(),
    profile: MobilityProfileViewSchema.optional(),
    error: toolErrorSchema(MobilityErrorCodeSchema).nullable(),
  })
  .superRefine((v, ctx) => okOrError(v, v.profile !== undefined, ctx));
export type UpdateMobilityProfileResponse = z.infer<
  typeof UpdateMobilityProfileResponseSchema
>;

export const LogMobilityResponseSchema = z
  .strictObject({
    ok: z.boolean(),
    replayed: z.boolean(),
    workout_id: id.optional(),
    error: toolErrorSchema(MobilityErrorCodeSchema).nullable(),
  })
  .superRefine((v, ctx) => okOrError(v, v.workout_id !== undefined, ctx));
export type LogMobilityResponse = z.infer<typeof LogMobilityResponseSchema>;

/* ------------------------------------------------------------------ cards */

/**
 * The mobility cards. `show_arnold_mobility` only says which card to open;
 * every figure on a card comes from the mobility tools the card calls
 * itself. The card never computes a figure.
 */
export const MOBILITY_CARDS = [
  "mobility_today",
  "mobility_result",
  "mobility_setup",
] as const;
export type MobilityCard = (typeof MOBILITY_CARDS)[number];
export const MobilityCardSchema = z.enum(MOBILITY_CARDS);

export const MOBILITY_CARD_CONTRACT = "arnold.mobility_card/1" as const;

export const ShowMobilityCardInputSchema = z.strictObject({
  card: MobilityCardSchema.describe(
    "mobility_today = heutige Morgenroutine und Mobility-Einheit; mobility_result = Ergebnis einer Routine (workout_id, sonst die letzte); mobility_setup = Mobility einrichten (Morgenroutine, Einheiten, steife Bereiche).",
  ),
  workout_id: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Nur für mobility_result: die Routine, deren Ergebnis gezeigt wird.",
    ),
});
export type ShowMobilityCardInput = z.infer<typeof ShowMobilityCardInputSchema>;

export const MobilityCardViewSchema = z.strictObject({
  mobility_card_contract: z.literal(MOBILITY_CARD_CONTRACT),
  card: MobilityCardSchema,
  workout_id: z.string().nullable(),
});
export type MobilityCardView = z.infer<typeof MobilityCardViewSchema>;

/* ---------------------------------------------------------- watch payloads */

/** Wire budgets in UTF-8 bytes. */
export const MOBILITY_WATCH_BUDGET_BYTES = {
  today: 1200,
  routine: 2500,
} as const;

/** Same API version as the strength and run routes. */
const envelope = {
  api_version: z.literal(RUN_WATCH_API_VERSION),
  min_app_version: z.string().regex(/^\d+\.\d+\.\d+$/),
};
const hex16 = z.string().regex(/^[0-9a-f]{16}$/);

/**
 * One routine of today: id=session_id, k=kind (m morning, s session),
 * n=name, m=minutes, w=weekday bits (bit 0 = Monday; for a session after
 * strength the bit of today), a=strength session it follows (null when it
 * has its own day), dn=done today, tag=ETag of the routine.
 */
export const WatchMobilityTodayItemSchema = z
  .strictObject({
    id,
    k: z.enum(["m", "s"]),
    n: wireText(MOBILITY_TEXT_LIMITS.name),
    m: int.min(1).max(MOBILITY_LIMITS.logMinutesMax),
    w: int.min(1).max(127),
    a: id.nullable(),
    dn: z.boolean(),
    tag: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/),
  })
  .refine(
    (v) => v.k === "s" || v.a === null,
    "Die Morgenroutine folgt keiner Krafteinheit.",
  );

/** `GET` today's routines: d=today (local), mv=mobility mark (16 hex). */
export const WatchMobilityTodaySchema = z.strictObject({
  ...envelope,
  d: z.iso.date(),
  mv: hex16,
  items: z.array(WatchMobilityTodayItemSchema).max(MOBILITY_LIMITS.todayItems),
});
export type WatchMobilityToday = z.infer<typeof WatchMobilityTodaySchema>;

/**
 * One exercise of a routine on the watch: c=exercise, n=name, h=cue,
 * s=sides, t=seconds per side, r=repetitions (null unless mode reps).
 */
export const WatchMobilityExerciseSchema = z.strictObject({
  c: MobilityExerciseIdSchema,
  n: wireText(MOBILITY_TEXT_LIMITS.name),
  h: wireText(MOBILITY_TEXT_LIMITS.cue),
  s: z.union([z.literal(1), z.literal(2)]),
  t: int.min(1).max(600),
  r: int.min(MOBILITY_REPS_MIN).max(MOBILITY_REPS_MAX).nullable(),
});

/** One routine: id=session_id, tot=total seconds, ex=exercises. */
export const WatchMobilityRoutineSchema = z.strictObject({
  ...envelope,
  id,
  tot: nonneg.max(MOBILITY_LIMITS.maxSeconds),
  ex: z
    .array(WatchMobilityExerciseSchema)
    .min(1)
    .max(MOBILITY_LIMITS.exercises),
});
export type WatchMobilityRoutine = z.infer<typeof WatchMobilityRoutineSchema>;

/**
 * `POST` one finished routine. Never carries heart rate. plan_version_id and
 * session_id only together; neither is a free routine. `ended_early` is true
 * when the user stopped the routine on the watch.
 */
export const WatchMobilityRequestSchema = z
  .strictObject({
    request_id: z.string().regex(/^gm_[0-9a-f-]{36}$/),
    session_uuid: z.uuid(),
    plan_version_id: id.optional(),
    session_id: id.optional(),
    kind: MobilityKindSchema,
    workout_date_local: z.iso.date(),
    utc_offset_min: int.min(-840).max(840),
    started_at_utc: utc,
    ended_at_utc: utc,
    timer_s: nonneg.max(MOBILITY_LIMITS.maxSeconds),
    elapsed_s: nonneg.max(MOBILITY_LIMITS.maxSeconds),
    ended_early: z.boolean(),
    ex: MobilityResultItemsSchema,
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if ((v.plan_version_id === undefined) !== (v.session_id === undefined))
      issue("session_id", "plan_version_id und session_id nur gemeinsam.");
    if (v.timer_s > v.elapsed_s)
      issue("timer_s", "Bewegungszeit länger als die Gesamtzeit.");
    if (Date.parse(v.ended_at_utc) < Date.parse(v.started_at_utc))
      issue("ended_at_utc", "Ende liegt vor dem Beginn.");
  });
export type WatchMobilityRequest = z.infer<typeof WatchMobilityRequestSchema>;

export const WatchMobilityResponseSchema = z.strictObject({
  ...envelope,
  workout_id: id,
  replayed: z.boolean(),
});
export type WatchMobilityResponse = z.infer<typeof WatchMobilityResponseSchema>;
