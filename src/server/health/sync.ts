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
 * Single-day endpoints (sleep stages, fitness age, training ...) are asked
 * only for the last 3 days, plus a backfill of at most BACKFILL_PER_FETCH
 * further days of the last 28 that have no raw answer stored yet (first
 * fetch, gaps, days from before the extended values existed). That keeps the
 * number of Garmin requests per fetch small; the supplier caps it as well.
 *
 * Writes need the active health consent (checked here, enforced again by
 * the database trigger). Every write goes through `Database.asUser`.
 */
import type { Database, Queryable } from "../db/database.js";
import type { DailyHealthConfig } from "./config.js";
import {
  DAILY_HEALTH_COLUMNS,
  type DailyHealthColumn,
  type DailyHealthDay,
  type DailyHealthFailure,
  type DailyHealthPullSource,
  type DailyHealthRaw,
} from "./source.js";

export type DailyHealthOutcome =
  "ok" | "empty" | "no_consent" | DailyHealthFailure;

export type DailyHealthRefresh =
  | { ran: false; why: "other_user" | "running" | "recent" | "no_consent" }
  | { ran: true; outcome: DailyHealthOutcome; days: number };

/** How many days the first fetch reaches back (28-day median plus margin). */
export const FIRST_FETCH_DAYS = 35;
/** Days at the end of the range that are always asked again in detail. */
export const RECENT_DETAIL_DAYS = 3;
/** The furthest the backfill of single-day values reaches back. */
export const BACKFILL_DAYS = 28;
/** At most this many older days are filled in per fetch. */
export const BACKFILL_PER_FETCH = 7;
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

/**
 * The days for which the single-day endpoints are asked: the last
 * RECENT_DETAIL_DAYS, then the newest days of the last BACKFILL_DAYS
 * without a stored raw answer (at most BACKFILL_PER_FETCH). Newest first.
 */
export function chooseDetailDates(today: string, withRaw: Set<string>) {
  const at = (back: number) =>
    isoDay(Date.parse(`${today}T00:00:00Z`) - back * DAY_MS);
  const dates: string[] = [];
  for (let back = 0; back < RECENT_DETAIL_DAYS; back++) dates.push(at(back));
  let filled = 0;
  for (
    let back = RECENT_DETAIL_DAYS;
    back < BACKFILL_DAYS && filled < BACKFILL_PER_FETCH;
    back++
  ) {
    if (withRaw.has(at(back))) continue;
    dates.push(at(back));
    filled++;
  }
  return dates;
}

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
      const rawDays = await c.query<{ d: string }>(
        `select distinct local_date as d from arnold.health_daily_raw
          where user_id = $1 and local_date >= $2`,
        [userId, isoDay(this.now() - (BACKFILL_DAYS - 1) * DAY_MS)],
      );
      return {
        consent: consent.rowCount === 1,
        lastAttempt: sync.rows[0]?.last_attempt_at ?? null,
        newest: newest.rows[0]?.d ?? null,
        rawDays: new Set(rawDays.rows.map((r) => r.d)),
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
    const detailDates = chooseDetailDates(to, state.rawDays);
    // The range also has to reach the backfilled days.
    const oldest = detailDates[detailDates.length - 1];
    let from =
      state.newest && state.newest > earliest && state.newest <= to
        ? state.newest
        : earliest;
    if (oldest < from) from = oldest;

    const result = await source.fetchDays(from, to, { detailDates });
    const outcome = await db.asUser(userId, async (c) => {
      let outcome: DailyHealthOutcome = result.ok
        ? result.rateLimited
          ? "rate_limited"
          : result.days.length > 0
            ? "ok"
            : "empty"
        : result.failure;
      let stored = 0;
      const raw = result.ok ? (result.raw ?? []) : [];
      if (result.ok && (result.days.length > 0 || raw.length > 0)) {
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
          for (const entry of raw) await storeRaw(c, userId, entry);
        }
      }
      // A failed fetch has no endpoint outcomes: the last known ones stay.
      const endpoints = result.ok
        ? JSON.stringify(result.endpoints ?? {})
        : null;
      await c.query(
        `insert into arnold.health_daily_sync
           (user_id, source, last_attempt_at, last_success_at, last_outcome, endpoint_outcomes)
         values ($1, $2, $3, case when $4 in ('ok', 'empty') then $3::timestamptz end, $4,
                 coalesce($5::jsonb, '{}'::jsonb))
         on conflict (user_id) do update set
           source = excluded.source,
           last_attempt_at = excluded.last_attempt_at,
           last_success_at = coalesce(excluded.last_success_at, arnold.health_daily_sync.last_success_at),
           last_outcome = excluded.last_outcome,
           endpoint_outcomes = case when $5::jsonb is null
             then arnold.health_daily_sync.endpoint_outcomes
             else excluded.endpoint_outcomes end`,
        [userId, source.kind, new Date(now), outcome, endpoints],
      );
      return {
        outcome,
        stored,
        endpoints: result.ok ? (result.endpoints ?? {}) : undefined,
      };
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
        // Endpoint names with ok/empty/unavailable/error: no values, no text.
        ...(outcome.endpoints ? { endpoints: outcome.endpoints } : {}),
      }),
    );
    return { ran: true, outcome: outcome.outcome, days: outcome.stored };
  }
}

const COLUMNS = Object.keys(DAILY_HEALTH_COLUMNS) as DailyHealthColumn[];

// Built once from the column list: every value column, unknown (null) never
// overwrites a known value.
const UPSERT_DAY = `insert into arnold.health_daily
       (user_id, local_date, source, received_at, ${COLUMNS.join(", ")})
     values ($1, $2, $3, now(), ${COLUMNS.map((_, i) => `$${i + 4}`).join(", ")})
     on conflict (user_id, local_date) do update set
       source = excluded.source,
       received_at = excluded.received_at,
       ${COLUMNS.map((k) => `${k} = coalesce(excluded.${k}, arnold.health_daily.${k})`).join(",\n       ")}`;

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
  await c.query(UPSERT_DAY, [
    userId,
    day.local_date,
    source,
    ...COLUMNS.map((k) => day[k]),
  ]);
}

/**
 * Stores one cleaned Garmin answer (replacing the one of the same day and
 * endpoint). In a savepoint: an answer the database refuses (size, text it
 * cannot hold) is dropped on its own and never takes the day values with it.
 * The missing consent is no refused answer: it surfaces.
 */
async function storeRaw(c: Queryable, userId: string, entry: DailyHealthRaw) {
  await c.query("savepoint health_raw");
  try {
    await c.query(
      `insert into arnold.health_daily_raw (user_id, local_date, endpoint, payload, received_at)
       values ($1, $2, $3, $4::jsonb, now())
       on conflict (user_id, local_date, endpoint) do update set
         payload = excluded.payload, received_at = excluded.received_at`,
      [userId, entry.local_date, entry.endpoint, JSON.stringify(entry.payload)],
    );
    await c.query("release savepoint health_raw");
  } catch (error) {
    if (/health consent/i.test(String((error as Error).message))) throw error;
    await c.query("rollback to savepoint health_raw");
  }
}

// Numeric columns come back from the database as text: cast to numbers.
const SELECT_COLUMNS = `local_date, ${COLUMNS.map((k) =>
  DAILY_HEALTH_COLUMNS[k] === "num" ? `${k}::float8 as ${k}` : k,
).join(", ")}`;

/**
 * The stored days of the user from `from` to `to` (both inclusive, YYYY-MM-DD;
 * `to` optional), oldest first, with every value column. Read only, for use
 * inside a transaction of `Database.asUser` (the analyses). Unknown is null.
 */
export async function selectDailyHealth(
  c: Queryable,
  userId: string,
  from: string,
  to?: string,
): Promise<DailyHealthDay[]> {
  const rows = await c.query<DailyHealthDay>(
    `select ${SELECT_COLUMNS}
       from arnold.health_daily
      where user_id = $1 and local_date >= $2 and local_date <= $3
      order by local_date`,
    [userId, from, to ?? "9999-12-31"],
  );
  return rows.rows;
}

/** Reads the stored days of the current user from `from` on, newest last. */
export async function readDailyHealth(
  db: Database,
  userId: string,
  from: string,
): Promise<DailyHealthDay[]> {
  return db.asUser(userId, (c) => selectDailyHealth(c, userId, from));
}

/** Reads the stored days of the current user from `from` to `to`, oldest first. */
export async function readDailyHealthRange(
  db: Database,
  userId: string,
  from: string,
  to: string,
): Promise<DailyHealthDay[]> {
  return db.asUser(userId, (c) => selectDailyHealth(c, userId, from, to));
}

/**
 * The cleaned Garmin answers of the user for a period, to read the days again
 * when a field name turns out different from the assumed one.
 */
export async function readDailyHealthRaw(
  db: Database,
  userId: string,
  from: string,
  to: string,
  endpoint?: string,
): Promise<DailyHealthRaw[]> {
  return db.asUser(userId, async (c) => {
    const rows = await c.query<DailyHealthRaw>(
      `select local_date, endpoint, payload
         from arnold.health_daily_raw
        where user_id = $1 and local_date >= $2 and local_date <= $3
          and ($4::text is null or endpoint = $4)
        order by local_date, endpoint`,
      [userId, from, to, endpoint ?? null],
    );
    return rows.rows;
  });
}
