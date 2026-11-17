/**
 * UX-009: the watch values for the recovery score against the real test
 * Postgres. Only with active consent, only the caller's own rows, and a
 * revocation stops them at once. All values are invented; the instant is
 * fixed, nothing depends on the clock.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readScoreHealth } from "../src/server/db/runtime";
import { appDatabase, newAccount } from "./fixtures/arnold-db.js";

const db = appDatabase();
afterAll(() => db.close());

type Account = Awaited<ReturnType<typeof newAccount>>;
const NOW = new Date("2026-11-16T07:00:00Z");

const grant = (a: Account) =>
  db.asUser(a.userId, (c) =>
    c.query(
      `insert into arnold.health_consents (user_id, scope, text_version, granted_at)
       values ($1, 'garmin_health', 'test', now())`,
      [a.userId],
    ),
  );
const revoke = (a: Account) =>
  db.asUser(a.userId, (c) =>
    c.query(
      `update arnold.health_consents set revoked_at = now()
        where user_id = $1 and scope = 'garmin_health' and revoked_at is null`,
      [a.userId],
    ),
  );
const insertDay = (a: Account, date: string, values: Record<string, number>) =>
  db.asUser(a.userId, (c) =>
    c.query(
      `insert into arnold.health_daily
         (user_id, local_date, source, resting_hr_bpm, sleep_score, hrv_last_night_ms, body_battery_high)
       values ($1, $2, 'garmin_personal', $3, $4, $5, $6)`,
      [
        a.userId,
        date,
        values.resting ?? null,
        values.sleep ?? null,
        values.hrv ?? null,
        values.battery ?? null,
      ],
    ),
  );

describe("readScoreHealth", () => {
  it("reads nothing without consent", async () => {
    const a = await newAccount(db);
    expect(await readScoreHealth(db, a.userId, "2026-11-16", NOW)).toEqual({
      status: "no_consent",
    });
  });

  it("reads only the caller's own days inside the window", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await grant(alice);
    await grant(bob);
    await insertDay(alice, "2026-11-16", { resting: 52, sleep: 81, hrv: 47 });
    await insertDay(alice, "2026-10-01", { resting: 49 }); // too old
    await insertDay(bob, "2026-11-16", { resting: 61 });
    const health = await readScoreHealth(db, alice.userId, "2026-11-16", NOW);
    expect(health).toEqual({
      status: "consented",
      daily: [
        {
          local_date: "2026-11-16",
          resting_hr_bpm: 52,
          body_battery_high: null,
          body_battery_end_of_day: null,
          sleep_seconds: null,
          sleep_score: 81,
          hrv_last_night_ms: 47,
        },
      ],
      before: [],
      now_utc: NOW.toISOString(),
    });
  });

  it("stops at once after a revocation", async () => {
    const a = await newAccount(db);
    await grant(a);
    await insertDay(a, "2026-11-15", { battery: 70 });
    expect(
      (await readScoreHealth(db, a.userId, "2026-11-16", NOW)).status,
    ).toBe("consented");
    await revoke(a);
    expect(await readScoreHealth(db, a.userId, "2026-11-16", NOW)).toEqual({
      status: "no_consent",
    });
  });
});
