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
 *   - a session id is never treated as a permission: every addressed operation
 *     authorizes against the stored token fingerprint first;
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
 *   - `COMPLETED` is reached only through verified Google provisioning
 *     (`completeProvisioning`), never through a client call;
 *   - where the caller is a verified account (`access.perOwner`), the setup
 *     belongs to that account: one open setup per user, found again in any
 *     new chat, and never started again once it is completed.
 *
 * Onboarding state lives in its own repository, never in the six Arnold tables
 * (`CONFIG.onboarding_storage = BACKEND_ONLY`).
 */
import {
  GOOGLE_REAUTH_MESSAGE,
  GOOGLE_REAUTH_REQUIRED,
  recoveryFor,
} from "../../shared/write-recovery.js";
import { isGoogleReauthRequired } from "../google/reauth.js";
import type {
  ArnoldDataset,
  ArnoldExercise,
} from "../../shared/arnold-schema-v1.js";
import {
  HANDOFF_STATUSES,
  ONBOARDING_CONTRACT,
  ONBOARDING_SCHEMA_VERSION,
  OnboardingResponseSchema,
  OnboardingStateSchema,
  OnboardingToolInputs,
  WEEKDAYS,
  splitsForDays,
  stepForStatus,
  type HandoffStatus,
  type OnboardingClaim,
  type OnboardingErrorCode,
  type OnboardingHandoff,
  type OnboardingProfile,
  type OnboardingProfilePatch,
  type OnboardingResponse,
  type OnboardingState,
  type OnboardingStep,
  type OnboardingToolName,
} from "../../shared/onboarding-contract.js";
import type {
  PlanValidationResult,
  TrainingPlanVersion,
} from "../../shared/plan-contract.js";
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
  oauthStateBinding,
  type OnboardingAccessControl,
  type OnboardingPrincipal,
} from "./access.js";
import {
  buildBrief,
  buildProgress,
  exerciseChoices,
  isProfileComplete,
  firstOpenStep,
  validateProfile,
  validateProposalAgainstProfile,
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
  googleConnectionAvailable?: boolean;
  beforeMutation?: () => Promise<void>;
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
   * The authoritative "this account is set up" check, where the deployment
   * has one (the connected runtime: the personal Google file is ready).
   * Without it, a completed onboarding session is the evidence.
   */
  setupComplete?: () => Promise<boolean>;
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

/** Lists keep weekday order and hold each value once. */
const ordered = <T extends string>(values: readonly T[], order: readonly T[]) =>
  order.filter((value) => values.includes(value));
const unique = <T>(values: readonly T[]) => [...new Set(values)];

/**
 * Applies a patch to a profile.
 *
 * Absent keys stay, `null` removes an optional answer, an empty list removes
 * a list. Two rules keep the answers consistent instead of contradictory:
 * fixed weekdays decide the number of days, and an exercise is either
 * preferred or avoided, never both — the newer choice wins.
 */
export function mergeProfile(
  before: OnboardingProfile,
  patch: OnboardingProfilePatch,
): Omit<OnboardingProfile, "revision" | "updated_at_utc"> {
  const person: Record<string, unknown> = { ...before.person };
  for (const [key, value] of Object.entries(patch.person ?? {})) {
    if (value === undefined) continue;
    if (value === null || (Array.isArray(value) && value.length === 0))
      delete person[key];
    else person[key] = Array.isArray(value) ? unique(value) : value;
  }

  const training: Record<string, unknown> = { ...before.training };
  for (const [key, value] of Object.entries(patch.training ?? {})) {
    if (value === undefined) continue;
    if (value === null || (Array.isArray(value) && value.length === 0))
      delete training[key];
    else training[key] = Array.isArray(value) ? unique(value) : value;
  }

  const days = patch.training?.training_days;
  if (days?.length) {
    training.training_days = ordered(days, WEEKDAYS);
    training.days_per_week = (training.training_days as unknown[]).length;
  } else if (
    patch.training?.days_per_week !== undefined &&
    Array.isArray(training.training_days) &&
    training.training_days.length !== patch.training.days_per_week
  )
    // "Flexibel, vier Tage" replaces three fixed weekdays.
    delete training.training_days;

  const drop = (key: string, ids: readonly string[] | undefined) => {
    if (!ids?.length || !Array.isArray(training[key])) return;
    const rest = (training[key] as string[]).filter((id) => !ids.includes(id));
    if (rest.length) training[key] = rest;
    else delete training[key];
  };
  drop("avoided_exercise_ids", patch.training?.preferred_exercise_ids);
  drop("preferred_exercise_ids", patch.training?.avoided_exercise_ids);

  return {
    path: patch.path ?? before.path,
    person: person as OnboardingProfile["person"],
    training: training as OnboardingProfile["training"],
  };
}

export class OnboardingService {
  readonly mode: "fixture" | "production";

  constructor(private options: OnboardingServiceOptions) {
    this.mode = options.access.mode;
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
   * Loads a session and authorizes the caller against it.
   *
   * The order matters: authorize *before* revealing anything, and answer an
   * unknown id and a wrong token the same way, so the API does not confirm
   * which session ids exist.
   */
  private async open(
    claim: { onboarding_session_id: string; session_token: string },
    context: unknown,
  ): Promise<{ record: OnboardingRecord; principal: OnboardingPrincipal }> {
    const record = await this.options.repository.getSession(
      claim.onboarding_session_id,
    );
    if (!record) {
      // Production fails closed even here: it must not leak that an id is
      // unknown while its own guard would refuse any access anyway.
      if (this.mode === "production")
        throw fail(
          "AUTH_REQUIRED",
          "Produktive Einrichtungssitzungen benötigen eine geprüfte Nutzeridentität.",
        );
      throw fail(
        "SESSION_NOT_FOUND",
        "Diese Einrichtungssitzung ist nicht zugänglich. Starte die Einrichtung neu.",
      );
    }
    try {
      const principal = await this.options.access.authorize(
        record,
        claim.session_token,
        context,
      );
      return { record, principal };
    } catch (error) {
      if (error instanceof OnboardingAccessError)
        throw fail(error.code, error.message);
      throw fail("PERMISSION_DENIED", "Zugriff verweigert.");
    }
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

  private async audit(
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
  ) {
    if (!this.options.audit) return;
    const fields = detail.fields ?? {
      revision: { before: detail.previous, after: detail.next },
    };
    await this.options.audit.append([
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
    ]);
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
        session = { ...session, handoff_status: "ready_for_google_connection" };
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

    const stored = await this.options.repository.updateSession(
      next,
      previousRevision,
    );
    await this.audit(
      options.auditEvent,
      stored,
      options.operationId,
      options.principal,
      {
        previous: previousRevision,
        next: stored.session.revision,
        fields: options.fields,
        reason: options.reason ?? null,
      },
    );
    // A voided confirmation is its own audited fact: it is the trace that shows
    // an approved revision stopped being approved, and when.
    if (invalidated)
      await this.audit(
        "ONBOARDING_CONFIRMATION_INVALIDATED",
        stored,
        options.operationId,
        options.principal,
        {
          previous: previousRevision,
          next: stored.session.revision,
          fields: {
            confirmed_plan_reference: {
              before:
                record.session.confirmed_plan_reference?.row_revision ?? null,
              after: null,
            },
          },
        },
      );
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
    const reference =
      record.session.confirmed_plan_reference ??
      record.session.plan_draft_reference;
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
      onboarding_session_id: record.session.onboarding_session_id,
      confirmed_plan_version_id: confirmation?.plan_version_id ?? null,
      confirmed_plan_revision: confirmation?.row_revision ?? null,
      profile_revision: confirmation?.profile_revision ?? null,
      confirmation_timestamp: confirmation?.confirmed_at_utc ?? null,
      current_plan_revision: plan?.row_revision ?? null,
      google_connection_pending: record.session.status !== "COMPLETED",
    };
    if (record.session.status === "COMPLETED")
      return {
        ...base,
        status: "completed",
        oauth_state_binding: null,
        blocked_reason: null,
      };
    if (!confirmation)
      return {
        ...base,
        status: "not_ready",
        oauth_state_binding: null,
        blocked_reason:
          "Es liegt noch keine Bestätigung eines Trainingsplans vor.",
      };
    if (!plan)
      return {
        ...base,
        status: "superseded",
        oauth_state_binding: null,
        blocked_reason:
          "Der bestätigte Planentwurf ist nicht mehr abrufbar. Bitte einen neuen Plan erstellen und bestätigen.",
      };
    if (plan.row_revision !== confirmation.row_revision)
      return {
        ...base,
        status: "superseded",
        oauth_state_binding: null,
        blocked_reason: `Der Plan wurde nach der Bestätigung geändert (bestätigt: Revision ${confirmation.row_revision}, aktuell: Revision ${plan.row_revision}). Bitte erneut prüfen und bestätigen.`,
      };
    // The plan was released *for a given profile*. Changed answers mean the
    // release no longer describes what the user asked for, even though no row
    // of the plan moved — so the confirmation lapses just the same.
    if (record.session.profile.revision !== confirmation.profile_revision)
      return {
        ...base,
        status: "superseded",
        oauth_state_binding: null,
        blocked_reason:
          "Du hast deine Angaben nach der Bestätigung geändert. Bitte sieh dir den Plan noch einmal an und bestätige ihn erneut.",
      };
    if (
      record.session.status !== "PLAN_CONFIRMED" &&
      record.session.status !== "AWAITING_GOOGLE_CONNECTION"
    )
      return {
        ...base,
        status: "not_ready",
        oauth_state_binding: null,
        blocked_reason: "Die Einrichtung ist nicht im Übergabezustand.",
      };
    return {
      ...base,
      status: "ready_for_google_connection",
      oauth_state_binding: oauthStateBinding(record, confirmation.row_revision),
      blocked_reason: null,
    };
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
    return OnboardingStateSchema.parse({
      onboarding_contract: ONBOARDING_CONTRACT,
      session: {
        ...session,
        // The stored handoff status is a cache; the recomputed one is the truth,
        // so a drifted draft is visible even before the next write.
        handoff_status: handoff.status,
      },
      progress: buildProgress(session.profile, {
        step: session.current_step,
        can_request_plan:
          complete &&
          !expired &&
          allowedEvents(machine).includes("REQUEST_PLAN"),
        can_confirm_plan:
          !expired &&
          allowedEvents(machine).includes("CONFIRM_PLAN") &&
          (validation?.valid ?? false),
      }),
      validation: validateProfile(session.profile),
      plan,
      plan_validation: validation,
      handoff,
      allowed_events: expired ? ["CANCEL"] : allowedEvents(machine),
      exercise_choices: exerciseChoices(session.profile),
      split_options: splitsForDays(session.profile.training.days_per_week),
      mode: this.mode,
      google_connection_available:
        this.options.googleConnectionAvailable ?? false,
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
      generated_at_utc: this.now(),
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
      async (input) => {
        const begun = await this.begin(input, context);
        return { state: begun.state, token: begun.token };
      },
      () => this.assertNotCompleted(context),
    );
  }

  private async begin(
    input: { request_id: string; resume_session?: OnboardingClaim },
    context: unknown,
  ): Promise<{
    state: OnboardingState;
    token: string | null;
    resumed: boolean;
  }> {
    if (input.resume_session) {
      const existing = await this.options.repository
        .getSession(input.resume_session.onboarding_session_id)
        .catch(() => undefined);
      if (existing) {
        const { record, principal } = await this.open(
          input.resume_session,
          context,
        );
        if (record.session.status === "COMPLETED") throw this.alreadyDone();
        if (this.resumable(record)) {
          const stored = await this.commit(
            record,
            { type: "START" },
            {
              principal,
              operationId: input.request_id,
              auditEvent: "ONBOARDING_RESUMED",
            },
          );
          return {
            state: await this.project(stored),
            token: null,
            resumed: true,
          };
        }
      }
    }

    const principal = await this.establish(context);

    if (this.options.access.perOwner) {
      const latest = await this.options.repository.findLatestByOwner(
        principal.subject,
      );
      if (latest?.session.status === "COMPLETED") throw this.alreadyDone();
      if (latest && this.resumable(latest)) {
        // The owner is verified; the secret only names this session. A new
        // chat has lost it, so it is replaced rather than asked for.
        const token = createSessionToken();
        const reissued = await this.options.repository.reissueToken(
          latest.session.onboarding_session_id,
          fingerprintToken(token),
          latest.session.revision,
        );
        const stored = await this.commit(
          reissued,
          { type: "START" },
          {
            principal,
            operationId: input.request_id,
            auditEvent: "ONBOARDING_RESUMED",
          },
        );
        return { state: await this.project(stored), token, resumed: true };
      }
    }

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
        revision: 1,
        profile,
        plan_draft_reference: null,
        confirmed_plan_reference: null,
        handoff_status: "not_ready",
        last_error: null,
        tracker_id: this.options.trackerId,
      },
      token_fingerprint: fingerprintToken(token),
      owner_subject: principal.subject,
      applied: { [input.request_id]: 1 },
    };
    // Old sessions are collected on the way in rather than by a background
    // job, so an abandoned setup cannot pile up unnoticed.
    await this.options.repository.purge(this.clock()).catch(() => 0);
    const stored = await this.options.repository.createSession(record);
    await this.audit(
      "ONBOARDING_STARTED",
      stored,
      input.request_id,
      principal,
      { previous: null, next: stored.session.revision },
    );
    return { state: await this.project(stored), token, resumed: false };
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
    if (latest?.session.status === "COMPLETED") throw this.alreadyDone();
  }

  private alreadyDone() {
    return fail(
      "ONBOARDING_ALREADY_COMPLETED",
      "Arnold ist für dieses Konto bereits eingerichtet. Die Einrichtung läuft nur einmal; Trainingsplan und Übungen lassen sich jederzeit über den Plan-Editor ändern.",
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
    token: string | null;
    resumed: boolean;
  }> {
    if (this.options.access.perOwner) {
      const principal = await this.establish(context);
      const latest = await this.options.repository.findLatestByOwner(
        principal.subject,
      );
      if (latest?.session.status === "COMPLETED")
        return {
          state: await this.project(latest),
          token: null,
          resumed: true,
        };
      if (latest && this.resumable(latest)) {
        // Opening is a read plus a new secret, so it also works while the
        // Google file is being created and every setup write is locked.
        const token = createSessionToken();
        const reissued = await this.options.repository.reissueToken(
          latest.session.onboarding_session_id,
          fingerprintToken(token),
          latest.session.revision,
        );
        return { state: await this.project(reissued), token, resumed: true };
      }
    }
    try {
      await this.options.beforeMutation?.();
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
  async getOnboardingState(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingState> {
    const input = OnboardingToolInputs.get_onboarding_state.parse(raw);
    const { record } = await this.open(input, context);
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
    return this.run("update_onboarding_profile", raw, async (input) => {
      const { record, principal } = await this.open(input, context);
      this.assertRevision(record, input.expected_revision);
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(record),
          token: null,
          replayed: true,
        };

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
      return { state: await this.project(stored), token: null };
    });
  }

  /** The structured brief ChatGPT builds a proposal from. */
  async getBrief(raw: unknown, context?: unknown) {
    const input = OnboardingToolInputs.get_onboarding_brief.parse(raw);
    const { record } = await this.open(input, context);
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
    return buildBrief(profile, {
      onboarding_session_id: record.session.onboarding_session_id,
      exercises: await this.catalog(),
      now: this.now(),
    });
  }

  /** Opens the proposal phase. The model then builds a plan from the brief. */
  async requestPlanProposal(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run("request_onboarding_plan", raw, async (input) => {
      const { record, principal } = await this.open(input, context);
      this.assertRevision(record, input.expected_revision);
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(record),
          token: null,
          replayed: true,
        };
      const stored = await this.commit(
        record,
        { type: "REQUEST_PLAN" },
        {
          principal,
          operationId: input.request_id,
          auditEvent: "ONBOARDING_PLAN_REQUESTED",
        },
      );
      return { state: await this.project(stored), token: null };
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
    return this.run("submit_onboarding_plan_proposal", raw, async (input) => {
      const { record, principal } = await this.open(input, context);
      this.assertRevision(record, input.expected_revision);
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(record),
          token: null,
          replayed: true,
        };
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
      // reconciles in the plan ledger instead of creating a second draft.
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
          sessions: input.sessions,
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
      return { state: await this.project(stored), token: null };
    });
  }

  /** The referenced draft with its plan-service validation. */
  async getPlan(raw: unknown, context?: unknown) {
    const input = OnboardingToolInputs.get_onboarding_plan.parse(raw);
    const { record } = await this.open(input, context);
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
   * What it does *not* mean: the plan is live anywhere. Nothing is activated and
   * no Google file is touched — that is Task 007's provisioning step. On success
   * the setup moves on to `AWAITING_GOOGLE_CONNECTION`, because the release is
   * the user's last action in this phase and a second button that only repeats
   * it would be a sham interaction.
   */
  async confirmPlan(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run("confirm_onboarding_plan", raw, async (input) => {
      const { record, principal } = await this.open(input, context);
      this.assertRevision(record, input.expected_revision);
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(record),
          token: null,
          replayed: true,
        };
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
      // documented path PLAN_CONFIRMED -> AWAITING_GOOGLE_CONNECTION holds.
      const stored = await this.commit(
        confirmed,
        { type: "PREPARE_HANDOFF" },
        {
          principal,
          operationId: `${input.request_id}:handoff`,
          auditEvent: "ONBOARDING_HANDOFF_PREPARED",
        },
      );
      return { state: await this.project(stored), token: null };
    });
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
    return this.run("revise_onboarding_plan", raw, async (input) => {
      const { record, principal } = await this.open(input, context);
      this.assertRevision(record, input.expected_revision);
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(record),
          token: null,
          replayed: true,
        };
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
      return { state: await this.project(stored), token: null };
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
  async prepareGoogleHandoff(
    raw: unknown,
    context?: unknown,
  ): Promise<{ handoff: OnboardingHandoff; state: OnboardingState }> {
    const input = OnboardingToolInputs.get_onboarding_handoff.parse(raw);
    const { record, principal } = await this.open(input, context);
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
      handoff.status === "ready_for_google_connection" &&
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

  /** Trusted provisioning boundary; never registered as a client-callable tool. */
  async completeProvisioning(
    claim: { onboarding_session_id: string; session_token: string },
    binding: string,
    context: unknown,
  ): Promise<void> {
    const { record, principal } = await this.open(claim, context);
    if (record.session.status === "COMPLETED") return;
    const confirmed = record.session.confirmed_plan_reference;
    if (
      !this.options.googleConnectionAvailable ||
      !confirmed ||
      isExpired(record.session, this.clock()) ||
      oauthStateBinding(record, confirmed.row_revision) !== binding ||
      record.session.profile.revision !== confirmed.profile_revision
    )
      throw fail(
        "HANDOFF_SUPERSEDED",
        "Die Planbestätigung ist nicht mehr gültig.",
      );
    await this.commit(
      record,
      { type: "GOOGLE_CONNECTED", provisioning_verified: true },
      {
        principal,
        operationId: `provision-${binding}`,
        auditEvent: "ONBOARDING_COMPLETED",
        mutate: (next) => ({
          ...next,
          session: { ...next.session, handoff_status: "completed" },
        }),
      },
    );
  }

  /** Ends a setup deliberately. Always possible, never an error. */
  async cancelOnboarding(
    raw: unknown,
    context?: unknown,
  ): Promise<OnboardingResponse> {
    return this.run("cancel_onboarding", raw, async (input) => {
      const { record, principal } = await this.open(input, context);
      if (this.replay(record, input.request_id))
        return {
          state: await this.project(record),
          token: null,
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
      return { state: await this.project(stored), token: null };
    });
  }

  /* ---------------------------------------------------------------- helpers */

  private assertRevision(record: OnboardingRecord, expected?: number) {
    if (expected !== undefined && record.session.revision !== expected)
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
    action: (
      input: ReturnType<(typeof OnboardingToolInputs)[K]["parse"]>,
    ) => Promise<{
      state: OnboardingState;
      token: string | null;
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
      await this.options.beforeMutation?.();
      const { state, token, replayed } = await action(input);
      return OnboardingResponseSchema.parse({
        ok: true,
        operation,
        request_id: requestId,
        replayed: replayed ?? false,
        state,
        session_token: token,
        error: null,
      });
    } catch (error) {
      const failure = this.normalize(error);
      // Best effort: show the caller the state that actually stands, so a
      // refusal is informative. A state we cannot read is reported as null
      // rather than guessed.
      let state: OnboardingState | null = null;
      try {
        if (
          raw &&
          typeof raw === "object" &&
          "onboarding_session_id" in raw &&
          "session_token" in raw
        ) {
          const { record } = await this.open(
            raw as { onboarding_session_id: string; session_token: string },
            undefined,
          );
          state = await this.project(record);
        }
      } catch {
        /* an unauthorized or unknown session reveals nothing */
      }
      return {
        ok: false,
        operation,
        request_id: requestId,
        replayed: false,
        state,
        session_token: null,
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
    if (isGoogleReauthRequired(error))
      return new OnboardingError(
        GOOGLE_REAUTH_REQUIRED,
        GOOGLE_REAUTH_MESSAGE,
        false,
      );
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
  HANDOFF_STATUSES.filter((status) => status === "ready_for_google_connection");
