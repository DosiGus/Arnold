/**
 * `OnboardingService` — the one place that changes an onboarding session.
 *
 * Every setup operation in the product goes through here, whether it arrives
 * from a ChatGPT turn or from a click in the wizard. The MCP tools are thin
 * wrappers and the React app holds no onboarding rule of its own, so a rule
 * written here cannot be bypassed by a UI that forgot about it. There is no
 * second, chat-only copy of the profile: §9 of the task forbids it, and the
 * reason is simply that a chat transcript is not a database.
 *
 * The invariants this service is responsible for:
 *
 *   - the setup is found through the verified identity, never through an
 *     argument: no tool takes or returns a setup id or secret (D-11);
 *   - no status moves except through `transitionOnboarding`;
 *   - a write states the revision it was built on, and anything else is
 *     refused rather than overwritten;
 *   - a repeated `request_id` returns the stored outcome instead of acting
 *     twice;
 *   - the training plan is owned by `TrainingPlanService`. This service stores
 *     a reference, never a plan structure, and never activates anything;
 *   - a confirmation binds one plan version *and* one revision, and is void the
 *     moment the draft moves on — including when it is moved by the plan editor
 *     without onboarding being involved;
 *   - `COMPLETED` is reached only through `finishSetup`, which activates
 *     exactly the confirmed plan first;
 *   - where the caller is a verified account (`access.perOwner`), the setup
 *     belongs to that account: one open setup per user, found again in any
 *     new chat, and never started again once it is completed.
 *
 * Onboarding state lives in its own repository, never in the six Arnold tables
 * (`CONFIG.onboarding_storage = BACKEND_ONLY`).
 */
import { recoveryFor } from "../../shared/write-recovery.js";
import type {
  ArnoldDataset,
  ArnoldExercise,
} from "../../shared/arnold-schema-v1.js";
import {
  HANDOFF_STATUSES,
  ONBOARDING_CONTRACT,
  ONBOARDING_SCHEMA_VERSION,
  OnboardingResponseSchema,
  OnboardingErrorCodeSchema,
  OnboardingStateSchema,
  OnboardingToolInputs,
  splitsForDays,
  stepForStatus,
  WEEKDAYS,
  PlanCardInputSchema,
  PlanCardSchema,
  type HandoffStatus,
  type PlanCard,
  type PlanInsights,
  type OnboardingErrorCode,
  type OnboardingHandoff,
  type OnboardingProfile,
  type OnboardingRun,
  type OnboardingResponse,
  type OnboardingState,
  type OnboardingStep,
  type OnboardingToolName,
  type OnboardingValidationResult,
} from "../../shared/onboarding-contract.js";
import type {
  PlanValidationResult,
  TrainingPlanVersion,
} from "../../shared/plan-contract.js";
import type { MobilityPreference } from "../../shared/mobility-contract.js";
import type { TrainingPlanService } from "../plan/service.js";
import {
  uuid7,
  type AuditEvent,
  type AuditLogRepository,
} from "../workout/infrastructure.js";
import {
  OnboardingAccessError,
  createSessionToken,
  fingerprintToken,
  type OnboardingAccessControl,
  type OnboardingPrincipal,
} from "./access.js";
import {
  mergeProfile,
  buildBrief,
  buildProgress,
  exerciseChoices,
  isProfileComplete,
  firstOpenStep,
  validateProfile,
  proposalFitIssues,
  validateProposalAgainstProfile,
  runSetupState,
  wantsRunning,
  openQuestions,
} from "./profile.js";
import {
  RepositoryConflictError,
  isExpired,
  type OnboardingRecord,
  type OnboardingStateRepository,
} from "./repository.js";
import {
  allowedEvents,
  transitionOnboarding,
  type OnboardingEvent,
  type OnboardingMachineState,
  type TransitionEffect,
} from "./state-machine.js";
import { loadEstimates, withStartLoads } from "./start-loads.js";
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABEL,
} from "../../shared/exercise-starter-catalog.js";
import {
  checkPlanQuality,
  type PlanQualityResult,
} from "../../analytics/plan-quality.js";
import { buildPlanInsights } from "../../analytics/plan-insights.js";

export class OnboardingError extends Error {
  constructor(
    readonly code: OnboardingErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

const fail = (
  code: OnboardingErrorCode,
  message: string,
  details: string[] = [],
) => new OnboardingError(code, message, false, details);

export interface OnboardingServiceOptions {
  setupFinishAvailable?: boolean;
  repository: OnboardingStateRepository;
  access: OnboardingAccessControl;
  /** Task 005. Absent means this deployment cannot hold a plan draft. */
  plans?: TrainingPlanService;
  /** Read path for the exercise catalog. Never written by this service. */
  read: () => Promise<ArnoldDataset>;
  /** The tracker a plan draft is created on. A fixture tracker before Task 007. */
  trackerId: string;
  /** Task 004 audit log, reused rather than duplicated. */
  audit?: AuditLogRepository;
  /** Session lifetime. Default 24 hours. */
  sessionTtlMs?: number;
  /**
   * An external "this account is set up" check, where a deployment has one.
   * Without it, a completed onboarding session is the evidence.
   */
  setupComplete?: () => Promise<boolean>;
  /**
   * Stores the body weight from the Person card as the first measurement
   * once the setup is finished, through the workout service's own write path.
   * Absent where a deployment keeps no training data.
   */
  recordStartWeight?: (
    weightKg: number,
    requestId: string,
    context: unknown,
  ) => Promise<void>;
  /**
   * Hands the run details of a running goal to the run service once the
   * setup is finished (the run profile cannot be written before). Throws when
   * the run service refused. Absent where a deployment keeps no run data.
   */
  recordRunProfile?: (
    run: OnboardingRun,
    sessionId: string,
    context: unknown,
  ) => Promise<void>;
  /**
   * Hands the mobility answer to the mobility service once the setup is
   * finished and the plan is active. Called whenever the profile holds a
   * mobility answer, a "no" included, so the question is never asked again.
   * Throws when the mobility service refused. Absent where a deployment keeps
   * no mobility data.
   */
  recordMobilityProfile?: (
    preference: MobilityPreference,
    onboardingSessionId: string,
    context: unknown,
    /** The mat answer of the setup (D-07); absent when not given. */
    hasMat?: boolean,
  ) => Promise<void>;
  clock?: () => Date;
  id?: () => string;
}

/** Default setup lifetime: long enough to finish, short enough not to linger. */
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** How many request ids a session remembers, so the map cannot grow forever. */
const APPLIED_LIMIT = 64;

const emptyProfile = (): OnboardingProfile => ({
  path: null,
  person: {},
  training: {
    primary_goal: null,
    experience: null,
    days_per_week: null,
    session_minutes: null,
    environment: null,
  },
  revision: 0,
  updated_at_utc: null,
});

export { mergeProfile } from "../../shared/onboarding-profile.js";

/**
 * The stored session as tools see it (D-11, D-20): no setup id, no tracker id
 * and no timestamps. The setup is addressed through the identity alone.
 */
function publicSession(
  session: OnboardingRecord["session"],
): OnboardingState["session"] {
  const {
    onboarding_session_id: _id,
    created_at_utc: _created,
    updated_at_utc: _updated,
    expires_at_utc: _expires,
    tracker_id: _tracker,
    plan_draft_reference: draft,
    confirmed_plan_reference: confirmed,
    last_error: lastError,
    ...rest
  } = session;
  const { proposed_at_utc: _proposed, ...draftRef } = draft ?? {
    proposed_at_utc: "",
  };
  const { confirmed_at_utc: _confirmed, ...confirmedRef } = confirmed ?? {
    confirmed_at_utc: "",
  };
  return {
    ...rest,
    profile: { ...rest.profile, updated_at_utc: null },
    plan_draft_reference: draft
      ? (draftRef as NonNullable<
          OnboardingState["session"]["plan_draft_reference"]
        >)
      : null,
    confirmed_plan_reference: confirmed
      ? (confirmedRef as NonNullable<
          OnboardingState["session"]["confirmed_plan_reference"]
        >)
      : null,
    last_error: lastError
      ? { code: lastError.code, message: lastError.message }
      : null,
  };
}

export class OnboardingService {
  readonly mode: "fixture" | "production";

  constructor(private options: OnboardingServiceOptions) {
    this.mode = options.access.mode;
    // RDS-017: until the setup is finished the mobility profile is not stored,
    // so the plan service asks the open setup for the mat answer (D-07).
    options.plans?.useSetupMat((context) => this.openSetupHasMat(context));
  }

  /**
   * The mat answer of the caller's open setup, for the plan service. The
   * setup is found through the verified identity in `context` and the access
   * check, never through tool arguments. A finished, cancelled or expired
   * setup, a missing answer or any failure gives `undefined` (unknown).
   */
  async openSetupHasMat(context: unknown): Promise<boolean | undefined> {
    try {
      const principal = await this.options.access.establish(context);
      const record = await this.options.repository.findLatestByOwner(
        principal.subject,
      );
      if (!record) return undefined;
      await this.options.access.authorize(record, context);
      const { session } = record;
      if (
        session.status === "COMPLETED" ||
        session.status === "CANCELLED" ||
        session.status === "EXPIRED" ||
        isExpired(session, this.clock())
      )
        return undefined;
      const answer = session.profile.training.has_mat;
      return typeof answer === "boolean" ? answer : undefined;
    } catch {
      return undefined;
    }
  }

  private now() {
    return (this.options.clock?.() ?? new Date()).toISOString();
  }
  private clock() {
    return this.options.clock?.() ?? new Date();
  }
  private newId(): string {
    return this.options.id?.() ?? uuid7();
  }

  private async catalog(): Promise<readonly ArnoldExercise[]> {
    try {
      return (await this.options.read()).exercises;
    } catch {
      // A catalog that cannot be read must not break a profile answer. It only
      // limits what a proposal can reference, which validation then reports.
      return [];
    }
  }

  /* ------------------------------------------------------------ foundations */

  /**
   * Finds the caller's setup through the verified identity and authorizes it.
   *
   * There is no setup id in any input (D-11): the principal comes from the
   * token, the setup is that principal's latest one, and the stored owner is
   * checked against the principal once more. It fails closed with a code:
   * no setup (`SESSION_NOT_FOUND`), a cancelled one (`SESSION_CANCELLED`) or
   * an expired one (`SESSION_EXPIRED`). It never starts a new setup; only
   * `show_arnold_onboarding` and `start_arnold_onboarding` do that.
   *
   * A completed setup opens (read-only by the state machine). A write whose
   * `request_id` this setup already applied opens even after it ended, so a
   * repeated request replays its stored outcome instead of failing.
   */
  private async open(
    context: unknown,
    requestId?: string,
  ): Promise<{ record: OnboardingRecord; principal: OnboardingPrincipal }> {
    const principal = await this.establish(context);
    const record = await this.options.repository.findLatestByOwner(
      principal.subject,
    );
    if (!record)
      throw fail(
        "SESSION_NOT_FOUND",
        "Es gibt keine offene Einrichtung. Öffne sie mit show_arnold_onboarding.",
      );
    try {
      await this.options.access.authorize(record, context);
    } catch (error) {
      if (error instanceof OnboardingAccessError)
        throw fail(error.code, error.message);
      throw fail("PERMISSION_DENIED", "Zugriff verweigert.");
    }
    if (requestId !== undefined && this.replay(record, requestId))
      return { record, principal };
    if (record.session.status === "CANCELLED")
      throw fail(
        "SESSION_CANCELLED",
        "Die Einrichtung wurde abgebrochen. Öffne eine neue mit show_arnold_onboarding.",
      );
    if (
      record.session.status === "EXPIRED" ||
      (record.session.status !== "COMPLETED" &&
        isExpired(record.session, this.clock()))
    )
      throw fail(
        "SESSION_EXPIRED",
        "Die Einrichtung ist abgelaufen. Öffne eine neue mit show_arnold_onboarding.",
      );
    return { record, principal };
  }

  /** The machine's view of a stored record. */
  private machineState(record: OnboardingRecord): OnboardingMachineState {
    return {
      status: record.session.status,
      step: record.session.current_step,
      path: record.session.profile.path,
      profile_complete: isProfileComplete(record.session.profile),
      has_plan_draft: record.session.plan_draft_reference !== null,
      has_confirmation: record.session.confirmed_plan_reference !== null,
      expired:
        record.session.status !== "COMPLETED" &&
        isExpired(record.session, this.clock()),
    };
  }

  /** One audit event, or none where this deployment keeps no audit log. */
  private auditEvent(
    event_type: AuditEvent["event_type"],
    record: OnboardingRecord,
    operationId: string,
    principal: OnboardingPrincipal,
    detail: {
      previous: number | null;
      next: number;
      fields?: Record<string, { before: unknown; after: unknown }>;
      reason?: string | null;
    },
  ): AuditEvent[] {
    if (!this.options.audit) return [];
    const fields = detail.fields ?? {
      revision: { before: detail.previous, after: detail.next },
    };
    return [
      {
        operation_id: operationId,
        event_type,
        // The onboarding session, never a person: there is no user identity to
        // record before Task 007, and none is invented here.
        entity_id: record.session.onboarding_session_id,
        at: this.now(),
        actor: principal.subject,
        previous_revision: detail.previous,
        new_revision: detail.next,
        result: "verified",
        changed_fields: Object.keys(fields),
        correction_reason: detail.reason ?? null,
        changes: fields,
      },
    ];
  }

  /**
   * Writes the audit events the repository did not already store together
   * with the session.
   */
  private async appendAudit(events: readonly AuditEvent[]) {
    if (events.length && !this.options.repository.auditInTransaction)
      await this.options.audit?.append(events);
  }

  /**
   * Applies the machine's effects to a record.
   *
   * Pure bookkeeping: the machine decides *that* a confirmation is void, this
   * decides what the stored record then looks like.
   */
  private applyEffects(
    record: OnboardingRecord,
    effects: readonly TransitionEffect[],
  ): { record: OnboardingRecord; invalidated: boolean } {
    let session = record.session;
    // "Invalidated" means a standing release stopped standing, whether the
    // record was dropped or merely superseded. Both are audited.
    let invalidated =
      effects.includes("handoff_superseded") &&
      session.confirmed_plan_reference !== null;
    for (const effect of effects) {
      if (effect === "clear_confirmation") {
        invalidated ||= session.confirmed_plan_reference !== null;
        session = { ...session, confirmed_plan_reference: null };
      }
      if (effect === "clear_plan_draft")
        session = { ...session, plan_draft_reference: null };
      if (effect === "handoff_ready")
        session = { ...session, handoff_status: "ready_to_finish" };
      if (effect === "handoff_not_ready")
        session = { ...session, handoff_status: "not_ready" };
      if (effect === "handoff_superseded")
        session = { ...session, handoff_status: "superseded" };
    }
    return { record: { ...record, session }, invalidated };
  }

  /**
   * Runs one event through the machine and writes the result.
   *
   * Every status change in the service funnels through this, which is why a new
   * operation cannot forget the revision check, the effects or the audit event.
   */
  private async commit(
    record: OnboardingRecord,
    event: OnboardingEvent,
    options: {
      principal: OnboardingPrincipal;
      operationId: string;
      auditEvent: AuditEvent["event_type"];
      /** Applied after the transition, before the write. */
      mutate?: (session: OnboardingRecord) => OnboardingRecord;
      step?: OnboardingStep;
      fields?: Record<string, { before: unknown; after: unknown }>;
      reason?: string | null;
    },
  ): Promise<OnboardingRecord> {
    const transition = transitionOnboarding(this.machineState(record), event);
    if (!transition.ok)
      throw fail(transition.error.code, transition.error.message);

    const previousRevision = record.session.revision;
    const applied = this.applyEffects(record, transition.effects);
    const invalidated = applied.invalidated;
    let next = applied.record;
    next = {
      ...next,
      session: {
        ...next.session,
        status: transition.state.status,
        current_step: options.step ?? transition.state.step,
        updated_at_utc: this.now(),
        revision: previousRevision + 1,
        last_error: null,
      },
    };
    if (options.mutate) next = options.mutate(next);
    next = {
      ...next,
      applied: {
        ...this.trimApplied(next.applied),
        [options.operationId]: next.session.revision,
      },
    };

    const events = [
      ...this.auditEvent(
        options.auditEvent,
        next,
        options.operationId,
        options.principal,
        {
          previous: previousRevision,
          next: next.session.revision,
          fields: options.fields,
          reason: options.reason ?? null,
        },
      ),
      // A voided confirmation is its own audited fact: it is the trace that
      // shows an approved revision stopped being approved, and when.
      ...(invalidated
        ? this.auditEvent(
            "ONBOARDING_CONFIRMATION_INVALIDATED",
            next,
            options.operationId,
            options.principal,
            {
              previous: previousRevision,
              next: next.session.revision,
              fields: {
                confirmed_plan_reference: {
                  before:
                    record.session.confirmed_plan_reference?.row_revision ??
                    null,
                  after: null,
                },
              },
            },
          )
        : []),
    ];
    // Where the backend can, session and audit are one transaction: an
    // interruption leaves both or neither, never a half-stored step.
    const stored = await this.options.repository.updateSession(
      next,
      previousRevision,
      events,
    );
    await this.appendAudit(events);
    return stored;
  }

  /** Keeps the newest request ids only, so an old session cannot grow unbounded. */
  private trimApplied(applied: Record<string, number>): Record<string, number> {
    const entries = Object.entries(applied);
    if (entries.length < APPLIED_LIMIT) return applied;
    return Object.fromEntries(
      entries.sort(([, a], [, b]) => a - b).slice(-(APPLIED_LIMIT - 1)),
    );
  }

  /* ------------------------------------------------------------- projection */

  /** The draft or confirmed version this session points at, as the plan service sees it. */
  private async referencedPlan(record: OnboardingRecord): Promise<{
    plan: TrainingPlanVersion | null;
    validation: PlanValidationResult | null;
  }> {
    // A superseded confirmation is retained as history. During setup it must
    // never hide a newer proposal (which may have the same row revision).
    const reference =
      record.session.status === "COMPLETED"
        ? (record.session.confirmed_plan_reference ??
          record.session.plan_draft_reference)
        : (record.session.plan_draft_reference ??
          record.session.confirmed_plan_reference);
    if (!reference || !this.options.plans)
      return { plan: null, validation: null };
    try {
      return await this.options.plans.getPlan({
        plan_version_id: reference.plan_version_id,
      });
    } catch {
      // A draft that disappeared is reported as absent rather than as an
      // exception: the handoff check below turns that into a clear refusal.
      return { plan: null, validation: null };
    }
  }

  /**
   * The handoff, recomputed from the current draft on every read.
   *
   * This is the defensive half of "a change voids the confirmation". The plan
   * editor can legitimately change a draft through the plan tools without the
   * onboarding service seeing the event, so the stored confirmation is checked
   * against the draft's revision *as it is now*. A drifted revision is reported
   * as `superseded`, never silently handed to Task 007.
   */
  private handoffFor(
    record: OnboardingRecord,
    plan: TrainingPlanVersion | null,
  ): OnboardingHandoff {
    const confirmation = record.session.confirmed_plan_reference;
    const base = {
      confirmed_plan_version_id: confirmation?.plan_version_id ?? null,
      confirmed_plan_revision: confirmation?.row_revision ?? null,
      profile_revision: confirmation?.profile_revision ?? null,
      current_plan_revision: plan?.row_revision ?? null,
      finish_pending: record.session.status !== "COMPLETED",
    };
    if (record.session.status === "COMPLETED")
      return {
        ...base,
        status: "completed",
        blocked_reason: null,
      };
    if (!confirmation)
      return {
        ...base,
        status: "not_ready",
        blocked_reason:
          "Es liegt noch keine Bestätigung eines Trainingsplans vor.",
      };
    if (!plan)
      return {
        ...base,
        status: "superseded",
        blocked_reason:
          "Der bestätigte Planentwurf ist nicht mehr abrufbar. Bitte einen neuen Plan erstellen und bestätigen.",
      };
    if (plan.plan_version_id !== confirmation.plan_version_id)
      return {
        ...base,
        status: "superseded",
        blocked_reason:
          "Es liegt ein neuer Planvorschlag vor. Bitte prüfe und bestätige diese Planversion.",
      };
    if (plan.row_revision !== confirmation.row_revision)
      return {
        ...base,
        status: "superseded",
        blocked_reason: `Der Plan wurde nach der Bestätigung geändert (bestätigt: Revision ${confirmation.row_revision}, aktuell: Revision ${plan.row_revision}). Bitte erneut prüfen und bestätigen.`,
      };
    // The plan was released *for a given profile*. Changed answers mean the
    // release no longer describes what the user asked for, even though no row
    // of the plan moved — so the confirmation lapses just the same.
    if (record.session.profile.revision !== confirmation.profile_revision)
      return {
        ...base,
        status: "superseded",
        blocked_reason:
          "Du hast deine Angaben nach der Bestätigung geändert. Bitte sieh dir den Plan noch einmal an und bestätige ihn erneut.",
      };
    if (
      record.session.status !== "PLAN_CONFIRMED" &&
      record.session.status !== "READY_TO_FINISH"
    )
      return {
        ...base,
        status: "not_ready",
        blocked_reason: "Die Einrichtung ist nicht im Übergabezustand.",
      };
    return {
      ...base,
      status: "ready_to_finish",
      blocked_reason: null,
    };
  }

  /** Whether the run details the running module needs have been answered. */
  private runSetup(profile: OnboardingProfile) {
    return runSetupState(profile.training);
  }

  private assertRunReady(profile: OnboardingProfile) {
    if (this.runSetup(profile).ready) return;
    throw fail(
      "PROFILE_INCOMPLETE",
      "Fürs Laufen fehlen noch die Laufangaben (Läufe und Minuten pro Woche, längster Lauf, Umfeld; ein Ziel ist freiwillig). Der Nutzer trägt sie in der Einrichtung beim Schritt Laufangaben ein.",
      ["run_profile: Laufangaben fehlen"],
    );
  }

  /** One onboarding state, as every caller sees it. */
  private async project(record: OnboardingRecord): Promise<OnboardingState> {
    const expired =
      record.session.status !== "COMPLETED" &&
      isExpired(record.session, this.clock());
    const { plan, validation } = await this.referencedPlan(record);
    const handoff = this.handoffFor(record, plan);
    const machine = this.machineState(record);
    const session = expired
      ? { ...record.session, status: "EXPIRED" as const }
      : record.session;
    const complete = isProfileComplete(session.profile);
    const runSetup = this.runSetup(session.profile);
    // Questions are moot once the setup has ended.
    const ended =
      session.status === "COMPLETED" ||
      session.status === "CANCELLED" ||
      session.status === "EXPIRED";
    return OnboardingStateSchema.parse({
      onboarding_contract: ONBOARDING_CONTRACT,
      session: {
        ...publicSession(session),
        // The stored handoff status is a cache; the recomputed one is the truth,
        // so a drifted draft is visible even before the next write.
        handoff_status: handoff.status,
      },
      progress: buildProgress(session.profile, {
        step: session.current_step,
        can_request_plan:
          complete &&
          runSetup.ready &&
          !expired &&
          allowedEvents(machine).includes("REQUEST_PLAN"),
        can_confirm_plan:
          !expired &&
          allowedEvents(machine).includes("CONFIRM_PLAN") &&
          (validation?.valid ?? false),
      }),
      validation: withProposalHints(
        validateProfile(session.profile),
        session.profile,
        plan,
        plan ? await this.catalog() : [],
      ),
      plan,
      plan_validation: validation,
      handoff,
      allowed_events: expired ? ["CANCEL"] : allowedEvents(machine),
      exercise_choices: exerciseChoices(session.profile),
      load_estimates: plan
        ? loadEstimates(plan, session.profile, await this.catalog())
        : [],
      split_options: splitsForDays(session.profile.training.days_per_week),
      run_setup: runSetup,
      open_questions: ended ? [] : openQuestions(session.profile, runSetup),
      plan_insights: plan
        ? planInsights(plan, session.profile, await this.catalog())
        : null,
      mode: this.mode,
      setup_finish_available: this.options.setupFinishAvailable ?? false,
      can_write_plan: Boolean(this.options.plans),
      resume: {
        durable: this.options.repository.durability !== "memory",
        cross_device: this.options.access.perOwner,
        note: this.options.access.perOwner
          ? "Deine Einrichtung ist mit deinem Konto gespeichert. Du kannst in jedem neuen Chat genau hier weitermachen."
          : this.options.repository.durability === "memory"
            ? "Dieser Einrichtungsstand gilt für die laufende Serversitzung."
            : "Dieser Einrichtungsstand bleibt auf diesem Server erhalten und kann mit demselben Sitzungsnachweis fortgesetzt werden.",
      },
    });
  }

  /* ------------------------------------------------------------- operations */

  /**
   * Starts a setup, or continues one.
   *
   * Resuming is tried first and deliberately falls back to a fresh session when
   * the old one is gone or expired: "Ich möchte Arnold einrichten" must never
   * end in an error because a previous attempt timed out.
   *
   * Behind a login the setup belongs to the account. An open setup is resumed
   * even without its secret (a new chat has none) and handed a fresh one; a
   * completed setup is refused with `ONBOARDING_ALREADY_COMPLETED`, because the
   * onboarding runs exactly once per user.
   */
  async startOnboarding(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run(
      "start_arnold_onboarding",
      raw,
      context,
      async (input) => {
        const begun = await this.begin(input, context);
        return { state: begun.state };
      },
      () => this.assertNotCompleted(context),
    );
  }

  private async begin(
    input: { request_id: string },
    context: unknown,
  ): Promise<{
    state: OnboardingState;
    resumed: boolean;
  }> {
    const principal = await this.establish(context);
    const latest = await this.options.repository.findLatestByOwner(
      principal.subject,
    );
    if (
      this.options.access.perOwner &&
      (latest?.session.status === "COMPLETED" || (await this.accountSetUp()))
    )
      throw this.alreadyDone();
    // One open setup per identity: it is continued, never doubled.
    if (
      latest &&
      latest.session.status !== "COMPLETED" &&
      this.resumable(latest)
    ) {
      const stored = await this.commit(
        latest,
        { type: "START" },
        {
          principal,
          operationId: input.request_id,
          auditEvent: "ONBOARDING_RESUMED",
        },
      );
      return { state: await this.project(stored), resumed: true };
    }

    // The column predates D-11: a random secret's hash, never handed out.
    const token = createSessionToken();
    const now = this.now();
    const profile = emptyProfile();
    const record: OnboardingRecord = {
      session: {
        onboarding_session_id: `onb-${this.newId()}`,
        status: "COLLECTING_PROFILE",
        current_step: stepForStatus("COLLECTING_PROFILE", profile.path),
        schema_version: ONBOARDING_SCHEMA_VERSION,
        created_at_utc: now,
        updated_at_utc: now,
        expires_at_utc: new Date(
          this.clock().getTime() +
            (this.options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS),
        ).toISOString(),
        // Revisions keep rising across the setups of one identity, so a card
        // never mistakes a new setup for an older state of the previous one.
        revision: (latest?.session.revision ?? 0) + 1,
        profile,
        plan_draft_reference: null,
        confirmed_plan_reference: null,
        handoff_status: "not_ready",
        last_error: null,
        tracker_id: this.options.trackerId,
      },
      token_fingerprint: fingerprintToken(token),
      owner_subject: principal.subject,
      applied: { [input.request_id]: (latest?.session.revision ?? 0) + 1 },
    };
    // Old sessions are collected on the way in rather than by a background
    // job, so an abandoned setup cannot pile up unnoticed.
    await this.options.repository.purge(this.clock()).catch(() => 0);
    const events = this.auditEvent(
      "ONBOARDING_STARTED",
      record,
      input.request_id,
      principal,
      { previous: null, next: record.session.revision },
    );
    const stored = await this.options.repository.createSession(record, events);
    await this.appendAudit(events);
    return { state: await this.project(stored), resumed: false };
  }

  private resumable(record: OnboardingRecord) {
    return (
      !isExpired(record.session, this.clock()) &&
      record.session.status !== "CANCELLED" &&
      record.session.status !== "EXPIRED"
    );
  }

  /** Refuses with ONBOARDING_ALREADY_COMPLETED when the account is set up. */
  private async assertNotCompleted(context?: unknown) {
    if (!this.options.access.perOwner) return;
    const principal = await this.establish(context);
    const latest = await this.options.repository.findLatestByOwner(
      principal.subject,
    );
    if (latest?.session.status === "COMPLETED" || (await this.accountSetUp()))
      throw this.alreadyDone();
  }

  /**
   * Whether the account itself is set up, independent of a stored session.
   * The completed session is deleted after the retention period (B15); the
   * setup must still run only once.
   */
  private async accountSetUp(): Promise<boolean> {
    return this.options.setupComplete
      ? await this.options.setupComplete()
      : false;
  }

  private alreadyDone() {
    return fail(
      "ONBOARDING_ALREADY_COMPLETED",
      "Arnold ist für dieses Konto bereits eingerichtet. Die Einrichtung läuft nur einmal; Trainingsplan und Übungen lassen sich jederzeit im Chat ändern.",
    );
  }

  /**
   * What "open Arnold's setup" shows for this caller.
   *
   * The account's open setup, or a new one, with the secret the app needs.
   * A completed setup is shown as completed — read-only, no secret — so the
   * app can send the user on to the dashboard instead of starting over.
   */
  async openOnboarding(context?: unknown): Promise<{
    state: OnboardingState;
    resumed: boolean;
  }> {
    const principal = await this.establish(context);
    const latest = await this.options.repository.findLatestByOwner(
      principal.subject,
    );
    if (this.options.access.perOwner) {
      if (latest?.session.status === "COMPLETED")
        return { state: await this.project(latest), resumed: true };
      // Set up, but the completed session was already deleted (B15).
      if (await this.accountSetUp()) throw this.alreadyDone();
    }
    // Opening is a read: a card opened earlier, in this chat or another,
    // shows the same setup.
    if (
      latest &&
      latest.session.status !== "COMPLETED" &&
      this.resumable(latest)
    )
      return { state: await this.project(latest), resumed: true };
    try {
      return await this.begin({ request_id: `show-${this.newId()}` }, context);
    } catch (error) {
      throw this.normalize(error);
    }
  }

  /**
   * Whether this caller still has to go through the onboarding before the
   * tracker opens. Only a verified account can be "not set up yet"; anonymous
   * and fixture deployments have their data already and answer false.
   *
   * Fails closed: if the account cannot be established, the answer is "set up
   * first", never a tracker for an unknown caller.
   */
  async setupRequired(context?: unknown): Promise<boolean> {
    if (!this.options.access.perOwner) return false;
    try {
      if (this.options.setupComplete)
        return !(await this.options.setupComplete());
      const principal = await this.establish(context);
      const latest = await this.options.repository.findLatestByOwner(
        principal.subject,
      );
      return latest?.session.status !== "COMPLETED";
    } catch {
      return true;
    }
  }

  private async establish(context: unknown): Promise<OnboardingPrincipal> {
    try {
      return await this.options.access.establish(context);
    } catch (error) {
      if (error instanceof OnboardingAccessError)
        throw fail(error.code, error.message);
      throw fail("AUTH_REQUIRED", "Einrichtung ist nicht autorisiert.");
    }
  }

  /** The current state. A read: it never moves a status. */
  /**
   * The plan card after the setup (app only): the active plan, or the newest
   * draft, with Arnold's figures and the saved answers it was built from.
   * Without a stored setup the figures carry no range (experience unknown).
   */
  async planCard(raw: unknown, context?: unknown): Promise<PlanCard> {
    PlanCardInputSchema.parse(raw);
    const principal = await this.establish(context);
    const record = await this.options.repository.findLatestByOwner(
      principal.subject,
    );
    if (record)
      try {
        await this.options.access.authorize(record, context);
      } catch (error) {
        if (error instanceof OnboardingAccessError)
          throw fail(error.code, error.message);
        throw fail("PERMISSION_DENIED", "Zugriff verweigert.");
      }
    const profile = record?.session.profile ?? null;
    const empty = {
      plan: null,
      plan_insights: null,
      load_estimates: [],
      profile,
    };
    if (!this.options.plans) return PlanCardSchema.parse(empty);
    let plan: TrainingPlanVersion;
    try {
      plan = (await this.options.plans.getPlan({})).plan;
    } catch {
      // No plan yet is an answer the card shows, not an error.
      return PlanCardSchema.parse(empty);
    }
    const catalog = await this.catalog();
    return PlanCardSchema.parse({
      plan,
      plan_insights: planInsights(plan, profile, catalog),
      load_estimates: profile ? loadEstimates(plan, profile, catalog) : [],
      profile,
    });
  }

  async getOnboardingState(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingState> {
    OnboardingToolInputs.get_onboarding_state.parse(raw);
    const { record } = await this.open(context);
    return this.project(record);
  }

  /** Alias for a resumed read, so chat and UI use one spelling. */
  resumeOnboarding(raw: unknown, context?: unknown) {
    return this.getOnboardingState(raw, context);
  }

  /**
   * Saves answers, moves between steps, or both.
   *
   * A patch merges: an absent key leaves its answer alone, which is what makes
   * "eigentlich lieber nur dreimal" a one-field update from chat rather than a
   * re-submission of the whole profile.
   */
  async updateProfile(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run(
      "update_onboarding_profile",
      raw,
      context,
      async (input) => {
        const { record, principal } = await this.open(
          context,
          input.request_id,
        );
        // A lost acknowledgement must replay the original operation even though
        // that operation has already advanced the revision.
        if (this.replay(record, input.request_id))
          return {
            state: await this.project(record),
            replayed: true,
          };
        this.assertRevision(record, input.expected_revision);

        const before = record.session.profile;
        const patch = input.profile;
        const profile: OnboardingProfile = patch
          ? {
              ...mergeProfile(before, patch),
              revision: before.revision + 1,
              updated_at_utc: this.now(),
            }
          : before;

        // Only field names and enum or numeric training answers reach the audit
        // trail. Person data and free text are personal and are recorded as
        // "changed", never quoted into a log line.
        const fields: Record<string, { before: unknown; after: unknown }> = {};
        if (patch?.path !== undefined)
          fields.path = { before: before.path, after: profile.path };
        for (const key of Object.keys(patch?.person ?? {}))
          fields[`person.${key}`] = { before: "…", after: "…" };
        for (const key of Object.keys(
          patch?.training ?? {},
        ) as (keyof typeof profile.training)[])
          fields[`training.${key}`] =
            key === "notes"
              ? { before: "…", after: "…" }
              : {
                  before: before.training[key] ?? null,
                  after: profile.training[key] ?? null,
                };
        if (input.step && !patch)
          fields.current_step = {
            before: record.session.current_step,
            after: input.step,
          };

        const complete = isProfileComplete(profile);
        // A step-only call is navigation; the machine decides whether moving back
        // is allowed from here. A patch is a save, which may complete the profile
        // and, by choosing a path, decides the next screen.
        const event: OnboardingEvent = patch
          ? {
              type: "SAVE_PROFILE",
              profile_complete: complete,
              path: profile.path,
            }
          : { type: "GO_BACK", step: input.step! };

        const stored = await this.commit(record, event, {
          principal,
          operationId: input.request_id,
          auditEvent: "ONBOARDING_PROFILE_UPDATED",
          // A save without a step moves the recorded position to the first
          // question still open; an explicit step (the wizard's) wins.
          step:
            input.step ??
            (patch && !complete ? firstOpenStep(profile) : undefined),
          fields,
          mutate: (next) => ({
            ...next,
            session: { ...next.session, profile },
          }),
        });
        return { state: await this.project(stored) };
      },
    );
  }

  /** The structured brief ChatGPT builds a proposal from. */
  async getBrief(raw: unknown, context?: unknown) {
    OnboardingToolInputs.get_onboarding_brief.parse(raw);
    const { record } = await this.open(context);
    if (isExpired(record.session, this.clock()))
      throw fail(
        "SESSION_EXPIRED",
        "Diese Einrichtungssitzung ist abgelaufen. Starte die Einrichtung neu.",
      );
    const profile = record.session.profile;
    const validation = validateProfile(profile);
    if (!isProfileComplete(profile))
      throw fail(
        "PROFILE_INCOMPLETE",
        "Für einen Planvorschlag fehlen noch Pflichtangaben.",
        validation.errors.map((issue) => `${issue.code}: ${issue.message}`),
      );
    this.assertRunReady(profile);
    return buildBrief(profile, { exercises: await this.catalog() });
  }

  /** Opens the proposal phase. The model then builds a plan from the brief. */
  async requestPlanProposal(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run("request_onboarding_plan", raw, context, async (input) => {
      const { record, principal } = await this.open(context, input.request_id);
      // A lost acknowledgement must replay the original operation even though
      // that operation has already advanced the revision.
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(record),
          replayed: true,
        };
      this.assertRevision(record, input.expected_revision, input.request_id);
      this.assertRunReady(record.session.profile);
      const stored = await this.commit(
        record,
        { type: "REQUEST_PLAN" },
        {
          principal,
          operationId: input.request_id,
          auditEvent: "ONBOARDING_PLAN_REQUESTED",
        },
      );
      return { state: await this.project(stored) };
    });
  }

  /**
   * Takes a structured plan proposal and stores it as an editable draft.
   *
   * The proposal is handed to `TrainingPlanService.createTrainingPlan` with
   * `origin: "ai_proposal"`, which validates every exercise id, every rep range
   * and every target against the Arnold data contract and stores a *draft*.
   * There is no code path from here to an activated plan: that is the point of
   * §12, and it is why this method cannot activate anything even by mistake.
   */
  async submitPlanProposal(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run(
      "submit_onboarding_plan_proposal",
      raw,
      context,
      async (input) => {
        const { record, principal } = await this.open(
          context,
          input.request_id,
        );
        // A lost acknowledgement must replay the original operation even though
        // that operation has already advanced the revision.
        if (this.replay(record, input.request_id))
          return {
            state: await this.project(record),
            replayed: true,
          };
        this.assertRevision(record, input.expected_revision, input.request_id);
        if (!this.options.plans)
          throw fail(
            "PLAN_WRITE_UNAVAILABLE",
            "In dieser Umgebung kann kein Planentwurf gespeichert werden.",
          );
        if (isExpired(record.session, this.clock()))
          throw fail(
            "SESSION_EXPIRED",
            "Diese Einrichtungssitzung ist abgelaufen. Starte die Einrichtung neu.",
          );
        if (!isProfileComplete(record.session.profile))
          throw fail(
            "PROFILE_INCOMPLETE",
            "Ein Planvorschlag setzt vollständige Pflichtangaben voraus.",
          );
        this.assertRunReady(record.session.profile);

        // Does the proposal answer what the user asked for? Structural validity
        // is the plan service's job and is checked right after.
        const fit = validateProposalAgainstProfile(
          record.session.profile,
          input.sessions,
        );
        if (!fit.valid)
          throw fail(
            "PLAN_PROPOSAL_INVALID",
            fit.errors[0].message,
            fit.errors.map((issue) => `${issue.code}: ${issue.message}`),
          );

        // The quality rules (D-10): a block refuses the proposal with German
        // sentences the chat can act on; hints never block and come back in
        // the state's warnings.
        const quality = planQuality(
          record.session.profile,
          input.sessions,
          await this.catalog(),
        );
        if (quality?.blocked) {
          const blocks = quality.findings.filter(
            (finding) => finding.severity === "block",
          );
          throw fail(
            "PLAN_PROPOSAL_INVALID",
            blocks[0].detail,
            blocks.map((finding) => `${finding.code}: ${finding.detail}`),
          );
        }

        // "Plan erstellen" and a pasted own plan go straight to a proposal: the
        // proposal phase is opened on the way instead of needing its own call.
        // Done before the plan write, so a refused transition leaves no draft.
        let current = record;
        if (current.session.status === "PROFILE_READY")
          current = await this.commit(
            current,
            { type: "REQUEST_PLAN" },
            {
              principal,
              operationId: `${input.request_id}:request`,
              auditEvent: "ONBOARDING_PLAN_REQUESTED",
            },
          );
        if (
          current.session.status !== "WAITING_FOR_PLAN_PROPOSAL" &&
          current.session.status !== "REVIEWING_PLAN"
        )
          throw fail(
            "INVALID_STATE_TRANSITION",
            "In diesem Schritt kann kein neuer Planvorschlag übernommen werden. Für Änderungen am bestätigten Plan zuerst revise_onboarding_plan verwenden.",
          );

        const training = current.session.profile.training;
        // One plan write per onboarding request id, so a retried submission
        // is replayed by the plan service instead of creating a second draft.
        const response = await this.options.plans.createTrainingPlan(
          {
            request_id: `onb-plan-${input.request_id}`,
            name: input.name,
            origin: input.origin === "manual" ? "manual" : "ai_proposal",
            ...(input.split_key ? { split_key: input.split_key } : {}),
            ...(training.days_per_week !== null
              ? { days_per_week: training.days_per_week }
              : {}),
            ...(training.primary_goal !== null
              ? { goal_key: training.primary_goal }
              : {}),
            // Weights the chat was not told are Arnold's estimate, so the
            // first training starts with numbers instead of gaps.
            sessions: withStartLoads(
              input.sessions,
              current.session.profile,
              await this.catalog(),
            ),
            ...(input.custom_exercises?.length
              ? { custom_exercises: input.custom_exercises }
              : {}),
            ...(input.explanation ? { explanation: input.explanation } : {}),
          },
          context,
        );
        if (!response.ok || !response.result?.plan)
          throw fail(
            "PLAN_PROPOSAL_INVALID",
            response.error?.message ??
              "Der Planvorschlag konnte nicht gespeichert werden.",
            response.error?.details ?? [],
          );

        const version = response.result.plan.version;
        const stored = await this.commit(
          current,
          { type: "PLAN_PROPOSED" },
          {
            principal,
            operationId: input.request_id,
            auditEvent: "ONBOARDING_PLAN_PROPOSED",
            fields: {
              plan_version_id: {
                before:
                  record.session.plan_draft_reference?.plan_version_id ?? null,
                after: version.plan_version_id,
              },
              origin: { before: null, after: input.origin },
            },
            mutate: (next) => ({
              ...next,
              session: {
                ...next.session,
                plan_draft_reference: {
                  plan_version_id: version.plan_version_id,
                  plan_family_id: version.plan_family_id,
                  row_revision: version.row_revision,
                  name: version.name,
                  origin: input.origin,
                  session_count: version.session_count,
                  exercise_count: version.exercise_count,
                  proposed_at_utc: this.now(),
                  proposed_by: input.origin === "manual" ? "user" : "chatgpt",
                },
              },
            }),
          },
        );
        return { state: await this.project(stored) };
      },
    );
  }

  /** The referenced draft with its plan-service validation. */
  async getPlan(raw: unknown, context?: unknown) {
    OnboardingToolInputs.get_onboarding_plan.parse(raw);
    const { record } = await this.open(context);
    if (!record.session.plan_draft_reference)
      throw fail(
        "PLAN_PROPOSAL_REQUIRED",
        "Für diese Einrichtung liegt noch kein Planentwurf vor.",
      );
    const { plan, validation } = await this.referencedPlan(record);
    if (!plan)
      throw fail(
        "PLAN_NOT_FOUND",
        "Der Planentwurf dieser Einrichtung ist nicht mehr abrufbar.",
      );
    return { plan, validation, handoff: this.handoffFor(record, plan) };
  }

  /**
   * Takes the user's explicit release of exactly one revision.
   *
   * Three checks stand between a click and a stored confirmation: the
   * confirmation must name the referenced draft, it must name the revision the
   * draft currently has, and the plan service must consider that revision
   * valid. A review that succeeded earlier is not a confirmation, and a
   * confirmation for an older revision is refused with `STALE_CONFIRMATION`.
   *
   * What it does *not* do: activate anything. On success the setup moves on to
   * `READY_TO_FINISH`, and `finishSetup` activates exactly this revision. The
   * confirm tool calls it right away, because the release is the user's last
   * action and a second button that only repeats it would be a sham.
   */
  async confirmPlan(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run("confirm_onboarding_plan", raw, context, async (input) => {
      const { record, principal } = await this.open(context, input.request_id);
      // A lost acknowledgement must replay the original operation even though
      // that operation has already advanced the revision. Confirming is two
      // steps; a retry after an interruption between them finishes the second.
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(
            await this.prepareAfterConfirm(record, principal, input.request_id),
          ),
          replayed: true,
        };
      this.assertRevision(record, input.expected_revision, input.request_id);
      if (isExpired(record.session, this.clock()))
        throw fail(
          "SESSION_EXPIRED",
          "Diese Einrichtungssitzung ist abgelaufen. Starte die Einrichtung neu.",
        );

      const reference = record.session.plan_draft_reference;
      if (!reference)
        throw fail(
          "PLAN_PROPOSAL_REQUIRED",
          "Ohne Planentwurf kann nichts bestätigt werden.",
        );
      if (input.confirmation.plan_version_id !== reference.plan_version_id)
        throw fail(
          "STALE_CONFIRMATION",
          "Die Bestätigung gehört zu einer anderen Planversion als dem aktuellen Entwurf.",
          [
            `confirmed_plan_version_id=${input.confirmation.plan_version_id}`,
            `draft_plan_version_id=${reference.plan_version_id}`,
          ],
        );

      const { plan, validation } = await this.referencedPlan(record);
      if (!plan)
        throw fail(
          "PLAN_NOT_FOUND",
          "Der Planentwurf ist nicht mehr abrufbar. Bitte einen neuen Plan erstellen.",
        );
      // The revision as of *now*, not as of the review: an edit between the
      // review and the click must invalidate the confirmation, which is exactly
      // the "ältere Revision kann nicht unbemerkt bestätigt werden" rule.
      if (input.confirmation.row_revision !== plan.row_revision)
        throw fail(
          "STALE_CONFIRMATION",
          "Der Plan wurde nach deiner Prüfung geändert. Bitte die aktuelle Fassung ansehen und erneut bestätigen.",
          [
            `confirmed_row_revision=${input.confirmation.row_revision}`,
            `current_row_revision=${plan.row_revision}`,
          ],
        );
      if (!validation?.valid)
        throw fail(
          "PLAN_PROPOSAL_INVALID",
          "Dieser Plan ist noch nicht vollständig und kann nicht bestätigt werden.",
          (validation?.errors ?? []).map(
            (issue) => `${issue.code}: ${issue.message}`,
          ),
        );

      const confirmation = {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        profile_revision: record.session.profile.revision,
        confirmed_at_utc: this.now(),
        session_count: plan.session_count,
        exercise_count: plan.exercise_count,
      };
      const confirmed = await this.commit(
        record,
        { type: "CONFIRM_PLAN" },
        {
          principal,
          operationId: input.request_id,
          auditEvent: "ONBOARDING_PLAN_CONFIRMED",
          fields: {
            confirmed_plan_version_id: {
              before: null,
              after: confirmation.plan_version_id,
            },
            confirmed_row_revision: {
              before: null,
              after: confirmation.row_revision,
            },
          },
          mutate: (next) => ({
            ...next,
            session: {
              ...next.session,
              confirmed_plan_reference: confirmation,
            },
          }),
        },
      );
      // Both transitions are real machine transitions, run in order, so the
      // documented path PLAN_CONFIRMED -> READY_TO_FINISH holds.
      const stored = await this.prepareAfterConfirm(
        confirmed,
        principal,
        input.request_id,
      );
      return { state: await this.project(stored) };
    });
  }

  /**
   * The second step of a confirmation: PLAN_CONFIRMED -> READY_TO_FINISH.
   *
   * Runs only while the confirmation still stands for the current draft, so a
   * retry can never hand over a plan that changed in between. Anything else
   * is left as it is.
   */
  private async prepareAfterConfirm(
    record: OnboardingRecord,
    principal: OnboardingPrincipal,
    requestId: string,
  ): Promise<OnboardingRecord> {
    if (
      record.session.status !== "PLAN_CONFIRMED" ||
      `${requestId}:handoff` in record.applied ||
      isExpired(record.session, this.clock())
    )
      return record;
    const { plan } = await this.referencedPlan(record);
    if (this.handoffFor(record, plan).status !== "ready_to_finish")
      return record;
    return this.commit(
      record,
      { type: "PREPARE_HANDOFF" },
      {
        principal,
        operationId: `${requestId}:handoff`,
        auditEvent: "ONBOARDING_HANDOFF_PREPARED",
      },
    );
  }

  /**
   * Takes a confirmed plan back into editing at the user's request.
   *
   * The explicit counterpart to the defensive check in `handoffFor`: it voids
   * the confirmation deliberately instead of waiting for a revision to drift.
   */
  async revisePlan(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run("revise_onboarding_plan", raw, context, async (input) => {
      const { record, principal } = await this.open(context, input.request_id);
      // A lost acknowledgement must replay the original operation even though
      // that operation has already advanced the revision.
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(record),
          replayed: true,
        };
      this.assertRevision(record, input.expected_revision, input.request_id);
      const stored = await this.commit(
        record,
        { type: "REVISE_PLAN" },
        {
          principal,
          operationId: input.request_id,
          auditEvent: "ONBOARDING_PLAN_REVISION_REQUESTED",
          reason: input.reason ?? null,
        },
      );
      return { state: await this.project(stored) };
    });
  }

  /**
   * The handoff for Task 007.
   *
   * A read that also *repairs*: if the draft moved after the confirmation, the
   * session is taken back to `REVIEWING_PLAN` here rather than left claiming a
   * readiness it no longer has. That is what makes a stale handoff impossible to
   * act on even when the change came from the plan editor.
   */
  async prepareSetupHandoff(
    raw: unknown,
    context?: unknown,
  ): Promise<{ handoff: OnboardingHandoff; state: OnboardingState }> {
    OnboardingToolInputs.get_onboarding_handoff.parse(raw);
    const { record, principal } = await this.open(context);
    const { plan } = await this.referencedPlan(record);
    const handoff = this.handoffFor(record, plan);

    if (
      handoff.status === "superseded" &&
      record.session.confirmed_plan_reference &&
      !isExpired(record.session, this.clock())
    ) {
      const repaired = await this.commit(
        record,
        { type: "REVISE_PLAN" },
        {
          principal,
          operationId: `handoff-recheck-${this.newId()}`,
          auditEvent: "ONBOARDING_PLAN_REVISION_REQUESTED",
          reason: "Planrevision weicht von der Bestätigung ab.",
        },
      ).catch(() => record);
      const state = await this.project(repaired);
      return { handoff: state.handoff, state };
    }

    // Preparing is idempotent and only moves a confirmed session forward.
    if (
      handoff.status === "ready_to_finish" &&
      record.session.status === "PLAN_CONFIRMED"
    ) {
      const stored = await this.commit(
        record,
        { type: "PREPARE_HANDOFF" },
        {
          principal,
          operationId: `handoff-${this.newId()}`,
          auditEvent: "ONBOARDING_HANDOFF_PREPARED",
        },
      );
      const state = await this.project(stored);
      return { handoff: state.handoff, state };
    }
    return { handoff, state: await this.project(record) };
  }

  /**
   * Finishes the setup: activates exactly the confirmed plan, then marks the
   * setup completed.
   *
   * Safe to repeat. The activation's request id is derived from the session
   * and the confirmed revision, so a retry after an interruption replays the
   * stored activation instead of activating twice, and a setup that was
   * already completed simply reports so.
   */
  async finishSetup(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run("finish_arnold_setup", raw, context, async (input) => {
      const plans = this.options.plans;
      if (!plans || !this.options.setupFinishAvailable)
        throw fail(
          "PLAN_WRITE_UNAVAILABLE",
          "In dieser Umgebung kann die Einrichtung nicht abgeschlossen werden.",
        );
      const opened = await this.open(context, input.request_id);
      let record = opened.record;
      // Fail closed before anything is activated: a setup with the running
      // goal must not finish where nothing can keep the run profile.
      this.assertRunServiceFor(record.session);
      this.assertMobilityServiceFor(record.session);
      if (record.session.status === "COMPLETED") {
        // A finish whose run or mobility hand-over failed is repeated until
        // it holds.
        await this.applyRunProfile(record.session, context);
        await this.applyMobilityProfile(record.session, context);
        return {
          state: await this.project(record),
          replayed: true,
        };
      }
      const confirmed = record.session.confirmed_plan_reference;
      if (!confirmed)
        throw fail(
          "CONFIRMATION_REQUIRED",
          "Zuerst den Trainingsplan ausdrücklich bestätigen.",
        );
      if (isExpired(record.session, this.clock()))
        throw fail(
          "SESSION_EXPIRED",
          "Diese Einrichtungssitzung ist abgelaufen. Starte die Einrichtung neu.",
        );
      const activationId = `setup-${record.session.onboarding_session_id}-${confirmed.plan_version_id}-${confirmed.row_revision}`;
      const stored = await plans
        .getPlan({ plan_version_id: confirmed.plan_version_id })
        .catch(() => null);
      // Activated by an earlier, interrupted attempt of this very step.
      const activated =
        stored?.plan.status === "active" &&
        stored.plan.row_revision === confirmed.row_revision + 1 &&
        record.session.status === "READY_TO_FINISH" &&
        record.session.profile.revision === confirmed.profile_revision;
      if (!activated) {
        const { handoff } = await this.prepareSetupHandoff({}, context);
        if (handoff.status !== "ready_to_finish")
          throw fail(
            handoff.status === "superseded"
              ? "HANDOFF_SUPERSEDED"
              : "HANDOFF_NOT_READY",
            handoff.blocked_reason ??
              "Der bestätigte Plan kann gerade nicht übernommen werden.",
          );
        const activation = await plans.activateTrainingPlan(
          {
            request_id: activationId,
            plan_version_id: confirmed.plan_version_id,
            expected_row_revision: confirmed.row_revision,
            confirmation: {
              plan_version_id: confirmed.plan_version_id,
              row_revision: confirmed.row_revision,
              confirmed: true,
            },
          },
          context,
        );
        if (!activation.ok) {
          const error = activation.error!;
          const code = OnboardingErrorCodeSchema.safeParse(error.code);
          throw new OnboardingError(
            code.success ? code.data : "HANDOFF_NOT_READY",
            error.message,
            error.retryable,
            error.details,
          );
        }
        record = (await this.open(context, input.request_id)).record;
      }
      const done = await this.commit(
        record,
        { type: "SETUP_FINISHED", finish_verified: true },
        {
          principal: opened.principal,
          operationId: input.request_id,
          auditEvent: "ONBOARDING_COMPLETED",
          mutate: (next) => ({
            ...next,
            session: { ...next.session, handoff_status: "completed" },
          }),
        },
      );
      // The user asked for runs: unlike the start weight, losing these
      // answers silently would leave a plan with runs and no run profile.
      await this.applyRunProfile(done.session, context);
      await this.applyMobilityProfile(done.session, context);
      const weight = done.session.profile.person.body_weight_kg;
      if (weight !== undefined && this.options.recordStartWeight)
        // A convenience on top of a finished setup: the setup is stored and
        // stays finished even if this one extra write fails. The same
        // request id makes a repeated finish write it at most once.
        await this.options
          .recordStartWeight(
            weight,
            `setup-weight-${done.session.onboarding_session_id}`,
            context,
          )
          .catch(() => undefined);
      return { state: await this.project(done) };
    });
  }

  /**
   * A setup with the running goal needs a run service to keep the run
   * profile. Without one the finish is refused, never silently skipped.
   */
  private assertRunServiceFor(session: OnboardingRecord["session"]) {
    if (!wantsRunning(session.profile.training)) return;
    if (this.options.recordRunProfile) return;
    throw fail(
      "PLAN_WRITE_UNAVAILABLE",
      "In dieser Umgebung können Laufangaben nicht gespeichert werden. Die Einrichtung mit dem Ziel „Ausdauer und Laufen“ lässt sich hier nicht abschließen.",
    );
  }

  /**
   * Hands the run details to the run service. The service's own request id
   * rules make this safe to repeat. A refusal is reported, not swallowed.
   */
  private async applyRunProfile(
    session: OnboardingRecord["session"],
    context: unknown,
  ) {
    const run = session.profile.training.run;
    if (!run || !wantsRunning(session.profile.training)) return;
    if (!this.options.recordRunProfile)
      return this.assertRunServiceFor(session);
    try {
      await this.options.recordRunProfile(
        run,
        session.onboarding_session_id,
        context,
      );
    } catch {
      throw new OnboardingError(
        "PLAN_WRITE_UNAVAILABLE",
        "Dein Plan ist aktiv, aber die Laufangaben konnten noch nicht gespeichert werden. Tippe noch einmal auf „Einrichtung abschließen“.",
        true,
      );
    }
  }

  /**
   * A setup that holds a mobility answer needs a mobility service to keep it.
   * Without one the finish is refused, never silently skipped.
   */
  private assertMobilityServiceFor(session: OnboardingRecord["session"]) {
    if (session.profile.training.mobility === undefined) return;
    if (this.options.recordMobilityProfile) return;
    throw fail(
      "PLAN_WRITE_UNAVAILABLE",
      "In dieser Umgebung können Mobility-Angaben nicht gespeichert werden. Die Einrichtung mit einer Mobility-Antwort lässt sich hier nicht abschließen.",
    );
  }

  /**
   * Hands the mobility answer to the mobility service, a "no" included. The
   * service's own request id rules make this safe to repeat. A refusal is
   * reported, not swallowed.
   */
  private async applyMobilityProfile(
    session: OnboardingRecord["session"],
    context: unknown,
  ) {
    const mobility = session.profile.training.mobility;
    if (mobility === undefined) return;
    if (!this.options.recordMobilityProfile)
      return this.assertMobilityServiceFor(session);
    try {
      await this.options.recordMobilityProfile(
        mobility,
        session.onboarding_session_id,
        context,
        session.profile.training.has_mat ?? undefined,
      );
    } catch {
      throw new OnboardingError(
        "PLAN_WRITE_UNAVAILABLE",
        "Dein Plan ist aktiv, aber die Mobility-Angaben konnten noch nicht gespeichert werden. Tippe noch einmal auf „Einrichtung abschließen“.",
        true,
      );
    }
  }

  /** Ends a setup deliberately. Always possible, never an error. */
  async cancelOnboarding(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run("cancel_onboarding", raw, context, async (input) => {
      const { record, principal } = await this.open(context, input.request_id);
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(record),
          replayed: true,
        };
      const stored = await this.commit(
        record,
        { type: "CANCEL" },
        {
          principal,
          operationId: input.request_id,
          auditEvent: "ONBOARDING_CANCELLED",
          reason: input.reason ?? null,
        },
      );
      return { state: await this.project(stored) };
    });
  }

  /* ---------------------------------------------------------------- helpers */

  /**
   * Refuses a write built on another revision than the stored one.
   *
   * One exception: a step of this very request (`<request_id>:…`) moved the
   * revision. Then the retry of an interrupted request is still built on the
   * right state and may finish it.
   */
  private assertRevision(
    record: OnboardingRecord,
    expected?: number,
    requestId?: string,
  ) {
    const ownStep =
      requestId !== undefined &&
      Object.entries(record.applied).some(
        ([id, revision]) =>
          id.startsWith(`${requestId}:`) &&
          revision === record.session.revision,
      );
    if (
      expected !== undefined &&
      record.session.revision !== expected &&
      !ownStep
    )
      throw fail(
        "REVISION_CONFLICT",
        "Dieser Einrichtungsstand ist nicht mehr aktuell. Bitte neu laden und die Änderung erneut vornehmen.",
        [`current_revision=${record.session.revision}`],
      );
  }

  /** True when this request id has already been applied to this session. */
  private replay(record: OnboardingRecord, requestId: string): boolean {
    return requestId in record.applied;
  }

  /**
   * The envelope around every write.
   *
   * A refusal returns the *stored* state together with the reason, so a client
   * learns what is true rather than losing the state it had. Nothing is
   * reported as successful before the repository confirmed the write.
   */
  private async run<K extends OnboardingToolName>(
    operation: K,
    raw: unknown,
    context: unknown,
    action: (
      input: ReturnType<(typeof OnboardingToolInputs)[K]["parse"]>,
    ) => Promise<{
      state: OnboardingState;
      replayed?: boolean;
    }>,
    precheck?: () => Promise<void>,
  ): Promise<OnboardingResponse> {
    const requestId =
      raw && typeof raw === "object" && "request_id" in raw
        ? String((raw as { request_id: unknown }).request_id)
        : "";
    try {
      const input = OnboardingToolInputs[operation].parse(raw) as ReturnType<
        (typeof OnboardingToolInputs)[K]["parse"]
      >;
      // Refusals that explain more than the deployment's write lock run first:
      // a finished account learns it is finished, not that writes are locked.
      await precheck?.();
      const { state, replayed } = await action(input);
      return OnboardingResponseSchema.parse({
        ok: true,
        operation,
        request_id: requestId,
        replayed: replayed ?? false,
        state,
        error: null,
      });
    } catch (error) {
      const failure = this.normalize(error);
      // Best effort: show the caller the state that actually stands, so a
      // refusal is informative. A state we cannot read is reported as null
      // rather than guessed.
      let state: OnboardingState | null = null;
      try {
        const { record } = await this.open(context);
        state = await this.project(record);
      } catch {
        /* no open setup of this caller: nothing to show */
      }
      return {
        ok: false,
        operation,
        request_id: requestId,
        replayed: false,
        state,
        error: {
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          details: failure.details,
          recovery: recoveryFor(failure.code, failure.retryable),
        },
      };
    }
  }

  /** Normalises anything thrown into an `OnboardingError`. */
  private normalize(error: unknown): OnboardingError {
    if (error instanceof OnboardingError) return error;
    if (error instanceof OnboardingAccessError)
      return new OnboardingError(error.code, error.message);
    if (error instanceof RepositoryConflictError)
      return new OnboardingError("REVISION_CONFLICT", error.message);
    if (
      error &&
      typeof error === "object" &&
      "issues" in error &&
      Array.isArray((error as { issues: unknown[] }).issues)
    )
      return new OnboardingError(
        "VALIDATION_ERROR",
        "Die Angaben sind nicht vollständig oder nicht gültig.",
        false,
        (
          error as { issues: { path: unknown[]; message: string }[] }
        ).issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
    return new OnboardingError(
      "STORAGE_UNAVAILABLE",
      "Die Einrichtung ist derzeit nicht verfügbar.",
      true,
    );
  }
}

/** The handoff statuses Task 007 may act on. Everything else must be refused. */
export const ACTIONABLE_HANDOFF_STATUSES: readonly HandoffStatus[] =
  HANDOFF_STATUSES.filter((status) => status === "ready_to_finish");

/**
 * Adds the two proposal hints (missing equipment, too many exercises for the
 * time) to the profile findings, recomputed from the draft as it is now.
 * Warnings only: they never block, and a draft changed in the editor is
 * judged again on the next read.
 */
function withProposalHints(
  validation: OnboardingValidationResult,
  profile: OnboardingProfile,
  plan: TrainingPlanVersion | null,
  catalog: readonly ArnoldExercise[],
): OnboardingValidationResult {
  if (!plan || profile.path !== "arnold_plan") return validation;
  const quality = planQuality(profile, plan.sessions, catalog);
  const hints = [
    ...proposalFitIssues(profile, plan.sessions).filter(
      (issue) => issue.severity === "warning",
    ),
    ...(quality?.findings ?? [])
      .filter((finding) => finding.severity === "hint")
      .map((finding) => ({
        code: "PLAN_QUALITY_HINT" as const,
        severity: "warning" as const,
        message: finding.detail,
        field: null,
        step: null,
      })),
  ];
  return hints.length
    ? { ...validation, warnings: [...validation.warnings, ...hints] }
    : validation;
}

/**
 * The plan quality check (src/analytics/plan-quality.ts) for an Arnold plan,
 * or null where it does not apply: an own plan is the user's, and without
 * days and minutes there is no budget to check against. Exercises the
 * catalog does not know count as unknown, never as a muscle group.
 */
function planQuality(
  profile: OnboardingProfile,
  sessions: readonly {
    session_name: string;
    exercises: readonly { exercise_id: string; target_sets?: number | null }[];
  }[],
  catalog: readonly ArnoldExercise[],
): PlanQualityResult | null {
  const training = profile.training;
  if (
    profile.path !== "arnold_plan" ||
    training.days_per_week === null ||
    training.session_minutes === null
  )
    return null;
  return checkPlanQuality({
    sessions: sessions.map((session) => ({
      session_name: session.session_name,
      exercises: session.exercises.map((item) => ({
        exercise_id: item.exercise_id,
        target_sets: item.target_sets ?? null,
      })),
    })),
    catalog: catalog.map((exercise) => ({
      exercise_id: exercise.exercise_id,
      primary_muscle: muscleGroupOf(exercise.primary_muscle),
    })),
    profile: {
      days_per_week: training.days_per_week,
      session_minutes: training.session_minutes,
      focus_muscle_groups: training.focus_muscle_groups ?? [],
      goal: training.primary_goal,
    },
  });
}

/** Arnold's figures for the plan card, from the referenced plan. */
function planInsights(
  plan: TrainingPlanVersion,
  profile: OnboardingProfile | null,
  catalog: readonly ArnoldExercise[],
): PlanInsights {
  const muscles = new Map(
    catalog.map((e) => [e.exercise_id, muscleGroupOf(e.primary_muscle)]),
  );
  const training = profile?.training ?? {
    experience: null,
    training_days: undefined,
  };
  const insights = buildPlanInsights({
    sessions: plan.sessions
      .map((session) => ({
        session_id: session.session_id,
        exercises: session.exercises
          .filter((item) => item.status === "active")
          .map((item) => ({
            exercise_id: item.exercise_id,
            target_sets: item.target_sets ?? null,
          })),
      }))
      .filter((session) => session.exercises.length > 0),
    runs: (plan.run_sessions ?? [])
      .filter((run) => run.status === "active")
      .map((run) => ({ preferred_weekday: run.preferred_weekday })),
    mobility: (plan.mobility_sessions ?? [])
      .filter((routine) => routine.status === "active")
      .map((routine) => ({
        kind: routine.kind,
        placement: routine.placement,
        weekdays: routine.weekdays,
        after_session_id: routine.after_session_id,
      })),
    muscleOf: (id) =>
      muscles.get(id) ??
      muscleGroupOf(
        plan.sessions
          .flatMap((s) => s.exercises)
          .find((e) => e.exercise_id === id)?.exercise_primary_muscle,
      ),
    groups: MUSCLE_GROUPS,
    experience: training.experience,
    trainingDays: (training.training_days ?? []).map(
      (day) => WEEKDAYS.indexOf(day) + 1,
    ),
  });
  const notes = new Map(
    (plan.explanation?.volume_notes ?? []).map((n) => [n.muscle_group, n.note]),
  );
  return {
    ...insights,
    weekly_sets: insights.weekly_sets.map((row) => ({
      ...row,
      label:
        MUSCLE_GROUP_LABEL[
          row.muscle_group as keyof typeof MUSCLE_GROUP_LABEL
        ] ?? row.muscle_group,
      note:
        row.min !== null && row.sets < row.min
          ? (notes.get(row.muscle_group as never) ?? null)
          : null,
    })),
    uncounted_exercise_ids: [...insights.uncounted_exercise_ids],
    week: insights.week.map((day) => ({ ...day, kinds: [...day.kinds] })),
    morning_weekdays: [...insights.morning_weekdays],
  };
}

/**
 * The muscle group key of a catalog entry. The tracker stores the German
 * label (account/catalog); a key is taken as it is. Anything else is unknown.
 */
function muscleGroupOf(primary: string | null | undefined): string | null {
  if (!primary) return null;
  if ((MUSCLE_GROUPS as readonly string[]).includes(primary)) return primary;
  const entry = Object.entries(MUSCLE_GROUP_LABEL).find(
    ([, label]) => label === primary,
  );
  return entry ? entry[0] : null;
}
