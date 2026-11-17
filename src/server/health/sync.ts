/**
 * Fetches and stores the daily health values (UX-015).
 *
 * Triggered when the configured user opens the overview, at most every few
 * hours (GARMIN_DAILY_REFRESH_HOURS). It runs in the background: the
 * overview never waits for it, and nothing it does can make the overview
 * fail. Only the one user named in the configuration is ever fetched; the
 * user comes from the verified login, never from a tool argument.
 *
 * First fetch: the last 35 days (enough for the 28-day median). Later: from
 * the newest stored day (it may have been incomplete) to today.
 *
 * Writes need the active health consent (checked here, enforced again by
 * the database trigger). Every write goes through `Database.asUser`.
 */
import type { Database, Queryable } from "../db/database.js";
import type { DailyHealthConfig } from "./config.js";
import type {
  DailyHealthDay,
  DailyHealthFailure,
  DailyHealthPullSource,
} from "./source.js";

export type DailyHealthOutcome =
  "ok" | "empty" | "no_consent" | DailyHealthFailure;

export type DailyHealthRefresh =
  | { ran: false; why: "other_user" | "running" | "recent" | "no_consent" }
  | { ran: true; outcome: DailyHealthOutcome; days: number };

/** How many days the first fetch reaches back (28-day median plus margin). */
export const FIRST_FETCH_DAYS = 35;
const HEALTH_SCOPE = "garmin_health";
const DAY_MS = 86_400_000;

export interface DailyHealthSyncOptions {
  db: Database;
  config: Extract<DailyHealthConfig, { state: "active" }>;
  source: DailyHealthPullSource;
  now?: () => number;
  /** One safe line per fetch; never the key, the token or health values. */
  log?: (line: string) => void;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class DailyHealthSync {
  private running?: Promise<DailyHealthRefresh>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly options: DailyHealthSyncOptions) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** Fire and forget: never awaited by the overview, never throws. */
  onOverviewOpened(userId: string): void {
    if (userId !== this.options.config.userId) return;
    void this.refresh(userId).catch(() => {
      this.log(
        JSON.stringify({
          severity: "WARNING",
          message: "garmin daily fetch",
          outcome: "internal_error",
        }),
      );
    });
  }

  refresh(userId: string): Promise<DailyHealthRefresh> {
    if (userId !== this.options.config.userId)
      return Promise.resolve({ ran: false, why: "other_user" });
    if (this.running) return Promise.resolve({ ran: false, why: "running" });
    const run = this.run(userId).finally(() => {
      this.running = undefined;
    });
    this.running = run;
    return run;
  }

  private async run(userId: string): Promise<DailyHealthRefresh> {
    const { db, source, config } = this.options;
    const state = await db.asUser(userId, async (c) => {
      const consent = await c.query(
        `select 1 from arnold.health_consents
          where user_id = $1 and scope = $2 and revoked_at is null`,
        [userId, HEALTH_SCOPE],
      );
      const sync = await c.query<{ last_attempt_at: Date }>(
        `select last_attempt_at from arnold.health_daily_sync where user_id = $1`,
        [userId],
      );
      const newest = await c.query<{ d: string | null }>(
        `select max(local_date) as d from arnold.health_daily where user_id = $1`,
        [userId],
      );
      return {
        consent: consent.rowCount === 1,
        lastAttempt: sync.rows[0]?.last_attempt_at ?? null,
        newest: newest.rows[0]?.d ?? null,
      };
    });
    if (!state.consent) return { ran: false, why: "no_consent" };
    const now = this.now();
    if (
      state.lastAttempt &&
      now - state.lastAttempt.getTime() < config.refreshHours * 3_600_000
    )
      return { ran: false, why: "recent" };

    // Garmin's days are the user's local days; the UTC date is today or
    // yesterday for them, so the next fetch picks up the rest.
    const to = isoDay(now);
    const earliest = isoDay(now - (FIRST_FETCH_DAYS - 1) * DAY_MS);
    const from =
      state.newest && state.newest > earliest && state.newest <= to
        ? state.newest
        : earliest;

    const result = await source.fetchDays(from, to);
    const outcome = await db.asUser(userId, async (c) => {
      let outcome: DailyHealthOutcome = result.ok
        ? result.days.length > 0
          ? "ok"
          : "empty"
        : result.failure;
      let stored = 0;
      if (result.ok && result.days.length > 0) {
        // Holding the consent row: a revocation waits until this is done.
        const consent = await c.query(
          `select 1 from arnold.health_consents
            where user_id = $1 and scope = $2 and revoked_at is null for share`,
          [userId, HEALTH_SCOPE],
        );
        if (consent.rowCount !== 1) outcome = "no_consent";
        else {
          for (const day of result.days) {
            await storeDay(c, userId, source.kind, day);
            stored++;
          }
        }
      }
      await c.query(
        `insert into arnold.health_daily_sync
           (user_id, source, last_attempt_at, last_success_at, last_outcome)
         values ($1, $2, $3, case when $4 in ('ok', 'empty') then $3::timestamptz end, $4)
         on conflict (user_id) do update set
           source = excluded.source,
           last_attempt_at = excluded.last_attempt_at,
           last_success_at = coalesce(excluded.last_success_at, arnold.health_daily_sync.last_success_at),
           last_outcome = excluded.last_outcome`,
        [userId, source.kind, new Date(now), outcome],
      );
      return { outcome, stored };
    });
    this.log(
      JSON.stringify({
        severity:
          outcome.outcome === "ok" || outcome.outcome === "empty"
            ? "INFO"
            : "WARNING",
        message: "garmin daily fetch",
        outcome: outcome.outcome,
        days: outcome.stored,
      }),
    );
    return { ran: true, outcome: outcome.outcome, days: outcome.stored };
  }
}

/**
 * Inserts or updates one day. A value Garmin no longer sends stays as it
 * was (unknown is no reason to forget a known value).
 */
async function storeDay(
  c: Queryable,
  userId: string,
  source: string,
  day: DailyHealthDay,
) {
  await c.query(
    `insert into arnold.health_daily
       (user_id, local_date, source, received_at, resting_hr_bpm, stress_avg,
        body_battery_high, body_battery_end_of_day, sleep_seconds, sleep_score,
        hrv_last_night_ms, hrv_status)
     values ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (user_id, local_date) do update set
       source = excluded.source,
       received_at = excluded.received_at,
       resting_hr_bpm = coalesce(excluded.resting_hr_bpm, arnold.health_daily.resting_hr_bpm),
       stress_avg = coalesce(excluded.stress_avg, arnold.health_daily.stress_avg),
       body_battery_high = coalesce(excluded.body_battery_high, arnold.health_daily.body_battery_high),
       body_battery_end_of_day = coalesce(excluded.body_battery_end_of_day, arnold.health_daily.body_battery_end_of_day),
       sleep_seconds = coalesce(excluded.sleep_seconds, arnold.health_daily.sleep_seconds),
       sleep_score = coalesce(excluded.sleep_score, arnold.health_daily.sleep_score),
       hrv_last_night_ms = coalesce(excluded.hrv_last_night_ms, arnold.health_daily.hrv_last_night_ms),
       hrv_status = coalesce(excluded.hrv_status, arnold.health_daily.hrv_status)`,
    [
      userId,
      day.local_date,
      source,
      day.resting_hr_bpm,
      day.stress_avg,
      day.body_battery_high,
      day.body_battery_end_of_day,
      day.sleep_seconds,
      day.sleep_score,
      day.hrv_last_night_ms,
      day.hrv_status,
    ],
  );
}

/** Reads the stored days of the current user, newest last. */
export async function readDailyHealth(
  db: Database,
  userId: string,
  from: string,
): Promise<DailyHealthDay[]> {
  return db.asUser(userId, async (c) => {
    const rows = await c.query<DailyHealthDay>(
      `select local_date, resting_hr_bpm, stress_avg, body_battery_high,
              body_battery_end_of_day, sleep_seconds, sleep_score,
              hrv_last_night_ms, hrv_status
         from arnold.health_daily
        where user_id = $1 and local_date >= $2
        order by local_date`,
      [userId, from],
    );
    return rows.rows;
  });
}
