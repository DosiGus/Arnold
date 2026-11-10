/**
 * The write sequence every workout and plan write goes through.
 *
 * Everything happens inside one store transaction, serialised per user:
 *
 *   1. read and validate the user's data as it is now;
 *   2. refuse a request_id that was used for a different payload or actor;
 *   3. replay a request_id that was already stored instead of writing again;
 *   4. build the changes and check the complete data contract;
 *   5. store changes, audit events and the receipt together.
 *
 * Because step 5 is atomic, a write is either fully stored or not at all.
 * When the connection drops at the wrong moment and the caller cannot tell
 * which, it sends the same request_id again: a stored write is replayed, a
 * missing one is written. Nothing ever waits for manual reconciliation.
 */
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import {
  WriteError,
  canonical,
  changedDataset,
  createdAt,
  entityId,
  type ArnoldStore,
  type AuditEvent,
  type EntityChange,
  type StoredOperation,
} from "../workout/infrastructure.js";

export type CommitPlan<R> = {
  changes: EntityChange[];
  result: R;
  audit: readonly AuditEvent[];
  /** A watch upload's raw recording (UMSETZUNG §4.2), stored in the same transaction. */
  watchRecording?: WatchRecordingRow;
};

/** One confirmed set on the watch: positions in the saved workout, and times. */
export interface WatchSetTiming {
  exercise_order: number;
  set_number: number;
  side: string;
  started_at_utc: string;
  ended_at_utc: string;
  /** Rest before this set; null for the first set or when unknown. */
  rest_before_s: number | null;
}

export interface WatchRecordingRow {
  client_session_id: string;
  device_id: string;
  started_at_utc: string;
  ended_at_utc: string;
  set_timings: readonly WatchSetTiming[];
  app_version: string;
}

/** A store transaction that can also keep watch recordings (Postgres only). */
export interface WatchRecordingTransaction {
  recordWatchWorkout(row: WatchRecordingRow): Promise<void>;
}

export type CommitOptions<R> = {
  trackerId: string;
  store: ArnoldStore;
  requestId: string;
  /** Hash of (operation, input); a reused id with another payload is refused. */
  fingerprint: string;
  actorSubject: string;
  clock: () => Date;
  /** Builds the changes from the data as read inside the transaction. */
  build: (
    dataset: ArnoldDataset,
    now: string,
  ) => Promise<CommitPlan<R>> | CommitPlan<R>;
};

/** Rejects writes against the master template or a foreign tracker. */
function assertTracker(dataset: ArnoldDataset, trackerId: string) {
  if (dataset.config.file_role === "MASTER_TEMPLATE")
    throw new WriteError(
      "TEMPLATE_WRITE_FORBIDDEN",
      "Die Master-Vorlage darf niemals beschrieben werden.",
    );
  if (
    dataset.config.tracker_id === "TEMPLATE_UNASSIGNED" ||
    dataset.config.tracker_id !== trackerId
  )
    throw new WriteError(
      "PERMISSION_DENIED",
      "Tracker-Zuordnung stimmt nicht überein.",
    );
}

/**
 * A stored receipt is only replayed while the rows it describes are still
 * there. A later write may have moved them on; a row that vanished or went
 * backwards means the data no longer matches the receipt.
 */
function assertReceiptHolds(dataset: ArnoldDataset, entry: StoredOperation) {
  for (const change of entry.changes) {
    const current = dataset[change.table].find(
      (row) => entityId(row) === entityId(change.after),
    );
    if (
      !current ||
      createdAt(current) !== createdAt(change.after) ||
      current.row_revision < change.after.row_revision ||
      (current.row_revision === change.after.row_revision &&
        canonical(current) !== canonical(change.after))
    )
      throw new WriteError(
        "SCHEMA_MISMATCH",
        "Gespeicherte Datensätze passen nicht mehr zur Quittung dieses Vorgangs.",
      );
  }
}

export async function commitWrite<R>(
  options: CommitOptions<R>,
): Promise<{ result: R; replayed: boolean }> {
  return options.store.write(async (tx) => {
    const parsed = ArnoldDatasetSchema.safeParse(await tx.read());
    if (!parsed.success)
      throw new WriteError(
        "SCHEMA_MISMATCH",
        "Gespeicherte Daten verletzen Schema v1.",
      );
    assertTracker(parsed.data, options.trackerId);

    const entry = await tx.operation(options.requestId);
    if (entry) {
      if (
        entry.fingerprint !== options.fingerprint ||
        entry.actor !== options.actorSubject
      )
        throw new WriteError(
          "DUPLICATE_OPERATION",
          "Diese request_id gehört schon zu einem anderen Vorgang. Es wurde nichts gespeichert. Für diesen Vorgang eine neue request_id erzeugen.",
        );
      assertReceiptHolds(parsed.data, entry);
      return { result: entry.result as R, replayed: true };
    }

    const now = options.clock().toISOString();
    const built = await options.build(parsed.data, now);
    // The complete data contract, enforced before anything is stored.
    changedDataset(parsed.data, built.changes);
    await tx.commit({
      requestId: options.requestId,
      fingerprint: options.fingerprint,
      actor: options.actorSubject,
      changes: built.changes,
      audit: [...built.audit],
      result: built.result as StoredOperation["result"],
    });
    if (built.watchRecording) {
      const recorder = tx as Partial<WatchRecordingTransaction>;
      // Fails closed: a store without recordings stores no watch upload.
      if (!recorder.recordWatchWorkout)
        throw new WriteError(
          "PERMISSION_DENIED",
          "Dieser Speicher nimmt keine Uhr-Aufzeichnungen an.",
        );
      await recorder.recordWatchWorkout(built.watchRecording);
    }
    return { result: built.result, replayed: false };
  });
}

/**
 * What a caller is told when the store could not be reached. Sending the same
 * request_id again is always safe: a write that did happen is replayed.
 */
export const STORAGE_RETRY_MESSAGE =
  "Speichern war gerade nicht möglich. Denselben Vorgang mit derselben request_id erneut senden; ein bereits gespeicherter Vorgang wird dabei nicht doppelt angelegt.";
