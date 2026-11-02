/**
 * `TrainingPlanService` — the one place that changes a training plan.
 *
 * Every plan mutation in the product, whether it arrives from a ChatGPT turn or
 * from a click in the editor, goes through `execute`. The MCP tools are thin
 * wrappers and the React app has no plan logic of its own, so a rule written
 * here cannot be bypassed by a UI that forgot about it.
 *
 * The invariants this service is responsible for:
 *
 *   - a new plan is always a draft, and activation is always a separate step
 *     carrying an explicit confirmation of one version *and* one revision;
 *   - an activated or archived version is never edited; changing it means
 *     deriving a new draft;
 *   - at most one version is active, enforced by archiving the previous one in
 *     the same atomic batch as the activation;
 *   - completed and running workouts keep the plan version they were recorded
 *     against — this service never writes to WORKOUTS or SETS at all;
 *   - success is reported only after the data contract held and the change,
 *     its audit events and its receipt were stored in one transaction.
 *
 * Writes run in the fixture profile and against the database
 * (src/server/db).
 */
import { recoveryFor } from "../../shared/write-recovery.js";
import {
  ARNOLD_SCHEMA_VERSION,
  ArnoldExerciseSchema,
  type ArnoldDataset,
  type ArnoldExercise,
  type ArnoldPlanVersion,
} from "../../shared/arnold-schema-v1.js";
import {
  PLAN_CONTRACT,
  PLAN_SCHEMA_LIMITS,
  PlanWriteInputs,
  PlanWriteResponseSchema,
  type PlanChange,
  type PlanContext,
  type PlanHistory,
  type PlanSchemaLimit,
  type PlanValidationResult,
  type PlanVersionComparison,
  type PlanWriteOperation,
  type PlanWriteResponse,
  type PlanWriteResult,
  type TrainingPlanList,
  type TrainingPlanVersion,
} from "../../shared/plan-contract.js";
import {
  fingerprint,
  type Actor,
  type ArnoldStore,
  type AuditEvent,
  type AuthorizationGuard,
  type EntityChange,
  type Permission,
  type WriteMode,
} from "../workout/infrastructure.js";
import { commitWrite, type CommitPlan } from "./commit.js";
import { comparePlanVersions, diffVersions } from "./comparison.js";
import {
  activePlan,
  draftPlans,
  exerciseOptions,
  findPlan,
  isReusable,
  projectFamilies,
  projectVersion,
  summarizeVersion,
  canTransition,
} from "./domain.js";
import { PlanError, planError, toPlanError } from "./errors.js";

/** The user's own exercises created alongside a new plan (B11). */
interface OwnExercises {
  changes: EntityChange[];
  audit: AuditEvent[];
  dataset?: ArnoldDataset;
  input?: Record<string, unknown>;
}
import { validateProjection, validatePlanVersion } from "./validation.js";
import {
  applyEdit,
  buildNewPlan,
  deriveDraft,
  finalizeModel,
  loadModel,
  type DraftModel,
  type EditContext,
} from "./versioning.js";

export interface PlanServiceOptions {
  mode: WriteMode;
  trackerId: string;
  store: ArnoldStore;
  authorization: AuthorizationGuard;
  clock?: () => Date;
  id?: () => string;
}

/** Top-level audit event per operation. */
const TOP_EVENT = {
  create_training_plan: "PLAN_CREATED",
  create_plan_version: "PLAN_DRAFT_CREATED",
  update_plan_draft: "PLAN_DRAFT_UPDATED",
  activate_training_plan: "PLAN_ACTIVATED",
  archive_plan_draft: "PLAN_DRAFT_ARCHIVED",
} as const satisfies Record<PlanWriteOperation, AuditEvent["event_type"]>;

/** A plan change becomes an entity-level audit event, where one exists. */
const CHANGE_EVENT: Partial<
  Record<
    PlanChange["kind"],
    { event: AuditEvent["event_type"]; entity: "session" | "item" }
  >
> = {
  session_added: { event: "SESSION_ADDED", entity: "session" },
  session_removed: { event: "SESSION_REMOVED", entity: "session" },
  session_renamed: { event: "SESSION_UPDATED", entity: "session" },
  session_reordered: { event: "SESSION_UPDATED", entity: "session" },
  exercise_added: { event: "PLAN_EXERCISE_ADDED", entity: "item" },
  exercise_removed: { event: "PLAN_EXERCISE_REMOVED", entity: "item" },
  exercise_replaced: { event: "PLAN_EXERCISE_REPLACED", entity: "item" },
};

export class TrainingPlanService {
  readonly mode: WriteMode;

  constructor(private options: PlanServiceOptions) {
    this.mode = options.mode;
    if (this.mode !== "disabled" && this.mode !== options.store.kind)
      throw planError(
        "PERMISSION_DENIED",
        "Schreibmodus passt nicht zum Speicher.",
      );
  }

  /** The verified principal, or a refusal. Capabilities always fail closed. */
  async actor(
    context: unknown,
    permission: Permission = "write",
  ): Promise<Actor> {
    if (this.mode === "disabled")
      throw planError("PERMISSION_DENIED", "Planänderungen sind deaktiviert.");
    const actor = await this.options.authorization.authorize(
      this.options.trackerId,
      permission,
      context,
    );
    if (!actor?.verified || !actor.subject)
      throw planError(
        "AUTH_REQUIRED",
        "Geprüfte Nutzeridentität erforderlich.",
      );
    if (
      actor.trackerId !== this.options.trackerId ||
      !actor.permissions.includes(permission) ||
      actor.kind !== (this.mode === "database" ? "authenticated" : "fixture")
    )
      throw planError(
        "PERMISSION_DENIED",
        "Keine Berechtigung für diesen Tracker oder Vorgang.",
      );
    return actor;
  }

  private now() {
    return (this.options.clock?.() ?? new Date()).toISOString();
  }

  private newId(): string {
    return this.options.id?.() ?? crypto.randomUUID();
  }

  private catalog(dataset: ArnoldDataset): ReadonlyMap<string, ArnoldExercise> {
    return new Map(dataset.exercises.map((row) => [row.exercise_id, row]));
  }

  private limitsFor(version: TrainingPlanVersion): PlanSchemaLimit[] {
    return PLAN_SCHEMA_LIMITS.filter(
      (limit) =>
        limit !== "EMPTY_SESSION_NOT_PERSISTABLE" ||
        version.sessions.some(
          (session) => !session.exercises.some((e) => e.status === "active"),
        ),
    );
  }

  /* ------------------------------------------------------------------ reads */

  /** One version, projected. Without an id: the active plan, else the newest draft. */
  async getPlan(
    input: { plan_version_id?: string; include_removed?: boolean } = {},
  ): Promise<{
    plan: TrainingPlanVersion;
    validation: PlanValidationResult | null;
  }> {
    const dataset = await this.options.store.read();
    const plan = input.plan_version_id
      ? findPlan(dataset, input.plan_version_id)
      : (activePlan(dataset) ?? draftPlans(dataset)[0]);
    if (!plan)
      throw planError(
        input.plan_version_id ? "PLAN_VERSION_NOT_FOUND" : "PLAN_NOT_FOUND",
        input.plan_version_id
          ? "Diese Planversion existiert nicht."
          : "Für diesen Tracker ist noch kein Trainingsplan hinterlegt.",
      );
    const version = projectVersion(dataset, plan, {
      includeRemoved: input.include_removed,
    });
    return {
      plan: version,
      validation:
        plan.status === "draft"
          ? validateProjection(version, this.catalog(dataset))
          : null,
    };
  }

  async list(
    input: {
      statuses?: readonly ArnoldPlanVersion["status"][];
      plan_family_id?: string;
    } = {},
  ): Promise<TrainingPlanList> {
    const dataset = await this.options.store.read();
    const families = projectFamilies(dataset)
      .filter(
        (family) =>
          !input.plan_family_id ||
          family.plan_family_id === input.plan_family_id,
      )
      .map((family) => ({
        ...family,
        versions: family.versions.filter(
          (version) =>
            !input.statuses || input.statuses.includes(version.status),
        ),
      }))
      .filter((family) => family.versions.length > 0);
    return {
      plan_contract: PLAN_CONTRACT,
      active_plan_version_id: activePlan(dataset)?.plan_version_id ?? null,
      families,
      total_versions: families.reduce(
        (total, family) => total + family.versions.length,
        0,
      ),
    };
  }

  /**
   * The history, newest first, with the distance to the currently active plan.
   *
   * The difference count is what makes a history useful: "Version 1 — 4
   * Unterschiede zum aktuellen Plan" is actionable, a bare list of dates is not.
   */
  async history(input: { plan_family_id?: string } = {}): Promise<PlanHistory> {
    const dataset = await this.options.store.read();
    const active = activePlan(dataset);
    const activeProjection = active ? projectVersion(dataset, active) : null;
    const plans = dataset.plans
      .filter(
        (plan) =>
          !input.plan_family_id || plan.plan_family_id === input.plan_family_id,
      )
      .sort((a, b) => {
        const left = a.activated_at_utc ?? a.created_at_utc;
        const right = b.activated_at_utc ?? b.created_at_utc;
        if (left !== right) return left < right ? 1 : -1;
        return b.version_no - a.version_no;
      });
    return {
      plan_contract: PLAN_CONTRACT,
      active_plan_version_id: active?.plan_version_id ?? null,
      entries: plans.map((plan) => ({
        version: summarizeVersion(dataset, plan),
        change_count_vs_active:
          activeProjection && plan.plan_version_id !== active?.plan_version_id
            ? diffVersions(projectVersion(dataset, plan), activeProjection)
                .length
            : null,
        reusable: isReusable(plan),
      })),
    };
  }

  async validate(input: {
    plan_version_id: string;
  }): Promise<PlanValidationResult> {
    const dataset = await this.options.store.read();
    const result = validatePlanVersion(dataset, input.plan_version_id);
    if (!result)
      throw planError(
        "PLAN_VERSION_NOT_FOUND",
        "Diese Planversion existiert nicht.",
      );
    return result;
  }

  async compare(input: {
    from_plan_version_id: string;
    to_plan_version_id: string;
  }): Promise<PlanVersionComparison> {
    const dataset = await this.options.store.read();
    const from = findPlan(dataset, input.from_plan_version_id);
    const to = findPlan(dataset, input.to_plan_version_id);
    if (!from || !to)
      throw planError(
        "PLAN_VERSION_NOT_FOUND",
        "Mindestens eine der beiden Planversionen existiert nicht.",
      );
    return comparePlanVersions(
      projectVersion(dataset, from),
      projectVersion(dataset, to),
      {
        from: summarizeVersion(dataset, from),
        to: summarizeVersion(dataset, to),
      },
    );
  }

  /** Everything the editor needs for one render. */
  async context(
    input: { plan_version_id?: string } = {},
    actorContext?: unknown,
  ): Promise<PlanContext> {
    const dataset = await this.options.store.read();
    let canWrite = false;
    try {
      await this.actor(actorContext);
      canWrite = true;
    } catch {
      /* capabilities fail closed */
    }
    const active = activePlan(dataset);
    const drafts = draftPlans(dataset);
    // Without an explicit id the editor opens on the *active* plan, never on a
    // draft: the user's starting point is what they train by today. Open drafts
    // are offered separately, so "Bearbeiten" continues one instead of creating
    // another.
    const selected = input.plan_version_id
      ? findPlan(dataset, input.plan_version_id)
      : (active ?? drafts[0]);
    if (input.plan_version_id && !selected)
      throw planError(
        "PLAN_VERSION_NOT_FOUND",
        "Diese Planversion existiert nicht.",
      );
    const version = selected ? projectVersion(dataset, selected) : null;
    return {
      plan_contract: PLAN_CONTRACT,
      tracker_id: dataset.config.tracker_id,
      schema_version: ARNOLD_SCHEMA_VERSION,
      plan: version,
      active_plan_version_id: active?.plan_version_id ?? null,
      drafts: drafts.map((plan) => summarizeVersion(dataset, plan)),
      families: projectFamilies(dataset),
      exercises: exerciseOptions(dataset),
      validation:
        version && version.status === "draft"
          ? validateProjection(version, this.catalog(dataset))
          : null,
      write_mode: this.mode,
      can_write: canWrite,
      schema_limits: version
        ? this.limitsFor(version)
        : [...PLAN_SCHEMA_LIMITS].filter(
            (limit) => limit !== "EMPTY_SESSION_NOT_PERSISTABLE",
          ),
      generated_at: this.now(),
    };
  }

  /* ----------------------------------------------------------------- writes */

  async execute(
    operation: PlanWriteOperation,
    raw: unknown,
    context?: unknown,
  ): Promise<PlanWriteResponse> {
    const requestId =
      raw &&
      typeof raw === "object" &&
      "request_id" in raw &&
      typeof raw.request_id === "string"
        ? raw.request_id
        : "";
    try {
      const actor = await this.actor(context);
      const input = PlanWriteInputs[operation].parse(raw);
      const outcome = await commitWrite<PlanWriteResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId: input.request_id,
        fingerprint: fingerprint({ operation, input }),
        actorSubject: actor.subject,
        clock: this.options.clock ?? (() => new Date()),
        build: (dataset, now) =>
          this.build(operation, input, dataset, actor, now),
      });
      return PlanWriteResponseSchema.parse({
        ok: true,
        operation,
        request_id: input.request_id,
        replayed: outcome.replayed,
        result: outcome.result,
        error: null,
      });
    } catch (error) {
      const failure = toPlanError(error);
      return {
        ok: false,
        operation,
        request_id: requestId,
        replayed: false,
        result: null,
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

  /**
   * Builds the row changes, the result and the audit trail for one operation.
   *
   * Runs inside the tracker lock with the dataset as just read, so every check
   * here is made against the state the write will actually be applied to.
   */
  private build(
    operation: PlanWriteOperation,
    input: Record<string, unknown>,
    dataset: ArnoldDataset,
    actor: Actor,
    now: string,
  ): CommitPlan<PlanWriteResult> {
    const warnings: string[] = [];
    // B11: the user's own exercises are created in the same write as the plan.
    let ownExercises: OwnExercises = { changes: [], audit: [] };
    if (operation === "create_training_plan") {
      ownExercises = this.ownExercises(input, dataset, actor, now);
      if (ownExercises.dataset) dataset = ownExercises.dataset;
      if (ownExercises.input) input = ownExercises.input;
      if (ownExercises.changes.length)
        warnings.push(
          `${ownExercises.changes.length} eigene Übung(en) angelegt. Gerät, Muskel und Lastbasis bei Bedarf im Plan-Editor ergänzen.`,
        );
    }
    const ctx: EditContext = { dataset, now, id: () => this.newId() };

    if (
      operation === "activate_training_plan" ||
      operation === "archive_plan_draft"
    )
      return this.buildLifecycle(operation, input, dataset, actor, now);

    let model: DraftModel;
    let basedOn: string | null = null;
    let changeSource: TrainingPlanVersion | null = null;

    if (operation === "create_training_plan") {
      const parsed = PlanWriteInputs.create_training_plan.parse(input);
      model = buildNewPlan(ctx, parsed);
      if (parsed.origin === "ai_proposal")
        warnings.push(
          "Der Planvorschlag wurde als Entwurf gespeichert. Er wird erst nach ausdrücklicher Bestätigung aktiviert.",
        );
    } else if (operation === "create_plan_version") {
      const parsed = PlanWriteInputs.create_plan_version.parse(input);
      const source = findPlan(dataset, parsed.source_plan_version_id);
      if (!source)
        throw planError(
          "PLAN_VERSION_NOT_FOUND",
          "Die Quell-Planversion existiert nicht.",
        );
      model = deriveDraft(ctx, source, {
        asNewFamily: parsed.as_new_family,
        name: parsed.name,
      });
      basedOn = source.plan_version_id;
      changeSource = projectVersion(dataset, source);
      if (!model.sessionOrder.length)
        throw planError(
          "VALIDATION_ERROR",
          "Die Quell-Planversion enthält keine aktive Übung und kann nicht als Grundlage dienen.",
        );
    } else {
      const parsed = PlanWriteInputs.update_plan_draft.parse(input);
      const plan = findPlan(dataset, parsed.plan_version_id);
      if (!plan)
        throw planError(
          "PLAN_VERSION_NOT_FOUND",
          "Diese Planversion existiert nicht.",
        );
      if (plan.status !== "draft")
        throw planError(
          "PLAN_NOT_EDITABLE",
          `Eine Planversion mit dem Status "${plan.status}" wird nicht verändert. Erstelle mit create_plan_version eine neue Draft-Version.`,
        );
      this.assertRevision(plan, parsed.expected_row_revision);
      changeSource = projectVersion(dataset, plan);
      model = loadModel(dataset, plan);
      for (const edit of parsed.edits) applyEdit(model, edit, ctx);
      basedOn = null;
    }

    // Duplicate version numbers inside a family are rejected before any write,
    // on top of the dataset-level uniqueness check.
    if (
      !model.planOriginal &&
      dataset.plans.some(
        (plan) =>
          plan.plan_family_id === model.plan.plan_family_id &&
          plan.version_no === model.plan.version_no,
      )
    )
      throw planError(
        "VERSION_NUMBER_CONFLICT",
        "Diese Versionsnummer ist in der Planfamilie bereits vergeben. Den Vorgang mit aktuellen Daten wiederholen.",
      );

    const changes = finalizeModel(model, now);
    const projected = this.projectModel(dataset, model);
    const validation = validateProjection(projected, this.catalog(dataset));
    // A draft may be saved while incomplete — that is the point of a draft —
    // but a structurally impossible draft is refused outright.
    const blocking = validation.errors.filter(
      (issue) =>
        issue.code === "UNKNOWN_EXERCISE" ||
        issue.code === "DUPLICATE_PLAN_ITEM_ID" ||
        issue.code === "DUPLICATE_SESSION_ORDER" ||
        issue.code === "DUPLICATE_EXERCISE_ORDER" ||
        issue.code === "INCONSISTENT_SESSION" ||
        issue.code === "INVALID_REP_RANGE" ||
        issue.code === "INVALID_SET_COUNT" ||
        issue.code === "INVALID_TARGET_LOAD" ||
        issue.code === "INVALID_EXECUTION" ||
        issue.code === "INVALID_REST" ||
        issue.code === "LOAD_BASIS_MISMATCH",
    );
    if (blocking.length)
      throw planError(
        "VALIDATION_ERROR",
        blocking[0].message,
        blocking.map((issue) => `${issue.code}: ${issue.message}`),
      );

    const planChanges = changeSource
      ? diffVersions(changeSource, projected)
      : [];
    const result: PlanWriteResult = {
      plan: {
        version: projected,
        based_on_plan_version_id: basedOn,
        schema_limits: this.limitsFor(projected),
      },
      activation: null,
      validation,
      changes: planChanges,
      warnings,
      schema_limits: this.limitsFor(projected),
    };
    return {
      changes: [...ownExercises.changes, ...changes],
      result,
      audit: [
        ...ownExercises.audit,
        ...this.auditFor(operation, input, model, planChanges, actor, now),
      ],
    };
  }

  /**
   * Resolves `custom:` keys in a new plan to exercise ids.
   *
   * An exercise with the same name (German or English, ignoring case and
   * accents) or the same family key is reused; otherwise a new active
   * exercise is created with conservative defaults. Only referenced keys are
   * created, and a referenced key without a description is refused.
   */
  private ownExercises(
    input: Record<string, unknown>,
    dataset: ArnoldDataset,
    actor: Actor,
    now: string,
  ): OwnExercises {
    const parsed = PlanWriteInputs.create_training_plan.parse(input);
    const declared = parsed.custom_exercises ?? [];
    const referenced = new Set(
      parsed.sessions.flatMap((session) =>
        session.exercises
          .map((exercise) => exercise.exercise_id)
          .filter((id) => id.startsWith("custom:")),
      ),
    );
    if (!declared.length && !referenced.size) return { changes: [], audit: [] };
    const byKey = new Map<string, (typeof declared)[number]>();
    for (const exercise of declared) {
      if (byKey.has(exercise.key))
        throw planError(
          "VALIDATION_ERROR",
          `Der Schlüssel ${exercise.key} ist in custom_exercises doppelt vergeben.`,
        );
      byKey.set(exercise.key, exercise);
    }
    const missing = [...referenced].filter((key) => !byKey.has(key));
    if (missing.length)
      throw planError(
        "EXERCISE_NOT_FOUND",
        "Eine eigene Übung wird in einer Einheit verwendet, ist aber nicht in custom_exercises beschrieben.",
        missing,
      );

    const fold = (value: string) =>
      value
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const slug = (value: string) => fold(value).replace(/ /g, "-") || "eigene";
    const exercises = [...dataset.exercises];
    const mapping = new Map<string, string>();
    const changes: EntityChange[] = [];
    const audit: AuditEvent[] = [];
    for (const key of referenced) {
      const own = byKey.get(key)!;
      const name = fold(own.name_de);
      const family = slug(own.name_de);
      const existing = exercises.find(
        (exercise) =>
          exercise.status === "active" &&
          ([exercise.name_de, exercise.name_en].some(
            (label) => label !== null && fold(label) === name,
          ) ||
            exercise.family_key === family),
      );
      if (existing) {
        mapping.set(key, existing.exercise_id);
        continue;
      }
      const mode = own.default_execution_mode ?? "bilateral_simultaneous";
      const count = own.default_implement_count ?? 1;
      if (
        (mode === "unilateral" && count !== 1) ||
        (mode === "alternating" && count > 2)
      )
        throw planError(
          "VALIDATION_ERROR",
          `Die Angaben zur eigenen Übung „${own.name_de}“ widersprechen sich (Ausführung und Geräteanzahl).`,
        );
      const row = ArnoldExerciseSchema.parse({
        exercise_id: this.newId(),
        name_de: own.name_de,
        name_en: null,
        family_key: family,
        variant_key: "eigene",
        equipment: own.equipment ?? "nicht angegeben",
        primary_muscle: own.primary_muscle ?? "nicht angegeben",
        default_load_basis: own.default_load_basis ?? "total",
        default_execution_mode: mode,
        default_implement_count: count,
        status: "active",
        created_at_utc: now,
        updated_at_utc: now,
        row_revision: 1,
      });
      exercises.push(row);
      mapping.set(key, row.exercise_id);
      changes.push({ table: "exercises", before: null, after: row });
      audit.push(
        this.event(
          "EXERCISE_CREATED",
          row.exercise_id,
          String(input.request_id),
          actor,
          now,
          {
            previous: null,
            next: 1,
            fields: { name_de: { before: null, after: row.name_de } },
          },
        ),
      );
    }
    return {
      changes,
      audit,
      dataset: changes.length ? { ...dataset, exercises } : undefined,
      input: {
        ...input,
        sessions: parsed.sessions.map((session) => ({
          ...session,
          exercises: session.exercises.map((exercise) => ({
            ...exercise,
            exercise_id:
              mapping.get(exercise.exercise_id) ?? exercise.exercise_id,
          })),
        })),
      },
    };
  }

  /** Activation and discarding: the two lifecycle transitions. */
  private buildLifecycle(
    operation: "activate_training_plan" | "archive_plan_draft",
    input: Record<string, unknown>,
    dataset: ArnoldDataset,
    actor: Actor,
    now: string,
  ): CommitPlan<PlanWriteResult> {
    const parsed =
      operation === "activate_training_plan"
        ? PlanWriteInputs.activate_training_plan.parse(input)
        : PlanWriteInputs.archive_plan_draft.parse(input);
    const plan = findPlan(dataset, parsed.plan_version_id);
    if (!plan)
      throw planError(
        "PLAN_VERSION_NOT_FOUND",
        "Diese Planversion existiert nicht.",
      );
    const target =
      operation === "activate_training_plan" ? "active" : "archived";
    if (
      (operation === "archive_plan_draft" && plan.status !== "draft") ||
      !canTransition(plan.status, target)
    )
      throw planError(
        "INVALID_STATUS_TRANSITION",
        `Der Übergang von "${plan.status}" nach "${target}" ist nicht zulässig.`,
      );
    this.assertRevision(plan, parsed.expected_row_revision);

    const changes: EntityChange[] = [];
    const audit: AuditEvent[] = [];
    const projected = projectVersion(dataset, plan);
    const validation = validateProjection(projected, this.catalog(dataset));

    if (operation === "archive_plan_draft") {
      // A never-activated draft cannot be stored as `archived` without an
      // activation timestamp, so a zero-length window records the discard
      // without ever counting as a plan that was in force. See the schema
      // limits section of the contract document.
      const after = {
        ...plan,
        status: "archived" as const,
        activated_at_utc: now,
        retired_at_utc: now,
        updated_at_utc: now,
        row_revision: plan.row_revision + 1,
      };
      changes.push({ table: "plans", before: plan, after });
      audit.push(
        this.event(
          "PLAN_DRAFT_ARCHIVED",
          plan.plan_version_id,
          parsed.request_id,
          actor,
          now,
          {
            previous: plan.row_revision,
            next: after.row_revision,
            fields: { status: { before: "draft", after: "archived" } },
            reason: "reason" in parsed && parsed.reason ? parsed.reason : null,
          },
        ),
      );
      return {
        changes,
        result: {
          plan: {
            version: { ...projected, status: "archived", editable: false },
            based_on_plan_version_id: null,
            schema_limits: this.limitsFor(projected),
          },
          activation: null,
          validation: null,
          changes: [],
          warnings: [
            "Der Entwurf wurde verworfen. Da PLANS keinen eigenen Verwurfs-Status kennt, ist er als archivierte Version mit identischem Aktivierungs- und Archivierungszeitpunkt hinterlegt und gilt damit nie als aktiv gewesen.",
          ],
          schema_limits: this.limitsFor(projected),
        },
        audit,
      };
    }

    // Re-read from the activation schema: the archive branch above has already
    // returned, so only an activation payload can reach this point.
    const { confirmation } =
      PlanWriteInputs.activate_training_plan.parse(input);
    if (
      confirmation.plan_version_id !== plan.plan_version_id ||
      confirmation.row_revision !== plan.row_revision
    )
      throw planError(
        "STALE_CONFIRMATION",
        "Die Bestätigung gehört zu einer anderen Planversion oder zu einem älteren Stand. Den Plan erneut prüfen und bestätigen.",
        [
          `confirmed_plan_version_id=${confirmation.plan_version_id}`,
          `confirmed_row_revision=${confirmation.row_revision}`,
          `current_row_revision=${plan.row_revision}`,
        ],
      );
    if (!validation.valid)
      throw planError(
        "PLAN_INVALID",
        "Dieser Entwurf ist nicht aktivierbar.",
        validation.errors.map((issue) => `${issue.code}: ${issue.message}`),
      );

    // The previously active version is archived in the same batch, so there is
    // no instant in which two versions are active, and none in which none is.
    const previous = activePlan(dataset);
    let archivedAt: string | null = null;
    if (previous && previous.plan_version_id !== plan.plan_version_id) {
      const retired = {
        ...previous,
        status: "archived" as const,
        retired_at_utc: now,
        updated_at_utc: now,
        row_revision: previous.row_revision + 1,
      };
      changes.push({ table: "plans", before: previous, after: retired });
      archivedAt = now;
      audit.push(
        this.event(
          "PLAN_ARCHIVED",
          previous.plan_version_id,
          parsed.request_id,
          actor,
          now,
          {
            previous: previous.row_revision,
            next: retired.row_revision,
            fields: {
              status: { before: previous.status, after: "archived" },
              retired_at_utc: { before: previous.retired_at_utc, after: now },
            },
          },
        ),
      );
    }
    const activated = {
      ...plan,
      status: "active" as const,
      activated_at_utc: now,
      updated_at_utc: now,
      row_revision: plan.row_revision + 1,
    };
    changes.push({ table: "plans", before: plan, after: activated });
    audit.push(
      this.event(
        "PLAN_ACTIVATED",
        plan.plan_version_id,
        parsed.request_id,
        actor,
        now,
        {
          previous: plan.row_revision,
          next: activated.row_revision,
          fields: {
            status: { before: "draft", after: "active" },
            activated_at_utc: { before: null, after: now },
          },
        },
      ),
    );
    audit.push(
      this.event(
        "PLAN_VALIDATED",
        plan.plan_version_id,
        parsed.request_id,
        actor,
        now,
        {
          previous: plan.row_revision,
          next: activated.row_revision,
          fields: {
            confirmed_row_revision: {
              before: null,
              after: confirmation.row_revision,
            },
          },
        },
      ),
    );

    return {
      changes,
      result: {
        plan: {
          version: {
            ...projected,
            status: "active",
            activated_at_utc: now,
            updated_at_utc: now,
            row_revision: activated.row_revision,
            editable: false,
          },
          based_on_plan_version_id: null,
          schema_limits: this.limitsFor(projected),
        },
        activation: {
          plan_version_id: plan.plan_version_id,
          plan_family_id: plan.plan_family_id,
          version_no: plan.version_no,
          activated_at_utc: now,
          row_revision: activated.row_revision,
          archived_plan_version_id:
            previous && previous.plan_version_id !== plan.plan_version_id
              ? previous.plan_version_id
              : null,
          archived_at_utc: archivedAt,
          verified: true,
        },
        validation: { ...validation, status: "active", activatable: false },
        changes: [],
        warnings: [],
        schema_limits: this.limitsFor(projected),
      },
      audit,
    };
  }

  private assertRevision(plan: ArnoldPlanVersion, expected: number) {
    if (plan.row_revision !== expected)
      throw planError(
        "REVISION_CONFLICT",
        "Dieser Plan wurde zwischenzeitlich verändert. Erneut laden und die Änderung noch einmal prüfen.",
        [`current_row_revision=${plan.row_revision}`],
      );
  }

  /** Projects the finished model without writing it, for validation and output. */
  private projectModel(
    dataset: ArnoldDataset,
    model: DraftModel,
  ): TrainingPlanVersion {
    const candidate: ArnoldDataset = {
      ...dataset,
      plans: [
        ...dataset.plans.filter(
          (plan) => plan.plan_version_id !== model.plan.plan_version_id,
        ),
        model.plan,
      ],
      planItems: [
        ...dataset.planItems.filter(
          (item) => item.plan_version_id !== model.plan.plan_version_id,
        ),
        ...[...model.items.values()].map((state) => state.current),
      ],
    };
    return projectVersion(candidate, model.plan);
  }

  private event(
    event_type: AuditEvent["event_type"],
    entity_id: string,
    operation_id: string,
    actor: Actor,
    at: string,
    detail: {
      previous: number | null;
      next: number;
      fields: Record<string, { before: unknown; after: unknown }>;
      reason?: string | null;
    },
  ): AuditEvent {
    return {
      operation_id,
      event_type,
      entity_id,
      at,
      actor: actor.subject,
      previous_revision: detail.previous,
      new_revision: detail.next,
      result: "verified",
      changed_fields: Object.keys(detail.fields),
      correction_reason: detail.reason ?? null,
      changes: detail.fields,
    };
  }

  /**
   * The audit trail for a content operation.
   *
   * One top-level event for the version plus one per affected session and
   * position. Events are merged per (type, entity) because the audit log
   * deduplicates on that key, so two changes to the same session must arrive as
   * one event with both fields rather than one overwriting the other.
   */
  private auditFor(
    operation: PlanWriteOperation,
    input: Record<string, unknown>,
    model: DraftModel,
    changes: readonly PlanChange[],
    actor: Actor,
    now: string,
  ): AuditEvent[] {
    const operationId = String(input.request_id);
    const previous = model.planOriginal?.row_revision ?? null;
    const next = model.plan.row_revision;
    const fields: Record<string, { before: unknown; after: unknown }> = {};
    for (const change of changes)
      if (!CHANGE_EVENT[change.kind]) {
        // Changes without an entity-level event type (retargeting, reordering)
        // are recorded on the version itself, keyed so they stay traceable.
        const key = [
          change.plan_item_id ?? change.session_id ?? "plan",
          change.field ?? change.kind,
        ]
          .filter(Boolean)
          .join(".");
        fields[key] = { before: change.before, after: change.after };
      }
    if (!Object.keys(fields).length)
      fields.row_revision = { before: previous, after: next };

    const events = new Map<string, AuditEvent>();
    events.set(
      `${TOP_EVENT[operation]}:${model.plan.plan_version_id}`,
      this.event(
        TOP_EVENT[operation],
        model.plan.plan_version_id,
        operationId,
        actor,
        now,
        { previous, next, fields },
      ),
    );
    if (operation === "create_training_plan") {
      events.set(
        `PLAN_DRAFT_CREATED:${model.plan.plan_version_id}`,
        this.event(
          "PLAN_DRAFT_CREATED",
          model.plan.plan_version_id,
          operationId,
          actor,
          now,
          {
            previous,
            next,
            fields: { status: { before: null, after: "draft" } },
          },
        ),
      );
      // Creating a plan from scratch genuinely adds every session and position,
      // and there is no earlier version to diff against, so the entity events
      // come from the model itself. A version *derived* from another is one
      // logical copy and is covered by PLAN_DRAFT_CREATED alone.
      for (const sessionId of model.sessionOrder)
        events.set(
          `SESSION_ADDED:${sessionId}`,
          this.event("SESSION_ADDED", sessionId, operationId, actor, now, {
            previous,
            next,
            fields: {
              session_name: {
                before: null,
                after: model.sessionNames.get(sessionId),
              },
            },
          }),
        );
      for (const state of model.items.values())
        events.set(
          `PLAN_EXERCISE_ADDED:${state.current.plan_item_id}`,
          this.event(
            "PLAN_EXERCISE_ADDED",
            state.current.plan_item_id,
            operationId,
            actor,
            now,
            {
              previous,
              next,
              fields: {
                exercise_id: { before: null, after: state.current.exercise_id },
              },
            },
          ),
        );
    }

    for (const change of changes) {
      const mapped = CHANGE_EVENT[change.kind];
      if (!mapped) continue;
      const entity =
        mapped.entity === "session" ? change.session_id : change.plan_item_id;
      if (!entity) continue;
      const key = `${mapped.event}:${entity}`;
      const existing = events.get(key);
      const changed = {
        [change.field ?? change.kind]: {
          before: change.before,
          after: change.after,
        },
      };
      events.set(
        key,
        existing
          ? {
              ...existing,
              changed_fields: [
                ...new Set([
                  ...existing.changed_fields,
                  ...Object.keys(changed),
                ]),
              ],
              changes: { ...existing.changes, ...changed },
            }
          : this.event(mapped.event, entity, operationId, actor, now, {
              previous,
              next,
              fields: changed,
            }),
      );
    }
    return [...events.values()];
  }

  /* --------------------------------------------------------- named wrappers */

  createTrainingPlan(input: unknown, context?: unknown) {
    return this.execute("create_training_plan", input, context);
  }
  createPlanVersion(input: unknown, context?: unknown) {
    return this.execute("create_plan_version", input, context);
  }
  updatePlanDraft(input: unknown, context?: unknown) {
    return this.execute("update_plan_draft", input, context);
  }
  activateTrainingPlan(input: unknown, context?: unknown) {
    return this.execute("activate_training_plan", input, context);
  }
  archivePlanDraft(input: unknown, context?: unknown) {
    return this.execute("archive_plan_draft", input, context);
  }
}

export { PlanError };
