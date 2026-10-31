/**
 * Retention (D4): operator journals, write snapshots and audit events are kept
 * for ARNOLD_JOURNAL_RETENTION_DAYS (default 30) and then deleted.
 *
 * What is pruned per user directory:
 * - operations.json: committed entries older than the cutoff. An entry that a
 *   retry still needs (prepared or dispatching) is never removed, whatever
 *   its age, so a pending request_id can always be reconciled.
 * - audit.json: events older than the cutoff.
 * - provisioning.json and draft.json: setup snapshots, once the tracker is
 *   ready and the file is older than the cutoff. Neither is read again then.
 *
 * The user's Google sheet is never touched. Onboarding sessions have their own
 * shorter retention (onboarding/repository.ts).
 */
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads the retention period. Fails closed on anything but a sane integer. */
export function retentionDaysFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.ARNOLD_JOURNAL_RETENTION_DAYS;
  if (raw === undefined || raw === "") return DEFAULT_RETENTION_DAYS;
  const days = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error(
      "ARNOLD_JOURNAL_RETENTION_DAYS muss eine ganze Zahl von 1 bis 3650 sein.",
    );
  return days;
}

export interface RetentionResult {
  journal: number;
  audit: number;
  snapshots: number;
}

const TimedSchema = z.object({ at: z.string() }).passthrough();
const EntryLikeSchema = z
  .object({
    state: z.string(),
    recorded_at: z.string().optional(),
    audit: z.array(TimedSchema),
  })
  .passthrough();

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600, flush: true });
  await rename(temp, path);
}

const before = (iso: string | undefined, cutoffMs: number) =>
  iso !== undefined && Date.parse(iso) < cutoffMs;

/** When a journal entry was last written; its newest audit event as fallback. */
function entryTime(entry: z.infer<typeof EntryLikeSchema>): string | undefined {
  if (entry.recorded_at) return entry.recorded_at;
  return entry.audit
    .map((event) => event.at)
    .sort()
    .at(-1);
}

/**
 * Prunes one user directory. The caller holds that user's write lock, so no
 * journal or audit write can interleave.
 */
export async function pruneUserDirectory(
  directory: string,
  cutoffMs: number,
): Promise<RetentionResult> {
  const result: RetentionResult = { journal: 0, audit: 0, snapshots: 0 };

  const journalPath = resolve(directory, "operations.json");
  const journal = await readJson(journalPath);
  if (journal !== undefined) {
    const entries = z.array(EntryLikeSchema).parse(journal);
    const kept = entries.filter((entry) => {
      if (entry.state !== "committed") return true;
      const time = entryTime(entry);
      // A committed entry without any timestamp predates this rule.
      return time !== undefined && !before(time, cutoffMs);
    });
    result.journal = entries.length - kept.length;
    if (result.journal > 0) await writeJson(journalPath, kept);
  }

  const auditPath = resolve(directory, "audit.json");
  const audit = await readJson(auditPath);
  if (audit !== undefined) {
    const events = z.array(TimedSchema).parse(audit);
    const kept = events.filter((event) => !before(event.at, cutoffMs));
    result.audit = events.length - kept.length;
    if (result.audit > 0) await writeJson(auditPath, kept);
  }

  const manifest = (await readJson(resolve(directory, "tracker.json"))) as
    { phase?: unknown } | undefined;
  if (manifest?.phase === "ready")
    for (const name of ["provisioning.json", "draft.json"]) {
      const path = resolve(directory, name);
      try {
        if ((await stat(path)).mtimeMs < cutoffMs) {
          await unlink(path);
          result.snapshots += 1;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

  return result;
}

/** Runs once now and then daily. The timer never keeps the process alive. */
export function scheduleRetention(
  run: () => Promise<unknown>,
  intervalMs = DAY_MS,
): { stop(): void; ready: Promise<void> } {
  const once = () =>
    run().then(
      () => undefined,
      () => {
        // Logged by the caller without content; a failed pass retries tomorrow.
      },
    );
  const ready = once();
  const timer = setInterval(() => void once(), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), ready };
}

export const retentionCutoff = (days: number, now = Date.now()) =>
  now - days * DAY_MS;
