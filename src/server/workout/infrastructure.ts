import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  ArnoldDatasetSchema,
  ArnoldExerciseSchema,
  ArnoldPlanItemSchema,
  ArnoldPlanVersionSchema,
  ArnoldSetSchema,
  ArnoldWorkoutSchema,
  type ArnoldDataset,
  type ArnoldExercise,
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
export type WriteMode =
  "disabled" | "fixture" | "test_sheet" | "connected" | "production";
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
]);
export type EntityChange = z.infer<typeof ChangeSchema>;
export type Entity =
  | ArnoldWorkout
  | ArnoldSet
  | ArnoldExercise
  | ArnoldPlanVersion
  | ArnoldPlanItem;
/** Order matters: a set also carries workout_id and plan_item_id, a plan item a plan_version_id. */
export const entityId = (row: Entity): string =>
  "set_id" in row
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
const EntrySchema = z.object({
  trackerId: z.string(),
  requestId: z.string(),
  fingerprint: z.string(),
  actor: z.string(),
  state: z.enum(["prepared", "dispatching", "committed"]),
  changes: z.array(ChangeSchema),
  audit: z.array(AuditEventSchema),
  // One ledger serves workout and plan writes, so a replay is deduplicated
  // across both domains by (tracker, request_id) rather than per service.
  result: z.union([WriteResultSchema, PlanWriteResultSchema]),
});
export type LedgerEntry = z.infer<typeof EntrySchema>;
export interface OperationLedger {
  readonly durability: "memory" | "local" | "distributed";
  get(trackerId: string, requestId: string): Promise<LedgerEntry | undefined>;
  pending(trackerId: string): Promise<LedgerEntry[]>;
  save(entry: LedgerEntry): Promise<void>;
}
const ledgerKey = (tracker: string, request: string) =>
  canonical([tracker, request]);
export class InMemoryOperationLedger implements OperationLedger {
  readonly durability = "memory" as const;
  private entries = new Map<string, LedgerEntry>();
  async get(tracker: string, request: string) {
    const e = this.entries.get(ledgerKey(tracker, request));
    return e && structuredClone(e);
  }
  async pending(tracker: string) {
    return [...this.entries.values()]
      .filter((e) => e.trackerId === tracker && e.state !== "committed")
      .map((e) => structuredClone(e));
  }
  async save(entry: LedgerEntry) {
    this.entries.set(
      ledgerKey(entry.trackerId, entry.requestId),
      EntrySchema.parse(structuredClone(entry)),
    );
  }
}
/** Local crash-surviving journal. Single process only; NOT a distributed lock/ledger. */
export class FileOperationLedger implements OperationLedger {
  readonly durability = "local" as const;
  private queue = new InProcessWriteCoordinator();
  private seenFile = false;
  constructor(private path: string) {}
  private async read(): Promise<LedgerEntry[]> {
    try {
      const entries = z
        .array(EntrySchema)
        .parse(JSON.parse(await readFile(this.path, "utf8")));
      this.seenFile = true;
      return entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !this.seenFile)
        return [];
      throw new WriteError(
        "STORAGE_UNAVAILABLE",
        "Operationsjournal nicht lesbar.",
        true,
      );
    }
  }
  async get(tracker: string, request: string) {
    return (await this.read()).find(
      (e) => e.trackerId === tracker && e.requestId === request,
    );
  }
  async pending(tracker: string) {
    return (await this.read()).filter(
      (e) => e.trackerId === tracker && e.state !== "committed",
    );
  }
  async save(entry: LedgerEntry) {
    await this.queue.exclusive(this.path, async () => {
      const entries = await this.read();
      const next = entries.filter(
        (e) =>
          ledgerKey(e.trackerId, e.requestId) !==
          ledgerKey(entry.trackerId, entry.requestId),
      );
      next.push(EntrySchema.parse(entry));
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${uuid7()}.tmp`;
      await writeFile(temp, JSON.stringify(next), { mode: 0o600, flush: true });
      await rename(temp, this.path);
      this.seenFile = true;
    });
  }
}
export interface ArnoldWriteRepository {
  readonly kind: "fixture" | "test_sheet" | "connected";
  read(): Promise<ArnoldDataset>;
  /** One logical atomic batch. Unknown outcomes must throw COMMIT_STATUS_UNKNOWN. */
  apply(changes: readonly EntityChange[]): Promise<void>;
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
export async function inspectChanges(
  repo: ArnoldWriteRepository,
  changes: readonly EntityChange[],
): Promise<"applied" | "absent" | "unknown"> {
  const data = await repo.read();
  const pairs = changes.map((c) => ({
    c,
    current:
      (data[c.table] as readonly Entity[]).find(
        (r) => entityId(r) === entityId(c.after),
      ) ?? null,
  }));
  if (
    pairs.every(({ c, current }) => canonical(current) === canonical(c.after))
  )
    return "applied";
  if (
    pairs.every(({ c, current }) => canonical(current) === canonical(c.before))
  )
    return "absent";
  return "unknown";
}
export class InMemoryArnoldWriteRepository implements ArnoldWriteRepository {
  readonly kind = "fixture" as const;
  constructor(private dataset: ArnoldDataset) {
    this.dataset = ArnoldDatasetSchema.parse(dataset);
  }
  async read() {
    return ArnoldDatasetSchema.parse(structuredClone(this.dataset));
  }
  async apply(changes: readonly EntityChange[]) {
    this.dataset = changedDataset(this.dataset, changes);
  }
}
