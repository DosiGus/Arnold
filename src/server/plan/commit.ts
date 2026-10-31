/**
 * The write-commit protocol, parameterised over what is being written.
 *
 * This is Task 004's commit sequence expressed once, so plan writes inherit
 * exactly the guarantees the workout logger established rather than re-deriving
 * them. It owns the ordering that makes a Google Sheets write survivable:
 *
 *   1. serialise per tracker, so two writers never interleave;
 *   2. re-read and re-validate storage inside the lock;
 *   3. refuse a request_id that was used for a different payload or actor;
 *   4. replay a committed operation instead of repeating it, and verify the
 *      stored rows are still there before calling it committed;
 *   5. reconcile any other unfinished operation first;
 *   6. enforce the full data contract *before* any side effect;
 *   7. journal `dispatching` before contacting storage, so a crash mid-write is
 *      recognisable afterwards;
 *   8. read back, then — and only then — append audit and mark committed.
 *
 * The one rule that governs every branch: an outcome that cannot be proven is
 * reported as COMMIT_STATUS_UNKNOWN, never as success and never as failure.
 * A caller that sees that code must re-send the *same* request_id rather than
 * build a new operation.
 *
 * Note for maintainers: `WorkoutLoggingService` still carries its own inline
 * copy of this sequence. Both are kept in step deliberately; folding the
 * workout service onto this runner is a tracked follow-up.
 */
import {
  googleReauthWriteError,
  isGoogleReauthRequired,
} from "../google/reauth.js";
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
  inspectChanges,
  type ArnoldWriteRepository,
  type AuditEvent,
  type AuditLogRepository,
  type EntityChange,
  type LedgerEntry,
  type OperationLedger,
  type WriteCoordinator,
} from "../workout/infrastructure.js";

export type CommitPlan<R> = {
  changes: EntityChange[];
  result: R;
  audit: readonly AuditEvent[];
};

export type CommitOptions<R> = {
  trackerId: string;
  repository: ArnoldWriteRepository;
  ledger: OperationLedger;
  coordinator: WriteCoordinator;
  audit: AuditLogRepository;
  invalidate: () => void;
  requestId: string;
  /** Hash of (operation, input); a reused id with another payload is refused. */
  fingerprint: string;
  actorSubject: string;
  clock: () => Date;
  /** Builds the changes from the dataset as read inside the lock. */
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

export async function commitWrite<R>(
  options: CommitOptions<R>,
): Promise<{ result: R; replayed: boolean }> {
  const { trackerId, repository, ledger, coordinator, audit, invalidate } =
    options;

  async function finish(entry: LedgerEntry) {
    // Audit append must itself deduplicate on (operation, entity, event), so a
    // replay cannot double-log.
    invalidate();
    await audit.append(entry.audit);
    await ledger.save({ ...entry, state: "committed" });
  }

  return coordinator.exclusive(trackerId, async () => {
    const parsed = ArnoldDatasetSchema.safeParse(await repository.read());
    if (!parsed.success)
      throw new WriteError(
        "SCHEMA_MISMATCH",
        "Gespeicherte Daten verletzen Schema v1.",
      );
    assertTracker(parsed.data, trackerId);

    let entry = await ledger.get(trackerId, options.requestId);
    if (
      entry &&
      (entry.fingerprint !== options.fingerprint ||
        entry.actor !== options.actorSubject)
    )
      throw new WriteError(
        "DUPLICATE_OPERATION",
        "Operations-ID wurde bereits für einen anderen Payload oder Akteur verwendet.",
      );

    if (entry?.state === "committed") {
      // A later operation may legitimately have superseded these rows, but a
      // row that vanished or went backwards means the journal no longer
      // describes storage.
      for (const change of entry.changes) {
        const current = parsed.data[change.table].find(
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
            "COMMIT_STATUS_UNKNOWN",
            "Bereits bestätigte Datensätze fehlen oder wurden außerhalb des Journals verändert.",
            true,
          );
      }
      return { result: entry.result as R, replayed: true };
    }

    for (const pending of await ledger.pending(trackerId)) {
      if (pending.requestId === options.requestId) continue;
      if ((await inspectChanges(repository, pending.changes)) !== "applied")
        throw new WriteError(
          "COMMIT_STATUS_UNKNOWN",
          "Ein früherer Schreibvorgang muss zuerst geklärt werden.",
          true,
          [pending.requestId],
        );
      try {
        await finish(pending);
      } catch {
        throw new WriteError(
          "COMMIT_STATUS_UNKNOWN",
          "Bestätigung eines früheren Vorgangs steht aus.",
          true,
        );
      }
    }

    const replayed = !!entry;
    if (!entry) {
      const now = options.clock().toISOString();
      const built = await options.build(parsed.data, now);
      // The complete data contract, enforced before anything is prepared.
      changedDataset(parsed.data, built.changes);
      entry = {
        trackerId,
        requestId: options.requestId,
        fingerprint: options.fingerprint,
        actor: options.actorSubject,
        state: "prepared",
        changes: built.changes,
        result: built.result as LedgerEntry["result"],
        audit: [...built.audit],
      };
      await ledger.save(entry);
    }

    const observed = await inspectChanges(repository, entry.changes);
    if (
      observed === "unknown" ||
      (entry.state === "dispatching" && observed === "absent")
    )
      throw new WriteError(
        "COMMIT_STATUS_UNKNOWN",
        "Schreibstatus unklar. Nicht erneut anhängen; Vorgang mit derselben ID prüfen.",
        true,
      );

    if (observed === "absent") {
      entry = { ...entry, state: "dispatching" };
      await ledger.save(entry); // Must persist BEFORE contacting storage.
      try {
        await repository.apply(entry.changes);
      } catch (error) {
        invalidate();
        if (isGoogleReauthRequired(error)) {
          // Refused before sending: safe to dispatch again after reconnecting.
          await ledger.save({ ...entry, state: "prepared" });
          throw googleReauthWriteError();
        }
        let state: string = "unknown";
        try {
          state = await inspectChanges(repository, entry.changes);
        } catch {
          /* fail closed */
        }
        if (state !== "applied") {
          // An unchanged read does not prove a timed-out request will never
          // commit; only a definite rejection may be re-dispatched.
          if (
            error instanceof WriteError &&
            error.code !== "COMMIT_STATUS_UNKNOWN" &&
            state === "absent"
          ) {
            await ledger.save({ ...entry, state: "prepared" });
            throw error;
          }
          throw new WriteError(
            "COMMIT_STATUS_UNKNOWN",
            "Speicherung konnte nicht eindeutig bestätigt werden.",
            true,
          );
        }
      }
    }

    invalidate();
    try {
      if ((await inspectChanges(repository, entry.changes)) !== "applied")
        throw new Error("Readback mismatch");
      await finish(entry);
    } catch {
      throw new WriteError(
        "COMMIT_STATUS_UNKNOWN",
        "Daten, Audit oder Journal konnten noch nicht vollständig bestätigt werden.",
        true,
      );
    }
    return { result: entry.result as R, replayed };
  });
}
