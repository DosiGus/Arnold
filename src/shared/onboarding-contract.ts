/**
 * The onboarding contract: domain objects, the state vocabulary, the profile
 * schema and the input/output schemas of every onboarding MCP tool.
 *
 * Four rules shape everything here.
 *
 * First, an `onboarding_session_id` is **not** a user account. Before Task 007
 * there is no verified Google identity, so a session is an anonymous, expiring
 * setup conversation. Nothing in this contract may be read as proof of who
 * someone is, and no field of it is allowed to become a `user_id`.
 *
 * Second, the bare session id is not a credential either. Every addressed
 * operation carries an `OnboardingClaim`, and the server stores only a hash of
 * the secret — see `src/server/onboarding/access.ts`. A client that merely
 * guesses an id gets nothing.
 *
 * Third, onboarding owns no training plan logic. A proposal is handed to the
 * Task 005 `TrainingPlanService` and what comes back is referenced by
 * `plan_version_id` and `row_revision`. There is deliberately no plan structure
 * stored in an onboarding session: a second copy would be a second source of
 * truth and could disagree with the editor.
 *
 * Fourth, a confirmation names one plan version *and* one revision. It means
 * "the user released this for setup", never "this is live in a Google file" —
 * the real provisioning is Task 007. `OnboardingHandoff.status` is therefore
 * `ready_for_google_connection` and never `completed`.
 */
import { z } from "zod";
import {
  ArnoldExecutionModeSchema,
  ArnoldIdSchema,
  ArnoldLoadBasisSchema,
  ArnoldUtcTimestampSchema,
} from "./arnold-schema-v1.js";
import {
  PlanValidationResultSchema,
  TrainingPlanVersionSchema,
  TrainingSessionInputSchema,
} from "./plan-contract.js";

export const ONBOARDING_CONTRACT = "arnold.onboarding/1";
export const ONBOARDING_SCHEMA_VERSION = "1.0.0";

const id = ArnoldIdSchema;
const positiveInt = z.number().int().positive();
const nonnegativeInt = z.number().int().nonnegative();

/**
 * Free text the user wrote.
 *
 * Bounded and stored verbatim, but never interpreted: the brief labels it as
 * user data so a model reading it treats it as a preference, not as an
 * instruction to the server. See `docs/ARNOLD-ONBOARDING-CONVERSATION.md`.
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
  "AWAITING_GOOGLE_CONNECTION",
  /** Reachable only through Task 007 provisioning. Never reported by Task 006. */
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
] as const;
export const OnboardingStatusSchema = z.enum(ONBOARDING_STATUSES);
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;

/** The wizard steps. A step is a screen; a status is a server fact. */
export const ONBOARDING_STEPS = [
  "welcome",
  "goal",
  "availability",
  "preferences",
  "summary",
  "plan_proposal",
  "plan_review",
  "confirmation",
  "google_connection",
  "done",
] as const;
export const OnboardingStepSchema = z.enum(ONBOARDING_STEPS);
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

/** Which step a status opens on, so chat and UI never disagree about "where am I". */
export const STEP_FOR_STATUS: Record<OnboardingStatus, OnboardingStep> = {
  NOT_STARTED: "welcome",
  COLLECTING_PROFILE: "goal",
  PROFILE_READY: "summary",
  WAITING_FOR_PLAN_PROPOSAL: "plan_proposal",
  REVIEWING_PLAN: "plan_review",
  PLAN_CONFIRMED: "confirmation",
  AWAITING_GOOGLE_CONNECTION: "google_connection",
  COMPLETED: "done",
  CANCELLED: "welcome",
  EXPIRED: "welcome",
};

/** Steps that collect profile answers, in order. Backwards navigation is allowed. */
export const PROFILE_STEPS = [
  "goal",
  "availability",
  "preferences",
  "summary",
] as const satisfies readonly OnboardingStep[];

export const HANDOFF_STATUSES = [
  /** No confirmed plan yet. */
  "not_ready",
  /** A confirmed plan exists and matches the stored revision. */
  "ready_for_google_connection",
  /** The plan moved on after the confirmation; it must be confirmed again. */
  "superseded",
  /** Task 007 finished provisioning. Never set by Task 006. */
  "completed",
] as const;
export const HandoffStatusSchema = z.enum(HANDOFF_STATUSES);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

/* ------------------------------------------------------------------ profile */

export const TRAINING_GOALS = [
  "muscle_gain",
  "strength",
  "general_fitness",
  "recomposition",
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

export const TRAINING_ENVIRONMENTS = ["gym", "home", "mixed"] as const;
export const TrainingEnvironmentSchema = z.enum(TRAINING_ENVIRONMENTS);
export type TrainingEnvironment = z.infer<typeof TrainingEnvironmentSchema>;

export const STARTING_POINTS = [
  "new_plan",
  "existing_plan",
  "undecided",
] as const;
export const StartingPointSchema = z.enum(STARTING_POINTS);
export type StartingPoint = z.infer<typeof StartingPointSchema>;

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

/**
 * A known starting load.
 *
 * Deliberately not a bare number. A load in Arnold is meaningless without the
 * convention it was measured in — 20 kg "per dumbbell" and 20 kg "on the
 * machine display" are different facts — so a starting weight is only stored
 * when the basis and the execution are stated too. Everything else stays empty
 * rather than becoming an invented prescription.
 */
export const KnownStartingLoadSchema = z.strictObject({
  exercise_id: id,
  load_kg: z.number().positive().max(500),
  load_basis: ArnoldLoadBasisSchema,
  execution_mode: ArnoldExecutionModeSchema,
  implement_count: positiveInt.max(10).optional(),
  reps: positiveInt.max(100).optional(),
});
export type KnownStartingLoad = z.infer<typeof KnownStartingLoadSchema>;

/**
 * One training day of a routine the user already follows.
 *
 * An existing routine is rarely complete, so only the day's name is required.
 * Everything unstated stays unstated — that is what the editor then surfaces as
 * an open point rather than filling in.
 */
export const ExistingRoutineDaySchema = z.strictObject({
  session_name: label,
  exercises: z
    .array(
      z.strictObject({
        /** What the user called it. Resolved against the catalog later, never guessed here. */
        name: label,
        exercise_id: id.optional(),
        target_sets: positiveInt.max(20).optional(),
        rep_min: positiveInt.max(100).optional(),
        rep_max: positiveInt.max(100).optional(),
        notes: freeText.optional(),
      }),
    )
    .max(40)
    .optional(),
});
export type ExistingRoutineDay = z.infer<typeof ExistingRoutineDaySchema>;

/** Optional answers. Every one of them may be absent. */
export const TrainingPreferencesSchema = z.strictObject({
  /** Secondary goals. The primary goal stays unambiguous in `primary_goal`. */
  secondary_goals: z.array(TrainingGoalSchema).max(3).optional(),
  preferred_split: label.optional(),
  preferred_exercises: z.array(label).max(40).optional(),
  avoided_exercises: z.array(label).max(40).optional(),
  available_equipment: z.array(label).max(60).optional(),
  existing_routine: z.array(ExistingRoutineDaySchema).max(14).optional(),
  known_starting_loads: z.array(KnownStartingLoadSchema).max(60).optional(),
  /** Verbatim user text. Data, never an instruction. */
  notes: freeText.optional(),
});
export type TrainingPreferences = z.infer<typeof TrainingPreferencesSchema>;

/**
 * The training profile.
 *
 * Every required field is nullable, because a profile exists from the first
 * answer onwards and is completed step by step. Completeness is a computed
 * property (`OnboardingProgress.profile_complete`), never a second stored flag
 * that could drift out of sync with the answers.
 *
 * There is no health or medical field anywhere in here, on purpose: this MVP
 * does not collect diagnoses, injuries or conditions. See §7 of the contract
 * document.
 */
export const OnboardingProfileSchema = z.strictObject({
  primary_goal: TrainingGoalSchema.nullable(),
  experience: ExperienceLevelSchema.nullable(),
  days_per_week: DaysPerWeekSchema.nullable(),
  session_minutes: SessionMinutesSchema.nullable(),
  environment: TrainingEnvironmentSchema.nullable(),
  starting_point: StartingPointSchema.nullable(),
  preferences: TrainingPreferencesSchema,
  /** Bumped by every accepted change, so a stale write is detectable. */
  revision: nonnegativeInt,
  updated_at_utc: ArnoldUtcTimestampSchema.nullable(),
});
export type OnboardingProfile = z.infer<typeof OnboardingProfileSchema>;

/**
 * A proposal's sessions as the onboarding layer inspects them.
 *
 * Structurally the Task 005 `TrainingSessionInput`, but typed loosely on
 * purpose: the onboarding check only asks whether the shape answers the
 * profile, and must not re-declare the plan domain's own input contract.
 */
export type TrainingSessionInputLike = {
  session_name: string;
  exercises?: readonly unknown[];
};

/** The required fields, as the completeness check and the UI both read them. */
export const REQUIRED_PROFILE_FIELDS = [
  "primary_goal",
  "experience",
  "days_per_week",
  "session_minutes",
  "environment",
  "starting_point",
] as const;
export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

/** The patch a caller sends. Absent means "leave unchanged"; null is not accepted. */
export const OnboardingProfilePatchSchema = z
  .strictObject({
    primary_goal: TrainingGoalSchema.optional(),
    experience: ExperienceLevelSchema.optional(),
    days_per_week: DaysPerWeekSchema.optional(),
    session_minutes: SessionMinutesSchema.optional(),
    environment: TrainingEnvironmentSchema.optional(),
    starting_point: StartingPointSchema.optional(),
    preferences: TrainingPreferencesSchema.optional(),
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
  "MISSING_PRIMARY_GOAL",
  "MISSING_EXPERIENCE",
  "MISSING_DAYS_PER_WEEK",
  "MISSING_SESSION_MINUTES",
  "MISSING_ENVIRONMENT",
  "MISSING_STARTING_POINT",
  "IMPLAUSIBLE_SESSION_MINUTES",
  "IMPLAUSIBLE_DAYS_PER_WEEK",
  "INCOMPLETE_STARTING_LOAD",
  "UNKNOWN_EXERCISE_REFERENCE",
  "EXISTING_ROUTINE_INCOMPLETE",
  "EQUIPMENT_ENVIRONMENT_MISMATCH",
  "PROPOSAL_DAYS_MISMATCH",
  "PROPOSAL_NO_SESSION",
  "PROPOSAL_EMPTY_SESSION",
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
  /** Completed profile steps, for the progress indicator. */
  completed_steps: z.array(OnboardingStepSchema),
  /** Of the six required answers. */
  answered_required: nonnegativeInt,
  total_required: positiveInt,
  profile_complete: z.boolean(),
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
  /** A routine the user already follows, structured from their description. */
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
 * What Task 007 receives.
 *
 * Only validated references, no session secret and no personal data: this
 * object travels into an OAuth flow, so everything in it is safe to log.
 * `oauth_state_binding` is the hook for Task 007 to tie a callback to this
 * session — Task 006 publishes the field and deliberately implements no OAuth.
 */
export const OnboardingHandoffSchema = z.strictObject({
  onboarding_session_id: id,
  status: HandoffStatusSchema,
  confirmed_plan_version_id: id.nullable(),
  confirmed_plan_revision: positiveInt.nullable(),
  profile_revision: nonnegativeInt.nullable(),
  confirmation_timestamp: ArnoldUtcTimestampSchema.nullable(),
  /** The draft's revision as of *now*. Differs from the confirmed one when superseded. */
  current_plan_revision: positiveInt.nullable(),
  /**
   * Opaque value Task 007 binds an OAuth `state` to. Null until a confirmed
   * plan exists; never a credential and never sufficient to read a session.
   */
  oauth_state_binding: z.string().min(1).nullable(),
  /** Why the handoff is not ready, when it is not. */
  blocked_reason: z.string().nullable(),
  /** Always true in Task 006: nothing has been written to any Google file. */
  google_connection_pending: z.boolean(),
});
export type OnboardingHandoff = z.infer<typeof OnboardingHandoffSchema>;

/* ------------------------------------------------------------------ session */

/**
 * The server-side onboarding session. The single authority for setup state.
 *
 * `onboarding_session_id` identifies a *setup*, not a person. It is anonymous,
 * it expires, and it is explicitly not a `user_id`: a durable user identity
 * arrives with Task 007.
 */
export const OnboardingSessionSchema = z.strictObject({
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
  /** Which tracker the plan draft lives on. A fixture tracker before Task 007. */
  tracker_id: id,
});
export type OnboardingSession = z.infer<typeof OnboardingSessionSchema>;

/* -------------------------------------------------------------------- brief */

/**
 * The structured input ChatGPT builds a plan from.
 *
 * It is a *brief*, not a prompt: facts the user stated, named constraints, and
 * explicit instructions about what must not be invented. Everything the user
 * wrote freely is grouped under `user_statements` and labelled as data.
 */
export const OnboardingBriefSchema = z.strictObject({
  onboarding_contract: z.literal(ONBOARDING_CONTRACT),
  onboarding_session_id: id,
  profile_revision: nonnegativeInt,
  goal: z.strictObject({
    primary: TrainingGoalSchema,
    primary_label: z.string(),
    secondary: z.array(TrainingGoalSchema),
  }),
  experience: ExperienceLevelSchema,
  experience_label: z.string(),
  availability: z.strictObject({
    days_per_week: DaysPerWeekSchema,
    session_minutes: SessionMinutesSchema,
    /** Rough budget in exercises per session, from the stated minutes. */
    suggested_exercises_per_session: z.strictObject({
      min: positiveInt,
      max: positiveInt,
    }),
  }),
  environment: TrainingEnvironmentSchema,
  environment_label: z.string(),
  starting_point: StartingPointSchema,
  preferences: TrainingPreferencesSchema,
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
  generated_at_utc: ArnoldUtcTimestampSchema,
});
export type OnboardingBrief = z.infer<typeof OnboardingBriefSchema>;

/* -------------------------------------------------------------------- state */

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
  /** fixture while there is no verified identity; production needs Task 007. */
  mode: z.enum(["fixture", "production"]),
  google_connection_available: z.boolean().default(false),
  /** False when this deployment cannot write a plan draft at all. */
  can_write_plan: z.boolean(),
  /**
   * Honest statement of what resumption can and cannot do today. Shown in the
   * UI rather than promising cross-device continuation we cannot deliver.
   */
  resume: z.strictObject({
    /** True when the repository survives a server restart. */
    durable: z.boolean(),
    /** True only once a verified identity can re-bind a session: Task 007. */
    cross_device: z.literal(false),
    note: z.string(),
  }),
  generated_at_utc: ArnoldUtcTimestampSchema,
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

/**
 * The payload that opens the onboarding app.
 *
 * Carries its contract name so the React shell can tell an onboarding payload
 * from a dashboard payload without guessing, exactly as the v1/v2 dashboards
 * already do.
 */
export const OnboardingViewSchema = z.strictObject({
  onboarding_contract: z.literal(ONBOARDING_CONTRACT),
  state: OnboardingStateSchema,
  /** Shown once when a session was resumed rather than created. */
  resumed: z.boolean(),
  /**
   * The secret for the session this payload opened, when it was just created.
   *
   * The app needs it to act on that session at all. Present only on a fresh
   * start, carried in structured content, and never written into a tool's text
   * output — that text becomes chat transcript.
   */
  session_token: z.string().nullable().optional(),
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
  /** Reaching COMPLETED needs provisioning that only Task 007 provides. */
  "OAUTH_NOT_IMPLEMENTED",
  "PLAN_WRITE_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  "DUPLICATE_OPERATION",
] as const;
export const OnboardingErrorCodeSchema = z.enum(ONBOARDING_ERROR_CODES);
export type OnboardingErrorCode = z.infer<typeof OnboardingErrorCodeSchema>;

/* ------------------------------------------------------------------- claims */

/**
 * The credential for an addressed operation.
 *
 * The id says *which* session, the token says *whether you may*. Omitting the
 * token is not a shortcut: access control refuses it, which is what keeps a
 * guessed id worthless. See `src/server/onboarding/access.ts`.
 */
export const OnboardingClaimSchema = z.strictObject({
  onboarding_session_id: id,
  session_token: z.string().min(16).max(256),
});
export type OnboardingClaim = z.infer<typeof OnboardingClaimSchema>;

const claim = OnboardingClaimSchema.shape;
const request = { request_id: z.string().min(1).max(128) };
/** Guards against a write built on a state the caller has not seen. */
const expected = {
  expected_revision: positiveInt.optional(),
};

/* -------------------------------------------------------------- tool inputs */

export const OnboardingToolInputs = {
  show_arnold_onboarding: z.strictObject({
    /** Continue a known session; without it a new one is started. */
    onboarding_session_id: id.optional(),
    session_token: z.string().min(16).max(256).optional(),
  }),
  start_arnold_onboarding: z.strictObject({
    ...request,
    /** Resume this session instead of starting over, when it is still valid. */
    resume_session: OnboardingClaimSchema.optional(),
  }),
  get_onboarding_state: z.strictObject({ ...claim }),
  /**
   * Saves answers, moves to a step, or both.
   *
   * `step` alone is the backward navigation of §6: it changes where the setup
   * is without touching an answer, so returning to an earlier question never
   * costs data. One of `profile` or `step` must be present.
   */
  update_onboarding_profile: z
    .strictObject({
      ...request,
      ...claim,
      ...expected,
      profile: OnboardingProfilePatchSchema.optional(),
      step: OnboardingStepSchema.optional(),
    })
    .refine(
      (input) => input.profile !== undefined || input.step !== undefined,
      "Entweder Angaben oder ein Schritt müssen übergeben werden.",
    ),
  get_onboarding_brief: z.strictObject({ ...claim }),
  request_onboarding_plan: z.strictObject({
    ...request,
    ...claim,
    ...expected,
  }),
  submit_onboarding_plan_proposal: z.strictObject({
    ...request,
    ...claim,
    ...expected,
    name: label,
    origin: PlanProposalOriginSchema,
    split_key: z.string().min(1).max(60).optional(),
    sessions: z.array(TrainingSessionInputSchema).min(1).max(14),
    /** Open points the proposal knowingly leaves unresolved. Shown, not hidden. */
    open_questions: z.array(freeText).max(10).optional(),
  }),
  get_onboarding_plan: z.strictObject({ ...claim }),
  confirm_onboarding_plan: z.strictObject({
    ...request,
    ...claim,
    ...expected,
    /** Must name the version *and* the revision the user actually saw. */
    confirmation: z.strictObject({
      plan_version_id: id,
      row_revision: positiveInt,
      confirmed: z.literal(true),
    }),
  }),
  revise_onboarding_plan: z.strictObject({
    ...request,
    ...claim,
    ...expected,
    reason: freeText.optional(),
  }),
  get_onboarding_handoff: z.strictObject({ ...claim }),
  cancel_onboarding: z.strictObject({
    ...request,
    ...claim,
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
  /**
   * Returned exactly once, by the call that creates the session. Never echoed
   * in tool text and never stored in plaintext on the server.
   */
  session_token: z.string().nullable(),
  error: z
    .strictObject({
      code: OnboardingErrorCodeSchema,
      message: z.string(),
      retryable: z.boolean(),
      details: z.array(z.string()),
    })
    .nullable(),
});
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;

/* ------------------------------------------------------------------- labels */

/** German labels. Enum values are storage keys and are never shown raw. */
export const GOAL_LABEL: Record<TrainingGoal, string> = {
  muscle_gain: "Muskelaufbau",
  strength: "Kraftaufbau",
  general_fitness: "Allgemeine Fitness",
  recomposition: "Körperkomposition",
};

export const GOAL_HINT: Record<TrainingGoal, string> = {
  muscle_gain: "Mehr Muskelmasse, moderate bis höhere Wiederholungen.",
  strength: "Schwerere Grundübungen, niedrigere Wiederholungen.",
  general_fitness:
    "Gesund und regelmäßig trainieren, ohne festes Leistungsziel.",
  recomposition: "Muskeln aufbauen und gleichzeitig Körperfett reduzieren.",
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
  mixed: "Gemischt",
};

export const ENVIRONMENT_HINT: Record<TrainingEnvironment, string> = {
  gym: "Volle Geräteauswahl, Langhanteln und Maschinen.",
  home: "Eigenes Equipment, meist Kurzhanteln oder Körpergewicht.",
  mixed: "Mal Studio, mal zuhause.",
};

export const STARTING_POINT_LABEL: Record<StartingPoint, string> = {
  new_plan: "Neuer Trainingsplan",
  existing_plan: "Ich habe schon einen Plan",
  undecided: "Noch unentschieden",
};

export const STARTING_POINT_HINT: Record<StartingPoint, string> = {
  new_plan: "Arnold schlägt dir einen Plan auf Basis deiner Angaben vor.",
  existing_plan: "Deine bestehende Routine wird übernommen und ergänzt.",
  undecided: "Du kannst dich später entscheiden.",
};

export const STATUS_LABEL: Record<OnboardingStatus, string> = {
  NOT_STARTED: "Noch nicht begonnen",
  COLLECTING_PROFILE: "Angaben werden erfasst",
  PROFILE_READY: "Angaben vollständig",
  WAITING_FOR_PLAN_PROPOSAL: "Warten auf den Planvorschlag",
  REVIEWING_PLAN: "Plan wird geprüft",
  PLAN_CONFIRMED: "Plan bestätigt",
  AWAITING_GOOGLE_CONNECTION: "Warten auf die Google-Verbindung",
  COMPLETED: "Einrichtung abgeschlossen",
  CANCELLED: "Einrichtung abgebrochen",
  EXPIRED: "Einrichtung abgelaufen",
};

export const STEP_LABEL: Record<OnboardingStep, string> = {
  welcome: "Willkommen",
  goal: "Dein Ziel",
  availability: "Dein Trainingsalltag",
  preferences: "Deine Vorlieben",
  summary: "Zusammenfassung",
  plan_proposal: "Planvorschlag",
  plan_review: "Plan prüfen",
  confirmation: "Bestätigen",
  google_connection: "Google verbinden",
  done: "Fertig",
};

export const REQUIRED_FIELD_LABEL: Record<RequiredProfileField, string> = {
  primary_goal: "Trainingsziel",
  experience: "Trainingserfahrung",
  days_per_week: "Trainingstage pro Woche",
  session_minutes: "Zeit pro Training",
  environment: "Trainingsumgebung",
  starting_point: "Ausgangssituation",
};

/** The finding code raised when a required field is still missing. */
export const MISSING_FIELD_CODE: Record<
  RequiredProfileField,
  OnboardingValidationCode
> = {
  primary_goal: "MISSING_PRIMARY_GOAL",
  experience: "MISSING_EXPERIENCE",
  days_per_week: "MISSING_DAYS_PER_WEEK",
  session_minutes: "MISSING_SESSION_MINUTES",
  environment: "MISSING_ENVIRONMENT",
  starting_point: "MISSING_STARTING_POINT",
};

/** Which step collects which required field, for "fix it where it broke". */
export const FIELD_STEP: Record<RequiredProfileField, OnboardingStep> = {
  primary_goal: "goal",
  experience: "goal",
  days_per_week: "availability",
  session_minutes: "availability",
  environment: "availability",
  starting_point: "preferences",
};
