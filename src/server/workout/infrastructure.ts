import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  ArnoldDatasetSchema,
  ArnoldExerciseSchema,
  ArnoldSetSchema,
  ArnoldWorkoutSchema,
  type ArnoldDataset,
  type ArnoldExercise,
  type ArnoldSet,
  type ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import {
  WriteResultSchema,
  type WriteResult,
  type WriteErrorCode,
} from "../../shared/workout-contract.js";

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
export type WriteMode = "disabled" | "fixture" | "test_sheet" | "production";
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
]);
export type EntityChange = z.infer<typeof ChangeSchema>;
export type Entity = ArnoldWorkout | ArnoldSet | ArnoldExercise;
export const entityId = (row: Entity): string =>
  "set_id" in row
    ? row.set_id
    : "workout_id" in row
      ? row.workout_id
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
  result: WriteResultSchema,
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
  readonly kind: "fixture" | "test_sheet";
  read(): Promise<ArnoldDataset>;
  /** One logical atomic batch. Unknown outcomes must throw COMMIT_STATUS_UNKNOWN. */
  apply(changes: readonly EntityChange[]): Promise<void>;
}
export function changedDataset(
  dataset: ArnoldDataset,
  changes: readonly EntityChange[],
): ArnoldDataset {
  const next = structuredClone(dataset) as {
    -readonly [K in keyof ArnoldDataset]: ArnoldDataset[K];
  };
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
        change.after.created_at_utc !== change.before.created_at_utc)
    )
      throw new WriteError(
        "VALIDATION_ERROR",
        "Stabile ID, Erstellungszeit oder Revision verletzt.",
      );
    if (change.before) {
      if (change.table === "exercises")
        throw new WriteError(
          "PERMISSION_DENIED",
          "Task 004 erlaubt keine Änderung bestehender Katalog-IDs.",
        );
      const stable =
        change.table === "workouts"
          ? [
              "workout_id",
              "workout_date_local",
              "timezone",
              "plan_version_id",
              "session_id",
              "session_name_snapshot",
              "source",
            ]
          : [
              "set_id",
              "workout_id",
              "exercise_id",
              "plan_item_id",
              "exercise_name_snapshot",
              "exercise_order",
              "set_number",
              "source",
            ];
      for (const key of stable)
        if (
          canonical(
            (change.before as unknown as Record<string, unknown>)[key],
          ) !==
          canonical((change.after as unknown as Record<string, unknown>)[key])
        )
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
