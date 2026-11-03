import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ArnoldBodyWeightSchema,
  ArnoldDatasetSchema,
  ArnoldExerciseSchema,
  ArnoldGoalSchema,
  ArnoldPlanItemSchema,
  ArnoldPlanVersionSchema,
  ArnoldSetSchema,
  ArnoldWorkoutSchema,
  type ArnoldBodyWeight,
  type ArnoldDataset,
  type ArnoldExercise,
  type ArnoldGoal,
  type ArnoldPlanItem,
  type ArnoldPlanVersion,
  type ArnoldSet,
  type ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import {
  WriteResultSchema,
  type WriteResult,
  type WriteErrorCode,
} from "../../shared/workout-contract.js";
import { PlanWriteResultSchema } from "../../shared/plan-contract.js";

export class WriteError extends Error {
  constructor(
    readonly code: WriteErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}
export type WriteMode = "disabled" | "fixture" | "database";
export type Permission = "write" | "correct_completed";
export interface Actor {
  subject: string;
  trackerId: string;
  permissions: readonly Permission[];
  verified: true;
  kind: "fixture" | "authenticated";
}
export interface AuthorizationGuard {
  authorize(
    trackerId: string,
    permission: Permission,
    context: unknown,
  ): Promise<Actor>;
}
export class DenyAuthorizationGuard implements AuthorizationGuard {
  async authorize(): Promise<Actor> {
    throw new WriteError(
      "AUTH_REQUIRED",
      "Geprüfte Nutzeridentität erforderlich.",
    );
  }
}
/** This identity only has meaning inside an isolated synthetic repository. */
export class FixtureAuthorizationGuard implements AuthorizationGuard {
  constructor(private trackerId: string) {}
  async authorize(trackerId: string): Promise<Actor> {
    if (trackerId !== this.trackerId)
      throw new WriteError("PERMISSION_DENIED", "Fremder Fixture-Tracker.");
    return {
      subject: "synthetic-fixture",
      trackerId,
      permissions: ["write", "correct_completed"],
      verified: true,
      kind: "fixture",
    };
  }
}
export interface WriteCoordinator {
  readonly scope: "process" | "distributed";
  exclusive<T>(trackerId: string, action: () => Promise<T>): Promise<T>;
}
export class InProcessWriteCoordinator implements WriteCoordinator {
  readonly scope = "process" as const;
  private tails = new Map<string, Promise<void>>();
  async exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
const ChangeSchema = z.discriminatedUnion("table", [
  z.object({
    table: z.literal("workouts"),
    before: ArnoldWorkoutSchema.nullable(),
    after: ArnoldWorkoutSchema,
  }),
  z.object({
    table: z.literal("sets"),
    before: ArnoldSetSchema.nullable(),
    after: ArnoldSetSchema,
  }),
  z.object({
    table: z.literal("exercises"),
    before: ArnoldExerciseSchema.nullable(),
    after: ArnoldExerciseSchema,
  }),
  z.object({
    table: z.literal("plans"),
    before: ArnoldPlanVersionSchema.nullable(),
    after: ArnoldPlanVersionSchema,
  }),
  z.object({
    table: z.literal("planItems"),
    before: ArnoldPlanItemSchema.nullable(),
    after: ArnoldPlanItemSchema,
  }),
  z.object({
    table: z.literal("goals"),
    before: ArnoldGoalSchema.nullable(),
    after: ArnoldGoalSchema,
  }),
  z.object({
    table: z.literal("bodyWeights"),
    before: ArnoldBodyWeightSchema.nullable(),
    after: ArnoldBodyWeightSchema,
  }),
]);
export type EntityChange = z.infer<typeof ChangeSchema>;
export type Entity =
  | ArnoldWorkout
  | ArnoldSet
  | ArnoldExercise
  | ArnoldPlanVersion
  | ArnoldPlanItem
  | ArnoldGoal
  | ArnoldBodyWeight;
/**
 * Order matters: a set also carries workout_id and plan_item_id, a plan item a
 * plan_version_id, a goal an exercise_id.
 */
export const entityId = (row: Entity): string =>
  "goal_id" in row
    ? row.goal_id
    : "body_weight_id" in row
      ? row.body_weight_id
      : "set_id" in row
        ? row.set_id
        : "workout_id" in row
          ? row.workout_id
          : "plan_item_id" in row
            ? row.plan_item_id
            : "plan_version_id" in row
              ? row.plan_version_id
              : row.exercise_id;
/** Stable canonical encoding; property order cannot change an operation fingerprint. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function uuid7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let time = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(time & 255n);
    time >>= 8n;
  }
  bytes[6] = (bytes[6] & 15) | 0x70;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const AuditEventSchema = z.object({
  operation_id: z.string(),
  event_type: z.enum([
    "WORKOUT_CREATED",
    "WORKOUT_COMPLETED",
    "WORKOUT_CANCELLED",
    "SET_CREATED",
    "SET_UPDATED",
    "SET_VOIDED",
    "EXERCISE_CREATED",
    // Goals and body weight. Values only, never free text.
    "GOAL_CREATED",
    "GOAL_UPDATED",
    "GOAL_ARCHIVED",
    "BODY_WEIGHT_LOGGED",
    "BODY_WEIGHT_VOIDED",
    // Task 005 plan lifecycle. Business-readable, with no personal data beyond the acting subject.
    "PLAN_CREATED",
    "PLAN_DRAFT_CREATED",
    "PLAN_DRAFT_UPDATED",
    "PLAN_DRAFT_ARCHIVED",
    "PLAN_VALIDATED",
    "PLAN_ACTIVATED",
    "PLAN_ARCHIVED",
    "SESSION_ADDED",
    "SESSION_UPDATED",
    "SESSION_REMOVED",
    "PLAN_EXERCISE_ADDED",
    "PLAN_EXERCISE_REPLACED",
    "PLAN_EXERCISE_REMOVED",
    // Task 006 onboarding. The entity is an onboarding session, never a person,
    // and no profile free text is ever recorded in an audit event.
    "ONBOARDING_STARTED",
    "ONBOARDING_RESUMED",
    "ONBOARDING_PROFILE_UPDATED",
    "ONBOARDING_PLAN_REQUESTED",
    "ONBOARDING_PLAN_PROPOSED",
    "ONBOARDING_PLAN_CONFIRMED",
    "ONBOARDING_PLAN_REVISION_REQUESTED",
    "ONBOARDING_CONFIRMATION_INVALIDATED",
    "ONBOARDING_HANDOFF_PREPARED",
    "ONBOARDING_COMPLETED",
    "ONBOARDING_CANCELLED",
    "ONBOARDING_EXPIRED",
  ]),
  entity_id: z.string(),
  at: z.string(),
  actor: z.string(),
  previous_revision: z.number().nullable(),
  new_revision: z.number(),
  result: z.literal("verified"),
  changed_fields: z.array(z.string()),
  correction_reason: z.string().nullable(),
  changes: z.record(
    z.string(),
    z.object({ before: z.unknown(), after: z.unknown() }),
  ),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export interface AuditLogRepository {
  append(events: readonly AuditEvent[]): Promise<void>;
}
export class InMemoryAuditLog implements AuditLogRepository {
  readonly events = new Map<string, AuditEvent>();
  async append(events: readonly AuditEvent[]) {
    for (const event of events)
      this.events.set(
        canonical([event.operation_id, event.entity_id, event.event_type]),
        structuredClone(event),
      );
  }
}
/**
 * The receipt of one write. Stored in the same transaction as the data it
 * describes, so a receipt exists exactly when the write happened. A repeated
 * request_id finds it and returns the stored result instead of writing twice.
 */
export const StoredOperationSchema = z.object({
  requestId: z.string().min(1),
  fingerprint: z.string(),
  actor: z.string(),
  changes: z.array(ChangeSchema),
  audit: z.array(AuditEventSchema),
  // One store serves workout and plan writes, so a replay is deduplicated
  // across both domains by request_id rather than per service.
  result: z.union([WriteResultSchema, PlanWriteResultSchema]),
});
export type StoredOperation = z.infer<typeof StoredOperationSchema>;

/** One write in progress. Everything it sees and does belongs to one user. */
export interface ArnoldTransaction {
  /** The user's training data as of this transaction. */
  read(): Promise<ArnoldDataset>;
  /** The receipt for a request id, if that write already happened. */
  operation(requestId: string): Promise<StoredOperation | undefined>;
  /**
   * Applies the changes, appends the audit events and stores the receipt.
   * A change whose `before` no longer matches the stored row is refused.
   */
  commit(operation: StoredOperation): Promise<void>;
}

/**
 * Where one user's training data lives.
 *
 * `write` is the only way to change it: the work runs serialised per user and
 * atomically, so either everything it committed is stored, or nothing is.
 * There is no in-between state that would have to be reconciled later.
 */
export interface ArnoldStore {
  readonly kind: "fixture" | "database";
  read(): Promise<ArnoldDataset>;
  write<T>(work: (tx: ArnoldTransaction) => Promise<T>): Promise<T>;
  /** Audit events that belong to no data write (the setup conversation). */
  readonly audit: AuditLogRepository;
}

/** Synthetic data in memory, for the fixture profile and tests. */
export class InMemoryArnoldStore implements ArnoldStore {
  readonly kind = "fixture" as const;
  readonly audit = new InMemoryAuditLog();
  /** Stored receipts, by request id. Visible for tests. */
  readonly operations = new Map<string, StoredOperation>();
  private dataset: ArnoldDataset;
  private queue = new InProcessWriteCoordinator();
  constructor(dataset: ArnoldDataset) {
    this.dataset = ArnoldDatasetSchema.parse(dataset);
  }
  async read() {
    return structuredClone(this.dataset);
  }
  write<T>(work: (tx: ArnoldTransaction) => Promise<T>): Promise<T> {
    return this.queue.exclusive("store", async () => {
      // Work on a copy; only a completed transaction replaces the state.
      let data = this.dataset;
      const staged = new Map<string, StoredOperation>();
      const tx: ArnoldTransaction = {
        read: async () => structuredClone(data),
        operation: async (requestId) => {
          const found = staged.get(requestId) ?? this.operations.get(requestId);
          return found && structuredClone(found);
        },
        commit: async (operation) => {
          const parsed = StoredOperationSchema.parse(
            structuredClone(operation),
          );
          if (
            staged.has(parsed.requestId) ||
            this.operations.has(parsed.requestId)
          )
            throw new WriteError(
              "DUPLICATE_OPERATION",
              "Operations-ID wurde bereits verwendet.",
            );
          data = changedDataset(data, parsed.changes);
          staged.set(parsed.requestId, parsed);
        },
      };
      const result = await work(tx);
      this.dataset = data;
      for (const [id, operation] of staged) {
        this.operations.set(id, operation);
        await this.audit.append(operation.audit);
      }
      return result;
    });
  }
}
/** Stable columns per table: an update may never move a row's identity or its history references. */
const STABLE_COLUMNS = {
  workouts: [
    "workout_id",
    "workout_date_local",
    "timezone",
    "plan_version_id",
    "session_id",
    "session_name_snapshot",
    "source",
  ],
  sets: [
    "set_id",
    "workout_id",
    "exercise_id",
    "plan_item_id",
    "exercise_name_snapshot",
    "exercise_order",
    "set_number",
    "source",
  ],
  // A version keeps its family and number for life; only its lifecycle and
  // draft content may move.
  plans: ["plan_version_id", "plan_family_id", "version_no"],
  // A position never migrates to another version or session. Moving an exercise
  // between sessions is a new row plus a tombstone, never an in-place edit.
  planItems: ["plan_item_id", "plan_version_id", "session_id"],
  exercises: [],
  // A goal keeps what it is about; only the target and the status move.
  goals: ["goal_id", "kind", "exercise_id", "load_basis", "start_value"],
  // A measurement keeps its day and value; it can only be voided.
  bodyWeights: ["body_weight_id", "measured_on", "weight_kg", "source"],
} as const satisfies Record<EntityChange["table"], readonly string[]>;
/** Fields of PLANS that describe the training content rather than the lifecycle. */
const PLAN_CONTENT_COLUMNS = [
  "name",
  "split_key",
  "goal_key",
  "days_per_week",
] as const;
const field = (row: object | null, key: string) =>
  canonical((row as Record<string, unknown> | null)?.[key]);
/** PLAN_ITEMS carries no timestamps, so a creation time is not available for every entity. */
export const createdAt = (row: Entity): string | undefined =>
  "created_at_utc" in row ? row.created_at_utc : undefined;

export function changedDataset(
  dataset: ArnoldDataset,
  changes: readonly EntityChange[],
): ArnoldDataset {
  const next = structuredClone(dataset) as {
    -readonly [K in keyof ArnoldDataset]: ArnoldDataset[K];
  };
  // Which versions may carry position edits: judged against the pre-batch state
  // plus the drafts this batch creates, so the verdict cannot depend on the
  // order of changes inside one batch.
  const draftVersions = new Set([
    ...dataset.plans
      .filter((plan) => plan.status === "draft")
      .map((plan) => plan.plan_version_id),
    ...changes.flatMap((c) =>
      c.table === "plans" && !c.before && c.after.status === "draft"
        ? [c.after.plan_version_id]
        : [],
    ),
  ]);
  for (const change of changes) {
    const rows = [...next[change.table]] as Entity[];
    const index = rows.findIndex((r) => entityId(r) === entityId(change.after));
    const current = index < 0 ? null : rows[index];
    if (canonical(current) !== canonical(change.before))
      throw new WriteError(
        "REVISION_CONFLICT",
        "Datensatz wurde zwischenzeitlich verändert.",
      );
    if (
      change.before &&
      (entityId(change.before) !== entityId(change.after) ||
        change.after.row_revision !== change.before.row_revision + 1 ||
        field(change.before, "created_at_utc") !==
          field(change.after, "created_at_utc"))
    )
      throw new WriteError(
        "VALIDATION_ERROR",
        "Stabile ID, Erstellungszeit oder Revision verletzt.",
      );
    // Plan content lives only in drafts. An activated or archived version is a
    // historical record: its positions are frozen and only its own lifecycle
    // columns may still change (active -> archived).
    if (
      change.table === "planItems" &&
      !draftVersions.has(change.after.plan_version_id)
    )
      throw new WriteError(
        "PERMISSION_DENIED",
        "Planpositionen aktiver oder archivierter Versionen sind unveränderlich. Änderungen laufen über eine neue Draft-Version.",
      );
    if (
      change.table === "plans" &&
      change.before &&
      change.before.status !== "draft" &&
      PLAN_CONTENT_COLUMNS.some(
        (key) => field(change.before, key) !== field(change.after, key),
      )
    )
      throw new WriteError(
        "PERMISSION_DENIED",
        "Der Inhalt einer aktivierten oder archivierten Planversion ist unveränderlich.",
      );
    if (change.before) {
      if (change.table === "exercises")
        throw new WriteError(
          "PERMISSION_DENIED",
          "Task 004 erlaubt keine Änderung bestehender Katalog-IDs.",
        );
      for (const key of STABLE_COLUMNS[change.table])
        if (field(change.before, key) !== field(change.after, key))
          throw new WriteError(
            "PERMISSION_DENIED",
            "Historische Identitäten und Referenzen sind unveränderlich.",
          );
    }
    if (!change.before && change.after.row_revision !== 1)
      throw new WriteError(
        "VALIDATION_ERROR",
        "Neue Zeilen benötigen Revision 1.",
      );
    if (index < 0) rows.push(change.after);
    else rows[index] = change.after;
    Object.assign(next, { [change.table]: rows });
  }
  const parsed = ArnoldDatasetSchema.safeParse(next);
  if (!parsed.success)
    throw new WriteError(
      "VALIDATION_ERROR",
      "Änderung verletzt den Datenvertrag.",
      false,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  return parsed.data;
}
