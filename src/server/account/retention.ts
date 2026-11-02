/**
 * Retention: write receipts and audit events are kept for
 * ARNOLD_JOURNAL_RETENTION_DAYS (default 30) and then deleted, together with
 * setup sessions that expired without being completed. Training data and a
 * completed setup are kept until the account is deleted.
 *
 * The deletion itself is the SQL function `arnold.prune`.
 */
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

/** Runs `run` now and then once a day; a failed pass retries the next day. */
export function scheduleRetention(
  run: () => Promise<unknown>,
  intervalMs = DAY_MS,
): { stop(): void; ready: Promise<void> } {
  const once = () =>
    run().then(
      () => undefined,
      () => {
        // Logged by the caller without content.
      },
    );
  const ready = once();
  const timer = setInterval(() => void once(), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), ready };
}
