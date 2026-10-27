/** One commit protocol for plan and workout writes. Local coordination only. */
import { z } from "zod";
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import type { WriteRecovery } from "../../shared/write-recovery.js";
import {
  WriteError,
  RejectedWriteError,
  StoredWriteResultSchema,
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
} from "./infrastructure.js";

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
  fingerprint: string;
  actorSubject: string;
  clock: () => Date;
  resultSchema: z.ZodType<R>;
  build: (
    dataset: ArnoldDataset,
    now: string,
  ) => Promise<CommitPlan<R>> | CommitPlan<R>;
};

/** Error codes cannot tell the client whether an intent already exists. */
export async function writeRecovery(
  ledger: OperationLedger,
  tracker: string,
  request: string,
): Promise<WriteRecovery> {
  if (!request) return "none";
  try {
    const entry = await ledger.get(tracker, request);
    return !entry || entry.state === "abandoned"
      ? "none"
      : entry.state === "rejected"
        ? "retry_or_new_request"
        : "retry_same_request";
  } catch {
    return "retry_same_request";
  }
}

export async function commitWrite<R>(
  options: CommitOptions<R>,
): Promise<{ result: R; replayed: boolean }> {
  const { trackerId, repository, ledger, coordinator, audit, invalidate } =
    options;
  function resultOf(value: unknown): R {
    const parsed = options.resultSchema.safeParse(value);
    if (!parsed.success)
      throw new WriteError(
        "SCHEMA_MISMATCH",
        "Journal-Ergebnis passt nicht zum angeforderten Vorgang.",
      );
    return parsed.data;
  }
  async function finish(entry: LedgerEntry) {
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
    if (parsed.data.config.file_role === "MASTER_TEMPLATE")
      throw new WriteError(
        "TEMPLATE_WRITE_FORBIDDEN",
        "Die Master-Vorlage darf niemals beschrieben werden.",
      );
    if (
      parsed.data.config.tracker_id === "TEMPLATE_UNASSIGNED" ||
      parsed.data.config.tracker_id !== trackerId
    )
      throw new WriteError(
        "PERMISSION_DENIED",
        "Tracker-Zuordnung stimmt nicht überein.",
      );
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
    if (entry?.state === "abandoned")
      throw new WriteError(
        "DUPLICATE_OPERATION",
        "Dieser nachweislich abgelehnte Vorgang wurde endgültig geschlossen. Für eine neue Änderung eine neue ID verwenden.",
      );
    if (entry?.state === "committed") {
      const result = resultOf(entry.result);
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
      return { result, replayed: true };
    }
    for (const pending of await ledger.pending(trackerId)) {
      if (pending.requestId === options.requestId) continue;
      // Never finish another actor's operation on their behalf.
      if (
        pending.actor !== options.actorSubject ||
        (await inspectChanges(repository, pending.changes)) !== "applied"
      )
        throw new WriteError(
          "COMMIT_STATUS_UNKNOWN",
          "Ein früherer Schreibvorgang muss unter seinem ursprünglichen Akteur geklärt werden.",
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
    const replayed = !!entry && entry.state !== "rejected";
    // A rejected batch provably made no change. A same-ID retry revalidates the
    // original payload against current revisions, even after unrelated writes.
    if (!entry || entry.state === "rejected") {
      const built = await options.build(
        parsed.data,
        options.clock().toISOString(),
      );
      changedDataset(parsed.data, built.changes);
      const result = resultOf(built.result);
      entry = {
        trackerId,
        requestId: options.requestId,
        fingerprint: options.fingerprint,
        actor: options.actorSubject,
        state: "prepared",
        changes: built.changes,
        result: StoredWriteResultSchema.parse(result),
        audit: [...built.audit],
      };
      await ledger.save(entry);
    }
    const result = resultOf(entry.result);
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
      await ledger.save(entry);
      try {
        await repository.apply(entry.changes);
      } catch (error) {
        invalidate();
        let state: "applied" | "absent" | "unknown" = "unknown";
        try {
          state = await inspectChanges(repository, entry.changes);
        } catch {
          /* fail closed */
        }
        if (state !== "applied") {
          if (error instanceof RejectedWriteError) {
            // Terminal, durable, nonblocking rejection. Keep the request binding.
            // Persist this proof before allowing the UI to dismiss the request.
            try {
              await ledger.save({ ...entry, state: "rejected" });
            } catch {
              throw new WriteError(
                "COMMIT_STATUS_UNKNOWN",
                "Ablehnung ist bekannt, aber noch nicht im Journal bestätigt. Gleiche ID prüfen.",
                true,
              );
            }
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
    return { result, replayed };
  });
}
