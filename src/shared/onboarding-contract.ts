/**
 * The onboarding contract: domain objects, the state vocabulary, the profile
 * schema and the input/output schemas of every onboarding MCP tool.
 *
 * The flow it describes, as the user experiences it:
 *
 *   1. Welcome, with two buttons: "Plan mit Arnold erstellen" or "Eigenen
 *      Plan übernehmen" (`path`).
 *   2a. Arnold's plan: two cards, Person and Training, on one screen. Once the
 *       Training card is complete, "Plan erstellen" hands over to the chat,
 *       which builds the plan from the brief.
 *   2b. Own plan: the user pastes or photographs their plan in the chat, and
 *       the model transcribes it into a draft.
 *   3. Review, change by chat or editor, confirm exactly one revision.
 *   4. Arnold activates exactly that plan and the setup is complete.
 *
 * Four rules shape everything here.
 *
 * First, a setup belongs to the verified account: at most one open setup per
 * user, resumed in every chat. The server finds it through the identity of
 * the token, never through an argument, so no tool takes or returns a setup
 * id or a session secret (D-11). Internally a setup still has an id
 * (`OnboardingSessionRecordSchema`); it never becomes a `user_id` and never
 * leaves the server.
 *
 * Second, tool outputs carry no internal setup ids and no timestamps (D-20):
 * `OnboardingSessionSchema` is the stored session without them.
 *
 * Third, onboarding owns no training plan logic. A proposal is handed to the
 * `TrainingPlanService` and what comes back is referenced by `plan_version_id`
 * and `row_revision`. There is deliberately no plan structure stored in an
 * onboarding session: a second copy would be a second source of truth and
 * could disagree with the editor.
 *
 * Fourth, a confirmation names one plan version *and* one revision. It means
 * "the user released exactly this plan". Only the finishing step, which
 * activates that plan, can complete a setup.
 */
import { z } from "zod";
import { toolErrorSchema } from "./write-recovery.js";
import {
  ArnoldExecutionModeSchema,
  ArnoldIdSchema,
  ArnoldLoadBasisSchema,
  ArnoldUtcTimestampSchema,
} from "./arnold-schema-v1.js";
import {
  EQUIPMENT,
  EQUIPMENT_LABEL,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABEL,
  STARTER_EXERCISE_IDS,
  type Equipment,
  type MuscleGroup,
} from "./exercise-starter-catalog.js";
import {
  PlanValidationResultSchema,
  TrainingPlanVersionSchema,
  TrainingSessionInputSchema,
  CustomExerciseInputSchema,
} from "./plan-contract.js";
import {
  RUN_LIMITS,
  RunEnvironmentSchema,
  RunGoalSchema,
  RunReferenceSourceSchema,
} from "./run-contract.js";
import {
  MobilityAreaSchema,
  MobilityExerciseIdSchema,
  MobilityModeSchema,
  MobilityPositionSchema,
} from "./mobility-catalog.js";
import {
  MobilityPreferenceSchema,
  MobilityWantedPreferenceSchema,
} from "./mobility-contract.js";
import { WEEKDAYS, WeekdaySchema, type Weekday } from "./weekdays.js";

export {
  EQUIPMENT,
  EQUIPMENT_LABEL,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABEL,
  type Equipment,
  type MuscleGroup,
};

export const ONBOARDING_CONTRACT = "arnold.onboarding/2";
export const ONBOARDING_SCHEMA_VERSION = "2.0.0";

const id = ArnoldIdSchema;
const positiveInt = z.number().int().positive();
const nonnegativeInt = z.number().int().nonnegative();

/**
 * Free text the user wrote.
 *
 * Bounded and stored verbatim, but never interpreted: the brief labels it as
 * user data so a model reading it treats it as a preference, not as an
 * instruction to the server.
 */
const freeText = z.string().min(1).max(600);
const label = z.string().min(1).max(120);

/* ----------------------------------------------------------------- statuses */

/**
 * The business states of a setup.
 *
 * Loading and failure are *not* in here. A request that fails leaves the
 * session in the state it was in and reports `last_error`, so a network glitch
 * can never strand someone in a dead state they have to restart out of.
 */
export const ONBOARDING_STATUSES = [
  "NOT_STARTED",
  "COLLECTING_PROFILE",
  "PROFILE_READY",
  "WAITING_FOR_PLAN_PROPOSAL",
  "REVIEWING_PLAN",
  "PLAN_CONFIRMED",
  "READY_TO_FINISH",
  /** Reachable only through the finishing step, after the plan is active. */
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
] as const;
export const OnboardingStatusSchema = z.enum(ONBOARDING_STATUSES);
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;

/**
 * The wizard steps. A step is a screen; a status is a server fact.
 *
 * After the welcome the setup splits. "Plan mit Arnold" collects the two
 * cards Person and Training on one screen (`profile`); "Eigener Plan" hands
 * over to the chat, where the user pastes or photographs their plan
 * (`own_plan`). Both meet again at the plan proposal.
 */
export const ONBOARDING_STEPS = [
  "welcome",
  "profile",
  "own_plan",
  "plan_proposal",
  "plan_review",
  "confirmation",
  "finishing",
  "done",
] as const;
export const OnboardingStepSchema = z.enum(ONBOARDING_STEPS);
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

/** The two ways into Arnold, chosen with the two buttons on the welcome screen. */
export const ONBOARDING_PATHS = ["arnold_plan", "own_plan"] as const;
export const OnboardingPathSchema = z.enum(ONBOARDING_PATHS);
export type OnboardingPath = z.infer<typeof OnboardingPathSchema>;

/**
 * Which step a status opens on, so chat and UI never disagree about "where am I".
 *
 * While answers are collected the step follows the chosen path; no path yet
 * means the welcome screen with its two buttons.
 */
export function stepForStatus(
  status: OnboardingStatus,
  path: OnboardingPath | null,
): OnboardingStep {
  switch (status) {
    case "COLLECTING_PROFILE":
    case "PROFILE_READY":
      return path === null
        ? "welcome"
        : path === "own_plan"
          ? "own_plan"
          : "profile";
    case "WAITING_FOR_PLAN_PROPOSAL":
      return "plan_proposal";
    case "REVIEWING_PLAN":
      return "plan_review";
    case "PLAN_CONFIRMED":
      return "confirmation";
    case "READY_TO_FINISH":
      return "finishing";
    case "COMPLETED":
      return "done";
    default:
      return "welcome";
  }
}

/** Steps that collect answers. Going back to them is allowed until a plan exists. */
export const PROFILE_STEPS = [
  "welcome",
  "profile",
  "own_plan",
] as const satisfies readonly OnboardingStep[];

export const HANDOFF_STATUSES = [
  /** No confirmed plan yet. */
  "not_ready",
  /** A confirmed plan exists and matches the stored revision. */
  "ready_to_finish",
  /** The plan moved on after the confirmation; it must be confirmed again. */
  "superseded",
  /** The setup is finished and the plan is active. */
  "completed",
] as const;
export const HandoffStatusSchema = z.enum(HANDOFF_STATUSES);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

/* ------------------------------------------------------------------ profile */

/*
 * The profile has two cards, as the user sees them.
 *
 * Person: age, sex, height, weight and body areas to go easy on. All of it is
 * optional. It helps the plan (a 60-year-old beginner and a 20-year-old do not
 * get the same volume), but nobody is kept from a plan for skipping it.
 *
 * Training: goal, experience, days, minutes and place are required for the
 * "Plan mit Arnold" path, because a trainer cannot plan without them. Split,
 * focus, equipment and favourite exercises are optional refinements.
 *
 * There is no diagnosis, condition or medication field anywhere. "Bereiche
 * schonen" is a training preference (which joints to load carefully), not a
 * medical statement, and the brief tells the model exactly that.
 */

export const TRAINING_GOALS = [
  "muscle_gain",
  "strength",
  "fat_loss",
  "general_fitness",
  /** Added with the running feature; profiles without it stay valid. */
  "endurance_running",
] as const;
export const TrainingGoalSchema = z.enum(TRAINING_GOALS);
export type TrainingGoal = z.infer<typeof TrainingGoalSchema>;

export const EXPERIENCE_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
] as const;
export const ExperienceLevelSchema = z.enum(EXPERIENCE_LEVELS);
export type ExperienceLevel = z.infer<typeof ExperienceLevelSchema>;

export const TRAINING_ENVIRONMENTS = [
  "gym",
  "home",
  "outdoor",
  "mixed",
] as const;
export const TrainingEnvironmentSchema = z.enum(TRAINING_ENVIRONMENTS);
export type TrainingEnvironment = z.infer<typeof TrainingEnvironmentSchema>;

export const SEXES = ["female", "male", "diverse"] as const;
export const SexSchema = z.enum(SEXES);
export type Sex = z.infer<typeof SexSchema>;

/** Body areas a user wants to go easy on. A preference, never a diagnosis. */
export const BODY_AREAS = [
  "shoulder",
  "elbow",
  "wrist",
  "neck",
  "lower_back",
  "hip",
  "knee",
] as const;
export const BodyAreaSchema = z.enum(BODY_AREAS);
export type BodyArea = z.infer<typeof BodyAreaSchema>;

// Defined in a leaf so the mobility contract can use them without a cycle.
export { WEEKDAYS, WeekdaySchema, type Weekday };

/** `auto` is the default: Arnold picks the split that fits the days. */
export const SPLITS = [
  "auto",
  "full_body",
  "upper_lower",
  "push_pull_legs",
  "body_part",
] as const;
export const SplitSchema = z.enum(SPLITS);
export type Split = z.infer<typeof SplitSchema>;

/**
 * Which splits make sense for a number of training days.
 *
 * A trainer's rule of thumb, not a law: two days of push/pull/legs leave a
 * muscle group untrained for a week. The picker offers these; a different
 * choice is accepted and only earns a note.
 */
export function splitsForDays(days: number | null): Split[] {
  if (days === null) return [...SPLITS];
  const fitting: Split[] = ["auto"];
  if (days <= 4) fitting.push("full_body");
  if (days === 2 || days === 4 || days === 6) fitting.push("upper_lower");
  if (days === 3 || days >= 5) fitting.push("push_pull_legs");
  if (days >= 4) fitting.push("body_part");
  return fitting;
}

/**
 * Minutes per session.
 *
 * The UI offers 30/45/60/75/90; a free value is accepted inside a plausible
 * band. 20 minutes is a real short session, 240 is not an answer we store
 * silently — an unrealistic number is refused rather than quietly clamped.
 */
export const SESSION_MINUTES_PRESETS = [30, 45, 60, 75, 90] as const;
export const SESSION_MINUTES_MIN = 20;
export const SESSION_MINUTES_MAX = 150;
export const SessionMinutesSchema = z
  .number()
  .int()
  .min(SESSION_MINUTES_MIN)
  .max(SESSION_MINUTES_MAX);

export const DAYS_PER_WEEK_MIN = 1;
export const DAYS_PER_WEEK_MAX = 7;
export const DaysPerWeekSchema = z
  .number()
  .int()
  .min(DAYS_PER_WEEK_MIN)
  .max(DAYS_PER_WEEK_MAX);

export const AgeSchema = z.number().int().min(14).max(100);
export const HeightSchema = z.number().int().min(120).max(230);
export const BodyWeightSchema = z.number().min(30).max(300);

/**
 * Weights the user knows for an anchor lift (D-02, D-03): a weight and the
 * clean repetitions done with it (1–12). Each anchor is optional; an empty
 * answer ("weiß ich nicht") means Arnold estimates. Keys are catalog
 * exercise ids.
 *
 * The anchors depend on the equipment: per movement the first that fits
 * (`knownLoadAnchors` in onboarding-profile.ts).
 *
 * Older setups stored a bare number, the weight for "8–10" repetitions. It
 * stays readable and counts as 9 repetitions (`knownLoadEntry`).
 */
export const KNOWN_LOAD_ANCHORS = {
  push: ["bench-press", "dumbbell-bench-press", "chest-press-machine"],
  pull: ["lat-pulldown", "seated-cable-row", "one-arm-row"],
  legs: ["squat", "leg-press", "goblet-squat"],
} as const;
export type KnownLoadGroup = keyof typeof KNOWN_LOAD_ANCHORS;
export const KNOWN_LOAD_GROUPS = ["push", "pull", "legs"] as const;
export const KNOWN_LOAD_LIFTS = [
  ...KNOWN_LOAD_ANCHORS.push,
  ...KNOWN_LOAD_ANCHORS.pull,
  ...KNOWN_LOAD_ANCHORS.legs,
] as const;
export type KnownLoadLift = (typeof KNOWN_LOAD_LIFTS)[number];
export const KNOWN_LOAD_REPS_MIN = 1;
export const KNOWN_LOAD_REPS_MAX = 12;
/** The repetitions an old bare number stands for ("8–10"). */
export const LEGACY_KNOWN_LOAD_REPS = 9;

/** Upper bound per anchor, in the lift's own load basis (per dumbbell for dumbbells). */
const KNOWN_LOAD_MAX_KG: Record<KnownLoadLift, number> = {
  "bench-press": 400,
  "dumbbell-bench-press": 120,
  "chest-press-machine": 400,
  "lat-pulldown": 300,
  "seated-cable-row": 300,
  "one-arm-row": 120,
  squat: 500,
  "leg-press": 1000,
  "goblet-squat": 120,
};

const knownLoad = (maxKg: number) =>
  z.union([
    z.strictObject({
      kg: z.number().positive().max(maxKg),
      reps: z.number().int().min(KNOWN_LOAD_REPS_MIN).max(KNOWN_LOAD_REPS_MAX),
    }),
    /** Old form: the weight for 8–10 repetitions. Read as 9. */
    z.number().positive().max(maxKg),
  ]);

export const KnownLoadsSchema = z.strictObject(
  Object.fromEntries(
    KNOWN_LOAD_LIFTS.map((lift) => [
      lift,
      knownLoad(KNOWN_LOAD_MAX_KG[lift]).optional(),
    ]),
  ) as {
    [K in KnownLoadLift]: z.ZodOptional<ReturnType<typeof knownLoad>>;
  },
);
export type KnownLoads = z.infer<typeof KnownLoadsSchema>;
export type KnownLoadEntry = { kg: number; reps: number };

/** One stored answer in the current form; an old bare number counts as 9 reps. */
export function knownLoadEntry(
  value: KnownLoads[KnownLoadLift],
): KnownLoadEntry | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number"
    ? { kg: value, reps: LEGACY_KNOWN_LOAD_REPS }
    : value;
}

/** All stored answers in the current form. */
export function normalizeKnownLoads(
  loads: KnownLoads | undefined,
): Partial<Record<KnownLoadLift, KnownLoadEntry>> {
  const out: Partial<Record<KnownLoadLift, KnownLoadEntry>> = {};
  for (const lift of KNOWN_LOAD_LIFTS) {
    const entry = knownLoadEntry(loads?.[lift]);
    if (entry) out[lift] = entry;
  }
  return out;
}

/** The conversation cards of the new setup (more follow in later packages). */
export const ONBOARDING_CARDS = [
  "person",
  "modules",
  "checklist",
  "benchmarks",
  "run_reference",
] as const;
export const OnboardingCardSchema = z.enum(ONBOARDING_CARDS);
export type OnboardingCard = z.infer<typeof OnboardingCardSchema>;

/* ------------------------------------------------------------------ modules */

/**
 * What the user trains besides strength (D-01). Strength is always part of
 * Arnold and has no switch; the morning routine is part of mobility.
 *
 * Absent in setups from before Onboarding 2.0: then the modules follow from
 * the answers (`modulesOf`), so no stored record needs rewriting.
 */
export const OnboardingModulesSchema = z
  .strictObject({
    running: z.boolean(),
    mobility: z.boolean(),
    morning_routine: z.boolean(),
  })
  .refine(
    (modules) => modules.mobility || !modules.morning_routine,
    "Die Morgenroutine gehört zu Mobility.",
  );
export type OnboardingModules = z.infer<typeof OnboardingModulesSchema>;

const StarterExerciseIdSchema = z.enum(STARTER_EXERCISE_IDS);
const EquipmentSchema = z.enum(EQUIPMENT);
const MuscleGroupSchema = z.enum(MUSCLE_GROUPS);

/** The Person card. Every field is optional. */
export const PersonSchema = z.strictObject({
  age_years: AgeSchema.optional(),
  sex: SexSchema.optional(),
  height_cm: HeightSchema.optional(),
  body_weight_kg: BodyWeightSchema.optional(),
  protect_areas: z.array(BodyAreaSchema).max(BODY_AREAS.length).optional(),
});
export type Person = z.infer<typeof PersonSchema>;

/** The four basic Person answers behind the card's check mark. */
export const PERSON_BASICS = [
  "age_years",
  "sex",
  "height_cm",
  "body_weight_kg",
] as const;

/**
 * The run details of the running module.
 *
 * Field names are those of the run profile (`update_run_profile`). The
 * setup keeps them with the other answers and hands them to the run service
 * when it finishes; the run profile itself cannot be written before an
 * account is set up. Runs per week, weekly minutes, the longest run and the
 * environment are required: a plan with runs cannot be built without them,
 * and unknown is not 0. Since Onboarding 2.0 (D-01) the run goal is optional
 * and no longer tied to the main goal "Ausdauer und Laufen"; race date,
 * target time and reference stay optional.
 */
export const OnboardingRunSchema = z.strictObject({
  goal: RunGoalSchema.optional(),
  race_date: z.iso.date().optional(),
  target_time_s: positiveInt.max(RUN_LIMITS.maxSeconds).optional(),
  reference: z
    .strictObject({
      distance_m: positiveInt.max(RUN_LIMITS.maxMeters),
      time_s: positiveInt.max(RUN_LIMITS.maxSeconds),
      date: z.iso.date(),
      source: RunReferenceSourceSchema,
    })
    .optional(),
  runs_per_week: z.number().int().min(1).max(7),
  base_minutes_per_week: z.number().int().min(0).max(3000),
  longest_run_4w_min: z.number().int().min(0).max(600),
  preferred_environment: RunEnvironmentSchema,
});
export type OnboardingRun = z.infer<typeof OnboardingRunSchema>;

/**
 * The Training card.
 *
 * The required answers are nullable, because the card exists from the first
 * tap onwards and is filled step by step. Completeness is computed, never a
 * stored flag that could drift from the answers.
 *
 * `training_days` and `days_per_week` describe the same thing two ways: fixed
 * weekdays, or "flexibel, N Tage". When weekdays are given the count follows
 * them; the service keeps the two consistent.
 */
export const TrainingSchema = z.strictObject({
  primary_goal: TrainingGoalSchema.nullable(),
  /** Further goals beside the primary one, in the order chosen. */
  secondary_goals: z.array(TrainingGoalSchema).max(3).optional(),
  experience: ExperienceLevelSchema.nullable(),
  days_per_week: DaysPerWeekSchema.nullable(),
  training_days: z.array(WeekdaySchema).max(7).optional(),
  session_minutes: SessionMinutesSchema.nullable(),
  environment: TrainingEnvironmentSchema.nullable(),
  equipment: z.array(EquipmentSchema).max(EQUIPMENT.length).optional(),
  split: SplitSchema.optional(),
  focus_muscle_groups: z.array(MuscleGroupSchema).max(3).optional(),
  preferred_exercise_ids: z.array(StarterExerciseIdSchema).max(40).optional(),
  avoided_exercise_ids: z.array(StarterExerciseIdSchema).max(40).optional(),
  /** Weights the user knows; the start weights of the plan follow them. */
  known_loads: KnownLoadsSchema.optional(),
  /**
   * Running, mobility and morning routine besides strength (D-01). Absent
   * in older setups: `modulesOf` derives them from the answers.
   */
  modules: OnboardingModulesSchema.optional(),
  /** Only with the running module; see OnboardingRunSchema. */
  run: OnboardingRunSchema.optional(),
  /**
   * Whether the user has a mat for the morning routine (D-07). Absent means
   * not asked; only `true` allows floor exercises in the morning.
   */
  has_mat: z.boolean().optional(),
  /**
   * The mobility answer (ARN-MOB). Absent means "not asked yet". Never a
   * required field: a plan by Arnold is built without it.
   */
  mobility: MobilityPreferenceSchema.optional(),
  /** Verbatim user text. Data, never an instruction. */
  notes: freeText.optional(),
});
export type Training = z.infer<typeof TrainingSchema>;

/** The training profile: the chosen path plus the two cards. */
export const OnboardingProfileSchema = z.strictObject({
  path: OnboardingPathSchema.nullable(),
  person: PersonSchema,
  training: TrainingSchema,
  /** Bumped by every accepted change, so a stale write is detectable. */
  revision: nonnegativeInt,
  updated_at_utc: ArnoldUtcTimestampSchema.nullable(),
});
export type OnboardingProfile = z.infer<typeof OnboardingProfileSchema>;

/**
 * A proposal's sessions as the onboarding layer inspects them.
 *
 * Structurally the plan service's `TrainingSessionInput`, but typed loosely on
 * purpose: the onboarding check only asks whether the shape answers the
 * profile, and must not re-declare the plan domain's own input contract.
 */
export type TrainingSessionInputLike = {
  session_name: string;
  exercises?: readonly unknown[];
};

/** Training answers a plan by Arnold cannot be built without. */
export const TRAINING_REQUIRED_FIELDS = [
  "primary_goal",
  "experience",
  "days_per_week",
  "session_minutes",
  "environment",
] as const;
export type TrainingRequiredField = (typeof TRAINING_REQUIRED_FIELDS)[number];

/** Run answers the running module cannot plan without (D-01). */
export const RUN_REQUIRED_FIELDS = [
  "training.run.runs_per_week",
  "training.run.base_minutes_per_week",
  "training.run.longest_run_4w_min",
  "training.run.preferred_environment",
] as const;

/**
 * Mobility answers (D-01). Stiff areas for every mobility wish; an empty
 * list is an answer (D-08: a general routine, never invented areas). The
 * morning routine adds minutes, weekdays and the mat. Without a morning
 * routine the mobility answer needs its sessions: the mobility contract
 * keeps a wish only with a morning routine or sessions.
 */
export const MOBILITY_REQUIRED_FIELDS = [
  "training.mobility.stiff_areas",
] as const;
export const MOBILITY_SESSIONS_REQUIRED_FIELDS = [
  "training.mobility.sessions",
] as const;
export const MORNING_REQUIRED_FIELDS = [
  "training.mobility.morning.minutes",
  "training.mobility.morning.weekdays",
  "training.has_mat",
] as const;

/** A required answer, as the completeness check and the UI both name it. */
export type RequiredProfileField =
  | "path"
  | `training.${TrainingRequiredField}`
  | (typeof RUN_REQUIRED_FIELDS)[number]
  | (typeof MOBILITY_REQUIRED_FIELDS)[number]
  | (typeof MOBILITY_SESSIONS_REQUIRED_FIELDS)[number]
  | (typeof MORNING_REQUIRED_FIELDS)[number];

/** Strength only: what a profile without modules and answers trains. */
export const STRENGTH_ONLY: OnboardingModules = Object.freeze({
  running: false,
  mobility: false,
  morning_routine: false,
});

/**
 * The modules of a profile: the stored choice, or for setups from before
 * Onboarding 2.0 what their answers imply. Running follows the goal
 * "Ausdauer und Laufen" or stored run details; mobility follows a "yes" to
 * mobility, the morning routine a "yes" with a morning routine. Derived on
 * every read, so no stored record needs a migration.
 */
export function modulesOf(training: Training): OnboardingModules {
  if (training.modules) return training.modules;
  const mobility = training.mobility;
  const wantsMobility = mobility?.wants === true;
  return {
    running:
      training.primary_goal === "endurance_running" ||
      (training.secondary_goals ?? []).includes("endurance_running") ||
      training.run !== undefined,
    mobility: wantsMobility,
    morning_routine: wantsMobility && mobility.morning !== null,
  };
}

/**
 * The required answers for a path and the chosen modules, in asking order.
 * Strength always counts; running and mobility add their own (D-01).
 */
export function requiredFieldsFor(
  path: OnboardingPath | null,
  modules: OnboardingModules = STRENGTH_ONLY,
): RequiredProfileField[] {
  if (path === null) return ["path"];
  if (path === "own_plan") return [];
  const fields: RequiredProfileField[] = TRAINING_REQUIRED_FIELDS.map(
    (field) => `training.${field}` as const,
  );
  if (modules.running) fields.push(...RUN_REQUIRED_FIELDS);
  if (modules.mobility) {
    fields.push(...MOBILITY_REQUIRED_FIELDS);
    if (modules.morning_routine) fields.push(...MORNING_REQUIRED_FIELDS);
    else fields.push(...MOBILITY_SESSIONS_REQUIRED_FIELDS);
  }
  return fields;
}

/**
 * The patch a caller sends. Absent means "leave unchanged".
 *
 * Person fields and notes accept `null` to remove an answer ("lieber doch kein
 * Gewicht"); required training answers cannot be cleared, only changed. Lists
 * replace the stored list, so sending `[]` clears one.
 */
export const PersonPatchSchema = z.strictObject({
  age_years: AgeSchema.nullable().optional(),
  sex: SexSchema.nullable().optional(),
  height_cm: HeightSchema.nullable().optional(),
  body_weight_kg: BodyWeightSchema.nullable().optional(),
  protect_areas: z.array(BodyAreaSchema).max(BODY_AREAS.length).optional(),
});
export type PersonPatch = z.infer<typeof PersonPatchSchema>;

export const TrainingPatchSchema = z
  .strictObject({
    primary_goal: TrainingGoalSchema.optional(),
    secondary_goals: z.array(TrainingGoalSchema).max(3).optional(),
    experience: ExperienceLevelSchema.optional(),
    days_per_week: DaysPerWeekSchema.optional(),
    training_days: z.array(WeekdaySchema).max(7).optional(),
    session_minutes: SessionMinutesSchema.optional(),
    environment: TrainingEnvironmentSchema.optional(),
    equipment: z.array(EquipmentSchema).max(EQUIPMENT.length).optional(),
    split: SplitSchema.optional(),
    focus_muscle_groups: z.array(MuscleGroupSchema).max(3).optional(),
    preferred_exercise_ids: z.array(StarterExerciseIdSchema).max(40).optional(),
    avoided_exercise_ids: z.array(StarterExerciseIdSchema).max(40).optional(),
    known_loads: KnownLoadsSchema.nullable().optional(),
    modules: OnboardingModulesSchema.optional(),
    run: OnboardingRunSchema.nullable().optional(),
    /** null removes the answer again ("not asked"). */
    has_mat: z.boolean().nullable().optional(),
    /** null removes the answer again ("not asked"). */
    mobility: MobilityPreferenceSchema.nullable().optional(),
    notes: freeText.nullable().optional(),
  })
  .refine(
    (training) =>
      !training.preferred_exercise_ids?.some((exercise) =>
        training.avoided_exercise_ids?.includes(exercise),
      ),
    "Eine Übung kann nicht gleichzeitig bevorzugt und gemieden werden.",
  );
export type TrainingPatch = z.infer<typeof TrainingPatchSchema>;

export const OnboardingProfilePatchSchema = z
  .strictObject({
    path: OnboardingPathSchema.optional(),
    person: PersonPatchSchema.optional(),
    training: TrainingPatchSchema.optional(),
  })
  .refine(
    (patch) => Object.keys(patch).length > 0,
    "Mindestens eine Angabe erforderlich.",
  );
export type OnboardingProfilePatch = z.infer<
  typeof OnboardingProfilePatchSchema
>;

/* --------------------------------------------------------------- validation */

export const ONBOARDING_VALIDATION_CODES = [
  /** A hint of the plan quality check (src/analytics/plan-quality.ts). */
  "PLAN_QUALITY_HINT",
  "MISSING_PATH",
  "MISSING_PRIMARY_GOAL",
  "MISSING_EXPERIENCE",
  "MISSING_DAYS_PER_WEEK",
  "MISSING_SESSION_MINUTES",
  "MISSING_ENVIRONMENT",
  "IMPLAUSIBLE_SESSION_MINUTES",
  "IMPLAUSIBLE_DAYS_PER_WEEK",
  "SPLIT_DAYS_MISMATCH",
  "EQUIPMENT_ENVIRONMENT_MISMATCH",
  "PREFERRED_EXERCISE_UNAVAILABLE",
  "PERSON_INCOMPLETE",
  "PROPOSAL_DAYS_MISMATCH",
  "PROPOSAL_NO_SESSION",
  "PROPOSAL_EMPTY_SESSION",
  // Added with UX-012. Append only: codes are never renamed or removed.
  "PROPOSAL_AVOIDED_EXERCISE",
  "PROPOSAL_EQUIPMENT_MISSING",
  "PROPOSAL_OVER_TIME_BUDGET",
  // Added with Onboarding 2.0 (RDS-003): required answers per module.
  "MISSING_RUN_DETAILS",
  "MISSING_MOBILITY_DETAILS",
  "MISSING_MORNING_ROUTINE",
  "MISSING_HAS_MAT",
] as const;
export const OnboardingValidationCodeSchema = z.enum(
  ONBOARDING_VALIDATION_CODES,
);
export type OnboardingValidationCode = z.infer<
  typeof OnboardingValidationCodeSchema
>;

/**
 * One finding about the profile or a proposal.
 *
 * `field` is what the UI anchors the message to, which is why a validation
 * error can be rendered at the input that caused it instead of in a banner.
 */
export const OnboardingValidationIssueSchema = z.strictObject({
  code: OnboardingValidationCodeSchema,
  severity: z.enum(["error", "warning", "recommendation"]),
  message: z.string(),
  field: z.string().nullable(),
  step: OnboardingStepSchema.nullable(),
});
export type OnboardingValidationIssue = z.infer<
  typeof OnboardingValidationIssueSchema
>;

export const OnboardingValidationResultSchema = z.strictObject({
  /** True when no blocking error remains. Warnings never block. */
  valid: z.boolean(),
  errors: z.array(OnboardingValidationIssueSchema),
  warnings: z.array(OnboardingValidationIssueSchema),
  recommendations: z.array(OnboardingValidationIssueSchema),
});
export type OnboardingValidationResult = z.infer<
  typeof OnboardingValidationResultSchema
>;

/* ----------------------------------------------------------------- progress */

export const OnboardingProgressSchema = z.strictObject({
  current_step: OnboardingStepSchema,
  /** Completed collection steps, for the progress indicator. */
  completed_steps: z.array(OnboardingStepSchema),
  /** Of the required answers for the chosen path. */
  answered_required: nonnegativeInt,
  total_required: nonnegativeInt,
  profile_complete: z.boolean(),
  /** The check marks on the two cards. Person counts its four basic answers. */
  person_complete: z.boolean(),
  training_complete: z.boolean(),
  /** Required fields still missing, in asking order. */
  missing_fields: z.array(z.string()),
  /** 0–100, for the bar. Derived, never stored. */
  percent: nonnegativeInt,
  can_request_plan: z.boolean(),
  can_confirm_plan: z.boolean(),
});
export type OnboardingProgress = z.infer<typeof OnboardingProgressSchema>;

/* -------------------------------------------------- proposal / confirmation */

export const PLAN_PROPOSAL_ORIGINS = [
  /** Structured by the model from the profile. */
  "ai_proposal",
  /** A routine the user already follows, transcribed from their message or photo. */
  "existing_routine",
  /** Built by hand in the editor. */
  "manual",
] as const;
export const PlanProposalOriginSchema = z.enum(PLAN_PROPOSAL_ORIGINS);
export type PlanProposalOrigin = z.infer<typeof PlanProposalOriginSchema>;

/** The reference to the draft the plan service created. Never a copy of it. */
export const OnboardingPlanProposalSchema = z.strictObject({
  plan_version_id: id,
  plan_family_id: id,
  /** The revision the proposal had when it was stored. */
  row_revision: positiveInt,
  name: z.string(),
  origin: PlanProposalOriginSchema,
  session_count: nonnegativeInt,
  exercise_count: nonnegativeInt,
  proposed_at_utc: ArnoldUtcTimestampSchema,
  /** Which model or path produced it, for the audit trail. Free text, no identity. */
  proposed_by: z.enum(["chatgpt", "user", "import"]),
});
export type OnboardingPlanProposal = z.infer<
  typeof OnboardingPlanProposalSchema
>;

/**
 * The user's release of exactly one revision.
 *
 * Binding the revision is the whole point: an edit after the confirmation
 * changes `row_revision`, the stored confirmation no longer matches, and the
 * handoff turns `superseded` instead of carrying a plan nobody approved.
 */
export const OnboardingPlanConfirmationSchema = z.strictObject({
  plan_version_id: id,
  row_revision: positiveInt,
  profile_revision: nonnegativeInt,
  confirmed_at_utc: ArnoldUtcTimestampSchema,
  /** What the user saw when they confirmed, so the record is reconstructable. */
  session_count: nonnegativeInt,
  exercise_count: nonnegativeInt,
});
export type OnboardingPlanConfirmation = z.infer<
  typeof OnboardingPlanConfirmationSchema
>;

/**
 * What the finishing step receives.
 *
 * Only validated references, no session secret and no personal data, so
 * everything in it is safe to log.
 */
export const OnboardingHandoffSchema = z.strictObject({
  status: HandoffStatusSchema,
  confirmed_plan_version_id: id.nullable(),
  confirmed_plan_revision: positiveInt.nullable(),
  profile_revision: nonnegativeInt.nullable(),
  /** The draft's revision as of *now*. Differs from the confirmed one when superseded. */
  current_plan_revision: positiveInt.nullable(),
  /** Why the handoff is not ready, when it is not. */
  blocked_reason: z.string().nullable(),
  /** True until the setup is finished. */
  finish_pending: z.boolean(),
});
export type OnboardingHandoff = z.infer<typeof OnboardingHandoffSchema>;

/* ------------------------------------------------------------------ session */

/**
 * The stored onboarding session. The single authority for setup state.
 *
 * Server-internal: `onboarding_session_id` identifies a *setup*, not a person,
 * and never leaves the server (D-11). Tools see `OnboardingSessionSchema`.
 */
export const OnboardingSessionRecordSchema = z.strictObject({
  onboarding_session_id: id,
  status: OnboardingStatusSchema,
  current_step: OnboardingStepSchema,
  schema_version: z.literal(ONBOARDING_SCHEMA_VERSION),
  created_at_utc: ArnoldUtcTimestampSchema,
  updated_at_utc: ArnoldUtcTimestampSchema,
  expires_at_utc: ArnoldUtcTimestampSchema,
  /** Bumped by every accepted write. An expected-revision mismatch is refused. */
  revision: positiveInt,
  profile: OnboardingProfileSchema,
  plan_draft_reference: OnboardingPlanProposalSchema.nullable(),
  confirmed_plan_reference: OnboardingPlanConfirmationSchema.nullable(),
  handoff_status: HandoffStatusSchema,
  /** The last refusal, so a client can show it without inventing a dead state. */
  last_error: z
    .strictObject({
      code: z.string(),
      message: z.string(),
      at: ArnoldUtcTimestampSchema,
    })
    .nullable(),
  /** Which tracker the plan draft lives on. */
  tracker_id: id,
});
export type OnboardingSessionRecord = z.infer<
  typeof OnboardingSessionRecordSchema
>;

/**
 * The session as tools return it (D-11, D-20): no setup id, no tracker id and
 * no timestamps. The server finds the setup through the verified identity, so
 * a caller never needs to name it.
 */
export const OnboardingSessionSchema = OnboardingSessionRecordSchema.omit({
  onboarding_session_id: true,
  created_at_utc: true,
  updated_at_utc: true,
  expires_at_utc: true,
  tracker_id: true,
}).extend({
  plan_draft_reference: OnboardingPlanProposalSchema.omit({
    proposed_at_utc: true,
  }).nullable(),
  confirmed_plan_reference: OnboardingPlanConfirmationSchema.omit({
    confirmed_at_utc: true,
  }).nullable(),
  last_error: z
    .strictObject({ code: z.string(), message: z.string() })
    .nullable(),
});
export type OnboardingSession = z.infer<typeof OnboardingSessionSchema>;

/* -------------------------------------------------------------------- brief */

const BriefExerciseRefSchema = z.strictObject({
  exercise_id: id,
  name_de: z.string(),
  /** Whether the id is in `exercise_catalog` and may be used as is. */
  in_catalog: z.boolean(),
});

/**
 * The structured input ChatGPT builds a plan from.
 *
 * It is a *brief*, not a prompt: facts the user stated, named constraints, and
 * explicit instructions about what must not be invented. Everything the user
 * wrote freely is grouped under `user_statements` and labelled as data.
 *
 * For the own-plan path most training facts are null: the plan comes from the
 * user's message or photo, and the brief then says how to transcribe it.
 */
export const OnboardingBriefSchema = z.strictObject({
  onboarding_contract: z.literal(ONBOARDING_CONTRACT),
  profile_revision: nonnegativeInt,
  path: OnboardingPathSchema,
  /** What to do, in one sentence, for the path the user chose. */
  task: z.string(),
  person: z.strictObject({
    age_years: z.number().int().nullable(),
    sex: SexSchema.nullable(),
    height_cm: z.number().int().nullable(),
    body_weight_kg: z.number().nullable(),
    protect_areas: z.array(BodyAreaSchema),
  }),
  goal: z
    .strictObject({
      primary: TrainingGoalSchema,
      primary_label: z.string(),
      /** Further goals the user also chose; weigh them below the primary. */
      secondary: z.array(TrainingGoalSchema).default([]),
      secondary_labels: z.array(z.string()).default([]),
    })
    .nullable(),
  experience: ExperienceLevelSchema.nullable(),
  experience_label: z.string().nullable(),
  availability: z
    .strictObject({
      days_per_week: DaysPerWeekSchema,
      training_days: z.array(WeekdaySchema),
      session_minutes: SessionMinutesSchema,
      /** Rough budget in exercises per session, from the stated minutes. */
      suggested_exercises_per_session: z.strictObject({
        min: positiveInt,
        max: positiveInt,
      }),
    })
    .nullable(),
  environment: TrainingEnvironmentSchema.nullable(),
  environment_label: z.string().nullable(),
  equipment: z.array(EquipmentSchema),
  split: z
    .strictObject({
      preference: SplitSchema,
      label: z.string(),
      fitting: z.array(SplitSchema),
    })
    .nullable(),
  focus_muscle_groups: z.array(MuscleGroupSchema),
  preferred_exercises: z.array(BriefExerciseRefSchema),
  avoided_exercises: z.array(BriefExerciseRefSchema),
  /** The run details of a running goal; user answers, not Arnold's numbers. */
  running: OnboardingRunSchema.optional(),
  /** The mobility wish (only when the user wants mobility). */
  mobility: MobilityWantedPreferenceSchema.optional(),
  /**
   * The mobility catalog a routine must draw its exercises from. Arnold
   * computes the seconds; the cues stay on the watch.
   */
  mobility_catalog: z
    .array(
      z.strictObject({
        id: MobilityExerciseIdSchema,
        name_de: z.string(),
        areas: z.array(MobilityAreaSchema),
        mode: MobilityModeSchema,
        per_side: z.boolean(),
        position: MobilityPositionSchema,
        needs_mat: z.boolean(),
        default_s: positiveInt,
        min_s: positiveInt,
        max_s: positiveInt,
      }),
    )
    .optional(),
  /** Verbatim user text, explicitly marked as data and not as an instruction. */
  user_statements: z.array(
    z.strictObject({ field: z.string(), text: z.string() }),
  ),
  /** The catalog a proposal must draw its `exercise_id`s from. */
  exercise_catalog: z.array(
    z.strictObject({
      exercise_id: id,
      name_de: z.string(),
      equipment: z.string(),
      primary_muscle: z.string(),
      default_load_basis: ArnoldLoadBasisSchema,
      default_execution_mode: ArnoldExecutionModeSchema,
      default_implement_count: positiveInt,
    }),
  ),
  /** Hard rules for building the proposal. Phrased for a model to follow. */
  constraints: z.array(z.string()),
  /** Named things a proposal must not fabricate. */
  must_not_invent: z.array(z.string()),
});
export type OnboardingBrief = z.infer<typeof OnboardingBriefSchema>;

/* ----------------------------------------------------------- open questions */

/**
 * The questions the setup may still ask, in asking order. `required` ones
 * block a plan by Arnold; `ask_once` ones are asked once and may be skipped
 * (the old mobility question of setups without a module choice).
 */
export const OPEN_QUESTION_IDS = [
  "path",
  "training.primary_goal",
  "training.experience",
  "training.days_per_week",
  "training.session_minutes",
  "training.environment",
  "run_details",
  "mobility",
  "mobility_details",
  // Added with Onboarding 2.0 (RDS-003): required answers per module.
  "training.mobility.stiff_areas",
  "training.mobility.sessions",
  "morning_routine",
  "training.has_mat",
] as const;
export const OpenQuestionIdSchema = z.enum(OPEN_QUESTION_IDS);
export type OpenQuestionId = z.infer<typeof OpenQuestionIdSchema>;

export const OpenQuestionSchema = z.strictObject({
  id: OpenQuestionIdSchema,
  kind: z.enum(["required", "ask_once"]),
  /** The question in one short sentence, as the chat may ask it. */
  ask: z.string().min(1).max(160),
  /** The profile fields an answer fills, e.g. "training.mobility". */
  fields: z.array(z.string()),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

/* -------------------------------------------------------------------- state */

/** One tile of the "which exercises do you like?" picker. */
export const ExerciseChoiceSchema = z.strictObject({
  exercise_id: id,
  name_de: z.string(),
  muscle_group: MuscleGroupSchema,
  muscle_group_label: z.string(),
});
export type ExerciseChoice = z.infer<typeof ExerciseChoiceSchema>;

/**
 * One onboarding state as every caller sees it: the session, what is possible
 * next, and the referenced plan when there is one.
 *
 * The plan is embedded as the plan service projects it, so the UI needs no
 * second round trip and cannot render a plan the server did not confirm.
 */
export const OnboardingStateSchema = z.strictObject({
  onboarding_contract: z.literal(ONBOARDING_CONTRACT),
  session: OnboardingSessionSchema,
  progress: OnboardingProgressSchema,
  validation: OnboardingValidationResultSchema,
  /** The referenced draft or confirmed version, projected by the plan service. */
  plan: TrainingPlanVersionSchema.nullable(),
  plan_validation: PlanValidationResultSchema.nullable(),
  handoff: OnboardingHandoffSchema,
  /** Which events the state machine would accept right now. Drives the UI. */
  allowed_events: z.array(z.string()),
  /**
   * The exercises the picker offers, filtered by where the user trains. The
   * UI renders these; it never filters the catalog itself.
   */
  exercise_choices: z.array(ExerciseChoiceSchema),
  /** The splits that fit the chosen number of days, `auto` first. */
  split_options: z.array(SplitSchema),
  /**
   * Arnold's start-weight estimates for the exercises of the draft, at the
   * three levels of the "Startgewichte" switch. The card compares a stored
   * weight with these to tell an estimate from the user's own value; it never
   * computes a weight itself.
   */
  load_estimates: z
    .array(
      z.strictObject({
        plan_item_id: ArnoldIdSchema,
        lighter: z.number().positive(),
        normal: z.number().positive(),
        heavier: z.number().positive(),
      }),
    )
    .default([]),
  /**
   * The run details a running goal needs. `required` follows the goals
   * ("Ausdauer und Laufen" chosen); `ready` is true once the run profile
   * holds them. Absent in older states: nothing required.
   */
  run_setup: z
    .strictObject({ required: z.boolean(), ready: z.boolean() })
    .default({ required: false, ready: true }),
  /** What the setup may still ask, in order. Absent in older states. */
  open_questions: z.array(OpenQuestionSchema).default([]),
  /** `production` when the setup belongs to a verified account. */
  mode: z.enum(["fixture", "production"]),
  setup_finish_available: z.boolean().default(false),
  /** False when this deployment cannot write a plan draft at all. */
  can_write_plan: z.boolean(),
  /**
   * Honest statement of what resumption can and cannot do. Shown in the UI
   * rather than promising continuation we cannot deliver.
   */
  resume: z.strictObject({
    /** True when the repository survives a server restart. */
    durable: z.boolean(),
    /** True when the setup belongs to the account and opens in any new chat. */
    cross_device: z.boolean(),
    note: z.string(),
  }),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

/**
 * The payload that opens the onboarding app.
 *
 * Carries its contract name so the React shell can tell an onboarding payload
 * from a dashboard payload without guessing.
 */
export const OnboardingViewSchema = z.strictObject({
  onboarding_contract: z.literal(ONBOARDING_CONTRACT),
  /** The card the UI shows; absent when the setup opens as before. */
  card: OnboardingCardSchema.optional(),
  state: OnboardingStateSchema,
  /** Shown once when a session was resumed rather than created. */
  resumed: z.boolean(),
  source: z.strictObject({
    label: z.string(),
    description: z.string(),
    schema_version: z.literal(ONBOARDING_SCHEMA_VERSION),
  }),
});
export type OnboardingView = z.infer<typeof OnboardingViewSchema>;

/* ------------------------------------------------------------------- errors */

export const ONBOARDING_ERROR_CODES = [
  "VALIDATION_ERROR",
  "SESSION_NOT_FOUND",
  "SESSION_EXPIRED",
  "SESSION_CANCELLED",
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "REVISION_CONFLICT",
  "INVALID_STATE_TRANSITION",
  "PROFILE_INCOMPLETE",
  "PLAN_PROPOSAL_REQUIRED",
  "PLAN_PROPOSAL_INVALID",
  "PLAN_NOT_FOUND",
  "STALE_CONFIRMATION",
  "CONFIRMATION_REQUIRED",
  "HANDOFF_NOT_READY",
  "HANDOFF_SUPERSEDED",
  /** This account is already set up; the onboarding runs only once. */
  "ONBOARDING_ALREADY_COMPLETED",
  "PLAN_WRITE_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  "DUPLICATE_OPERATION",
] as const;
export const OnboardingErrorCodeSchema = z.enum(ONBOARDING_ERROR_CODES);
export type OnboardingErrorCode = z.infer<typeof OnboardingErrorCodeSchema>;

/* ------------------------------------------------------------- addressing */

/*
 * No onboarding tool names its setup (D-11). The server finds the caller's
 * open setup through the verified identity of the token; there is no session
 * id and no session secret in any input or output.
 *
 * Older clients (cards already stored in a chat) still send
 * `onboarding_session_id` and `session_token`. The top-level input objects are
 * therefore *stripping* objects: unknown keys are dropped before the service
 * sees them, so such a field can never select or unlock a setup, and an old
 * card keeps working instead of failing on a field that no longer matters.
 * Everything nested stays strict.
 */
const request = { request_id: z.string().min(1).max(128) };
/** Guards against a write built on a state the caller has not seen. */
const expected = {
  expected_revision: positiveInt.optional(),
};

/* -------------------------------------------------------------- tool inputs */

export const OnboardingToolInputs = {
  /**
   * Opens the account's open setup, or starts one. `card` picks one of the
   * small conversation cards; without it the setup opens as before.
   */
  show_arnold_onboarding: z.object({
    card: OnboardingCardSchema.optional(),
  }),
  /** Continues the account's open setup, or starts one. */
  start_arnold_onboarding: z.object({ ...request }),
  get_onboarding_state: z.object({}),
  /**
   * Saves answers, moves to a step, or both.
   *
   * `step` alone is backward navigation: it changes where the setup is without
   * touching an answer, so returning to an earlier screen never costs data.
   * One of `profile` or `step` must be present.
   */
  update_onboarding_profile: z
    .object({
      ...request,
      ...expected,
      profile: OnboardingProfilePatchSchema.optional(),
      step: OnboardingStepSchema.optional(),
    })
    .refine(
      (input) => input.profile !== undefined || input.step !== undefined,
      "Entweder Angaben oder ein Schritt müssen übergeben werden.",
    ),
  get_onboarding_brief: z.object({}),
  request_onboarding_plan: z.object({
    ...request,
    ...expected,
  }),
  submit_onboarding_plan_proposal: z.object({
    ...request,
    ...expected,
    name: label,
    origin: PlanProposalOriginSchema,
    split_key: z.string().min(1).max(60).optional(),
    sessions: z.array(TrainingSessionInputSchema).min(1).max(14),
    /** Open points the proposal knowingly leaves unresolved. Shown, not hidden. */
    open_questions: z.array(freeText).max(10).optional(),
    /** Exercises outside the catalog, referenced by key in `sessions` (B11). */
    custom_exercises: z.array(CustomExerciseInputSchema).max(20).optional(),
  }),
  get_onboarding_plan: z.object({}),
  confirm_onboarding_plan: z.object({
    ...request,
    ...expected,
    /** Must name the version *and* the revision the user actually saw. */
    confirmation: z.strictObject({
      plan_version_id: id,
      row_revision: positiveInt,
      confirmed: z.literal(true),
    }),
  }),
  revise_onboarding_plan: z.object({
    ...request,
    ...expected,
    reason: freeText.optional(),
  }),
  get_onboarding_handoff: z.object({}),
  /** Activates the confirmed plan and completes the setup. Safe to repeat. */
  finish_arnold_setup: z.object({ ...request }),
  cancel_onboarding: z.object({
    ...request,
    reason: freeText.optional(),
  }),
} as const;
export type OnboardingToolName = keyof typeof OnboardingToolInputs;

/* ------------------------------------------------------------- tool outputs */

/**
 * The envelope every onboarding tool answers with.
 *
 * A write always returns the state as it was *stored*, never the state the
 * caller hoped for: `ok: false` carries the unchanged state plus the reason, so
 * a refusal is informative instead of destructive.
 */
export const OnboardingResponseSchema = z.strictObject({
  ok: z.boolean(),
  operation: z.string(),
  request_id: z.string(),
  /** True when a repeated request_id returned the already-stored outcome. */
  replayed: z.boolean(),
  state: OnboardingStateSchema.nullable(),
  error: toolErrorSchema(OnboardingErrorCodeSchema).nullable(),
});
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;

/* ------------------------------------------------------------------- labels */

/** German labels. Enum values are storage keys and are never shown raw. */
export const PATH_LABEL: Record<OnboardingPath, string> = {
  arnold_plan: "Plan mit Arnold erstellen",
  own_plan: "Eigenen Plan übernehmen",
};

export const PATH_HINT: Record<OnboardingPath, string> = {
  arnold_plan:
    "Du beantwortest ein paar kurze Fragen, Arnold baut dir daraus deinen Plan.",
  own_plan:
    "Du hast schon einen Plan? Schreib ihn in den Chat oder lade ein Foto hoch.",
};

export const GOAL_LABEL: Record<TrainingGoal, string> = {
  muscle_gain: "Muskeln aufbauen",
  strength: "Stärker werden",
  fat_loss: "Abnehmen und straffen",
  general_fitness: "Fit und gesund bleiben",
  endurance_running: "Ausdauer und Laufen",
};

export const GOAL_HINT: Record<TrainingGoal, string> = {
  muscle_gain: "Mehr Muskelmasse, moderate bis höhere Wiederholungen.",
  strength: "Schwerere Grundübungen, niedrigere Wiederholungen.",
  fat_loss: "Muskeln halten und Körperfett reduzieren.",
  general_fitness:
    "Gesund und regelmäßig trainieren, ohne festes Leistungsziel.",
  endurance_running: "Laufen aufbauen: Fitness, 5 km, 10 km oder Halbmarathon.",
};

export const EXPERIENCE_LABEL: Record<ExperienceLevel, string> = {
  beginner: "Anfänger",
  intermediate: "Fortgeschritten",
  advanced: "Erfahren",
};

export const EXPERIENCE_HINT: Record<ExperienceLevel, string> = {
  beginner: "Weniger als ein Jahr regelmäßiges Krafttraining.",
  intermediate: "Ein bis drei Jahre regelmäßiges Krafttraining.",
  advanced: "Mehr als drei Jahre regelmäßiges Krafttraining.",
};

export const ENVIRONMENT_LABEL: Record<TrainingEnvironment, string> = {
  gym: "Fitnessstudio",
  home: "Zuhause",
  outdoor: "Draußen",
  mixed: "Gemischt",
};

export const ENVIRONMENT_HINT: Record<TrainingEnvironment, string> = {
  gym: "Volle Geräteauswahl, Langhanteln und Maschinen.",
  home: "Eigenes Equipment, meist Kurzhanteln oder Körpergewicht.",
  outdoor: "Park oder Calisthenics-Anlage: Stangen, Barren, Körpergewicht.",
  mixed: "Mal Studio, mal zuhause.",
};

export const SEX_LABEL: Record<Sex, string> = {
  female: "Weiblich",
  male: "Männlich",
  diverse: "Divers",
};

export const BODY_AREA_LABEL: Record<BodyArea, string> = {
  shoulder: "Schulter",
  elbow: "Ellbogen",
  wrist: "Handgelenk",
  neck: "Nacken",
  lower_back: "Unterer Rücken",
  hip: "Hüfte",
  knee: "Knie",
};

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

export const SPLIT_LABEL: Record<Split, string> = {
  auto: "Arnold entscheidet",
  full_body: "Ganzkörper",
  upper_lower: "Oberkörper / Unterkörper",
  push_pull_legs: "Push / Pull / Beine",
  body_part: "Muskelgruppen-Split",
};

export const SPLIT_HINT: Record<Split, string> = {
  auto: "Arnold wählt die Aufteilung, die zu deinen Tagen passt.",
  full_body: "Jede Einheit trainiert den ganzen Körper. Ideal für 1–4 Tage.",
  upper_lower: "Abwechselnd Oberkörper und Beine. Ideal für 2, 4 oder 6 Tage.",
  push_pull_legs:
    "Drücken, Ziehen, Beine im Wechsel. Ideal für 3 oder 5–6 Tage.",
  body_part: "Ein bis zwei Muskelgruppen pro Tag. Ab 4 Tagen sinnvoll.",
};

export const STATUS_LABEL: Record<OnboardingStatus, string> = {
  NOT_STARTED: "Noch nicht begonnen",
  COLLECTING_PROFILE: "Angaben werden erfasst",
  PROFILE_READY: "Angaben vollständig",
  WAITING_FOR_PLAN_PROPOSAL: "Plan wird erstellt",
  REVIEWING_PLAN: "Plan wird geprüft",
  PLAN_CONFIRMED: "Plan bestätigt",
  READY_TO_FINISH: "Bereit zum Abschluss",
  COMPLETED: "Einrichtung abgeschlossen",
  CANCELLED: "Einrichtung abgebrochen",
  EXPIRED: "Einrichtung abgelaufen",
};

export const STEP_LABEL: Record<OnboardingStep, string> = {
  welcome: "Willkommen",
  profile: "Person und Training",
  own_plan: "Eigener Plan",
  plan_proposal: "Planvorschlag",
  plan_review: "Plan prüfen",
  confirmation: "Bestätigen",
  finishing: "Abschließen",
  done: "Fertig",
};

export const REQUIRED_FIELD_LABEL: Record<RequiredProfileField, string> = {
  path: "Wie du starten möchtest",
  "training.primary_goal": "Trainingsziel",
  "training.experience": "Trainingserfahrung",
  "training.days_per_week": "Trainingstage",
  "training.session_minutes": "Zeit pro Training",
  "training.environment": "Trainingsort",
  "training.run.runs_per_week": "Läufe pro Woche",
  "training.run.base_minutes_per_week": "Laufminuten pro Woche",
  "training.run.longest_run_4w_min": "Längster Lauf der letzten vier Wochen",
  "training.run.preferred_environment": "Wo du läufst",
  "training.mobility.stiff_areas": "Steife Bereiche",
  "training.mobility.sessions": "Mobility-Einheiten",
  "training.mobility.morning.minutes": "Minuten der Morgenroutine",
  "training.mobility.morning.weekdays": "Tage der Morgenroutine",
  "training.has_mat": "Matte für die Morgenroutine",
};

/** The finding code raised when a required field is still missing. */
export const MISSING_FIELD_CODE: Record<
  RequiredProfileField,
  OnboardingValidationCode
> = {
  path: "MISSING_PATH",
  "training.primary_goal": "MISSING_PRIMARY_GOAL",
  "training.experience": "MISSING_EXPERIENCE",
  "training.days_per_week": "MISSING_DAYS_PER_WEEK",
  "training.session_minutes": "MISSING_SESSION_MINUTES",
  "training.environment": "MISSING_ENVIRONMENT",
  "training.run.runs_per_week": "MISSING_RUN_DETAILS",
  "training.run.base_minutes_per_week": "MISSING_RUN_DETAILS",
  "training.run.longest_run_4w_min": "MISSING_RUN_DETAILS",
  "training.run.preferred_environment": "MISSING_RUN_DETAILS",
  "training.mobility.stiff_areas": "MISSING_MOBILITY_DETAILS",
  "training.mobility.sessions": "MISSING_MOBILITY_DETAILS",
  "training.mobility.morning.minutes": "MISSING_MORNING_ROUTINE",
  "training.mobility.morning.weekdays": "MISSING_MORNING_ROUTINE",
  "training.has_mat": "MISSING_HAS_MAT",
};

/** Which step collects which required field, for "fix it where it broke". */
export const FIELD_STEP: Record<RequiredProfileField, OnboardingStep> = {
  path: "welcome",
  "training.primary_goal": "profile",
  "training.experience": "profile",
  "training.days_per_week": "profile",
  "training.session_minutes": "profile",
  "training.environment": "profile",
  "training.run.runs_per_week": "profile",
  "training.run.base_minutes_per_week": "profile",
  "training.run.longest_run_4w_min": "profile",
  "training.run.preferred_environment": "profile",
  "training.mobility.stiff_areas": "profile",
  "training.mobility.sessions": "profile",
  "training.mobility.morning.minutes": "profile",
  "training.mobility.morning.weekdays": "profile",
  "training.has_mat": "profile",
};
