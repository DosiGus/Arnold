/**
 * UX-007: is the current plan on the user's watch?
 *
 * The answer comes only from evidence: the mark the server computes over what
 * GET /plan delivers (`planMark`) against the marks the watches confirmed
 * (arnold.watch_plan_receipts). Fails closed: without an active plan, with a
 * read error or with a watch app that cannot confirm, the answer is
 * `unknown`, never `delivered`.
 */
import {
  strengthTrainingView,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import {
  WATCH_ACK_MIN_APP_VERSION,
  type WatchDelivery,
} from "../../shared/watch-contract.js";
import type { Database } from "../db/database.js";
import { planMark } from "./plan.js";

/** One active watch: its app version and the mark it confirmed last, if any. */
export interface WatchReceiptState {
  app_version: string;
  plan_mark: string | null;
}

/** -1, 0 or 1 for two MAJOR.MINOR.PATCH strings; null when one is not semver. */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) =>
    /^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null;
  const x = parse(a),
    y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

/** A watch that can confirm: it already did once, or its app version can. */
const canConfirm = (watch: WatchReceiptState) =>
  watch.plan_mark !== null ||
  (compareVersions(watch.app_version, WATCH_ACK_MIN_APP_VERSION) ?? -1) >= 0;

/**
 * The rule, pure. `mark` is null when there is no plan to deliver.
 * delivered as soon as ONE active watch confirmed the current mark.
 */
export function deliveryOf(
  mark: string | null,
  watches: readonly WatchReceiptState[],
): WatchDelivery {
  if (watches.length === 0) return "no_watch";
  if (mark === null) return "unknown";
  if (watches.some((w) => w.plan_mark === mark)) return "delivered";
  if (watches.some(canConfirm)) return "pending";
  return "unknown";
}

/** The mark of what the watch would load now, or null without a plan. */
export function currentPlanMark(dataset: ArnoldDataset): string | null {
  try {
    // The watch routes never see runs or planned workouts (RUN-003).
    return planMark(strengthTrainingView(dataset));
  } catch {
    return null;
  }
}

/** The user's active watches with their last confirmed mark (own rows only). */
export async function readWatchReceipts(
  db: Database,
  userId: string,
): Promise<WatchReceiptState[]> {
  return db.asUser(
    userId,
    async (c) =>
      (
        await c.query<WatchReceiptState>(
          `select d.app_version, r.plan_mark
             from arnold.watch_devices d
             left join arnold.watch_plan_receipts r
               on r.user_id = d.user_id and r.device_id = d.device_id
            where d.user_id = $1 and d.status = 'active'`,
          [userId],
        )
      ).rows,
  );
}

/** For the cards: never throws; any failure is `unknown`. */
export async function watchDelivery(
  db: Database,
  userId: string,
  dataset: ArnoldDataset,
): Promise<WatchDelivery> {
  try {
    return deliveryOf(
      currentPlanMark(dataset),
      await readWatchReceipts(db, userId),
    );
  } catch {
    return "unknown";
  }
}
