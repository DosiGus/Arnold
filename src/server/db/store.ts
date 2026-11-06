/**
 * One user's training data in Postgres.
 *
 * Reads return the same `ArnoldDataset` the rest of Arnold works with, and
 * writes go through `write`: one transaction, serialised per user by an
 * advisory lock, in which the data, the audit events and the write receipt
 * are stored together or not at all.
 */
import {
  ARNOLD_TABLE_HEADERS,
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import { trackerConfig } from "../account/catalog.js";
import {
  StoredOperationSchema,
  WriteError,
  entityId,
  type ArnoldStore,
  type ArnoldTransaction,
  type AuditEvent,
  type AuditLogRepository,
  type EntityChange,
  type StoredOperation,
} from "../workout/infrastructure.js";
import type { Database, Queryable } from "./database.js";

/** Dataset key → database table and its columns, in schema order. */
const TABLES = {
  exercises: { table: "exercises", columns: ARNOLD_TABLE_HEADERS.EXERCISES },
  plans: { table: "plan_versions", columns: ARNOLD_TABLE_HEADERS.PLANS },
  planItems: { table: "plan_items", columns: ARNOLD_TABLE_HEADERS.PLAN_ITEMS },
  workouts: { table: "workouts", columns: ARNOLD_TABLE_HEADERS.WORKOUTS },
  sets: { table: "sets", columns: ARNOLD_TABLE_HEADERS.SETS },
  goals: { table: "goals", columns: ARNOLD_TABLE_HEADERS.GOALS },
  bodyWeights: {
    table: "body_weights",
    columns: ARNOLD_TABLE_HEADERS.BODY_WEIGHTS,
  },
} as const satisfies Record<
  EntityChange["table"],
  { table: string; columns: readonly string[] }
>;

// Column names become SQL identifiers; they come from the schema constants
// above, never from input, and are checked once here regardless.
for (const { table, columns } of Object.values(TABLES))
  for (const name of [table, ...columns])
    if (!/^[a-z_]+$/.test(name))
      throw new Error(`Ungültiger Spaltenname im Schema: ${name}`);

const ID_COLUMN = {
  exercises: "exercise_id",
  plans: "plan_version_id",
  planItems: "plan_item_id",
  workouts: "workout_id",
  sets: "set_id",
  goals: "goal_id",
  bodyWeights: "body_weight_id",
} as const satisfies Record<EntityChange["table"], string>;

/** All training tables in one statement, each as a JSON array in insertion order. */
const READ_DATASET = `select ${Object.entries(TABLES)
  .map(
    ([key, { table, columns }]) =>
      `(select coalesce(json_agg(json_build_object(${columns
        .map((c) => `'${c}', t.${c}`)
        .join(
          ", ",
        )}) order by t.seq), '[]'::json) from arnold.${table} t where t.user_id = $1) as "${key}"`,
  )
  .join(", ")}`;

type DatasetRows = Record<keyof typeof TABLES, unknown[]>;

async function readDataset(
  client: Queryable,
  userId: string,
  trackerId: string,
): Promise<ArnoldDataset> {
  const rows = (await client.query<DatasetRows>(READ_DATASET, [userId]))
    .rows[0];
  const config = trackerConfig(trackerId);
  const parsed = ArnoldDatasetSchema.safeParse({
    config,
    configEntries: Object.entries(config).map(([key, value]) => ({
      key,
      value,
      description: null,
    })),
    exercises: rows.exercises,
    plans: rows.plans,
    planItems: rows.planItems,
    workouts: rows.workouts,
    sets: rows.sets,
    goals: rows.goals,
    bodyWeights: rows.bodyWeights,
  });
  if (!parsed.success)
    throw new WriteError(
      "SCHEMA_MISMATCH",
      "Gespeicherte Trainingsdaten verletzen das Datenformat.",
      false,
      parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  return parsed.data;
}

async function applyChange(
  client: Queryable,
  userId: string,
  change: EntityChange,
) {
  const { table, columns } = TABLES[change.table];
  const row = change.after as unknown as Record<string, unknown>;
  const values = columns.map((column) => row[column] ?? null);
  if (!change.before) {
    const result = await client.query(
      `insert into arnold.${table} (user_id, ${columns.join(", ")}) values ($1, ${columns
        .map((_, i) => `$${i + 2}`)
        .join(", ")}) on conflict do nothing`,
      [userId, ...values],
    );
    if (result.rowCount !== 1)
      throw new WriteError(
        "REVISION_CONFLICT",
        "Ein Datensatz mit dieser Kennung existiert bereits.",
      );
    return;
  }
  const idColumn = ID_COLUMN[change.table];
  const result = await client.query(
    `update arnold.${table} set ${columns
      .map((column, i) => `${column} = $${i + 4}`)
      .join(
        ", ",
      )} where user_id = $1 and ${idColumn} = $2 and row_revision = $3`,
    [userId, entityId(change.before), change.before.row_revision, ...values],
  );
  if (result.rowCount !== 1)
    throw new WriteError(
      "REVISION_CONFLICT",
      "Datensatz wurde zwischenzeitlich verändert.",
    );
}

export async function appendAudit(
  client: Queryable,
  userId: string,
  events: readonly AuditEvent[],
) {
  for (const event of events)
    await client.query(
      `insert into arnold.audit_events (user_id, operation_id, entity_id, event_type, event)
       values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [
        userId,
        event.operation_id,
        event.entity_id,
        event.event_type,
        JSON.stringify(event),
      ],
    );
}

/** Postgres error classes that mean "this write is not valid", not "try again". */
function toWriteError(error: unknown): unknown {
  if (error instanceof WriteError) return error;
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string") {
    if (code === "23505")
      return new WriteError(
        "REVISION_CONFLICT",
        "Der Datensatz kollidiert mit einem gespeicherten Stand. Erneut laden und noch einmal versuchen.",
      );
    if (code.startsWith("23"))
      return new WriteError(
        "VALIDATION_ERROR",
        "Die Änderung verletzt eine Regel der Datenbank.",
      );
  }
  return error;
}

export class PostgresArnoldStore implements ArnoldStore {
  readonly kind = "database" as const;
  readonly audit: AuditLogRepository;

  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly trackerId: string,
  ) {
    this.audit = {
      append: (events) =>
        db.asUser(userId, (client) => appendAudit(client, userId, events)),
    };
  }

  read(): Promise<ArnoldDataset> {
    return this.db.asUser(this.userId, (client) =>
      readDataset(client, this.userId, this.trackerId),
    );
  }

  async write<T>(work: (tx: ArnoldTransaction) => Promise<T>): Promise<T> {
    const { userId, trackerId } = this;
    try {
      return await this.db.asUser(userId, async (client) => {
        // One writer per user at a time, across all server instances.
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 11))",
          [userId],
        );
        let committed = false;
        const tx: ArnoldTransaction = {
          read: () => readDataset(client, userId, trackerId),
          operation: async (requestId) => {
            const found = await client.query<{
              request_id: string;
              fingerprint: string;
              actor: string;
              changes: unknown;
              result: unknown;
            }>(
              `select request_id, fingerprint, actor, changes, result
                 from arnold.operations where user_id = $1 and request_id = $2`,
              [userId, requestId],
            );
            const row = found.rows[0];
            if (!row) return undefined;
            return StoredOperationSchema.parse({
              requestId: row.request_id,
              fingerprint: row.fingerprint,
              actor: row.actor,
              changes: row.changes,
              audit: [],
              result: row.result,
            });
          },
          commit: async (operation: StoredOperation) => {
            if (committed)
              throw new Error(
                "Eine Transaktion speichert genau einen Vorgang.",
              );
            committed = true;
            const parsed = StoredOperationSchema.parse(operation);
            for (const change of parsed.changes)
              await applyChange(client, userId, change);
            await appendAudit(client, userId, parsed.audit);
            const receipt = await client.query(
              `insert into arnold.operations (user_id, request_id, fingerprint, actor, changes, result)
               values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
              [
                userId,
                parsed.requestId,
                parsed.fingerprint,
                parsed.actor,
                JSON.stringify(parsed.changes),
                JSON.stringify(parsed.result),
              ],
            );
            if (receipt.rowCount !== 1)
              throw new WriteError(
                "DUPLICATE_OPERATION",
                "Operations-ID wurde gleichzeitig schon verwendet; dieselbe Anfrage erneut senden.",
                true,
              );
          },
        };
        return work(tx);
      });
    } catch (error) {
      throw toWriteError(error);
    }
  }
}
