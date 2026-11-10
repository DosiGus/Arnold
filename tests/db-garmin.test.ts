import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  appDatabase,
  asOwner,
  newAccount,
  logOneSet,
} from "./fixtures/arnold-db.js";
const db = appDatabase();
afterAll(() => db.close());
const hash = (value: string) => createHash("sha256").update(value).digest();
const tables = [
  "watch_devices",
  "health_consents",
  "workout_recordings",
  "workout_health",
];
async function start() {
  const device = hash(randomUUID()),
    user = hash(randomUUID());
  const pairing = (
    await db.query("select * from arnold.start_watch_pairing($1,$2,$3,600)", [
      device,
      user,
      "Forerunner 255",
    ])
  ).rows[0];
  return { device, user, id: pairing.pairing_id };
}
async function approve(userId: string, code: Buffer) {
  return db.asUser(
    userId,
    async (c) =>
      (
        await c.query("select * from arnold.approve_watch_pairing($1,$2)", [
          code,
          "Europe/Berlin",
        ])
      ).rows[0],
  );
}
async function paired() {
  const account = await newAccount(db),
    pairing = await start(),
    token = hash(randomUUID()),
    deviceId = `wdv_${randomUUID()}`;
  expect((await approve(account.userId, pairing.user)).result).toBe("approved");
  expect(
    (
      await db.query("select * from arnold.redeem_watch_pairing($1,$2,$3)", [
        pairing.device,
        token,
        deviceId,
      ])
    ).rows[0].result,
  ).toBe("issued");
  return { ...account, pairing, token, deviceId };
}
const resolve = async (token: Buffer) =>
  (await db.query("select * from arnold.resolve_watch_token($1)", [token]))
    .rows;
describe("Garmin migration 003 (GAR-B1-02)", () => {
  it("issues exactly one device under concurrent redemption; stores only hashes", async () => {
    const account = await newAccount(db),
      p = await start();
    await approve(account.userId, p.user);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        db.query("select * from arnold.redeem_watch_pairing($1,$2,$3)", [
          p.device,
          hash(randomUUID()),
          `wdv_${randomUUID()}`,
        ]),
      ),
    );
    expect(results.map((r) => r.rows[0].result).sort()).toEqual([
      "expired",
      "expired",
      "expired",
      "issued",
    ]);
    const rows = await db.asUser(
      account.userId,
      async (c) => (await c.query("select * from arnold.watch_devices")).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toHaveLength(32);
    expect(rows[0].timezone).toBe("Europe/Berlin");
  });
  it("approves only from current_user_id and requires an active authenticated account", async () => {
    const p = await start(),
      alice = await newAccount(db),
      bob = await newAccount(db);
    await expect(
      db.query("select * from arnold.approve_watch_pairing($1,$2)", [
        p.user,
        "Europe/Berlin",
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await approve(alice.userId, p.user)).result).toBe("approved");
    expect((await approve(bob.userId, p.user)).result).toBe("invalid");
    const owner = await asOwner(
      async (c) =>
        (
          await c.query(
            "select user_id from arnold.watch_pairings where pairing_id=$1",
            [p.id],
          )
        ).rows[0].user_id,
    );
    expect(owner).toBe(alice.userId);
  });
  it("returns pending and slow_down and refuses expired pairings", async () => {
    const p = await start();
    const poll = () =>
      db.query("select * from arnold.redeem_watch_pairing($1,$2,$3)", [
        p.device,
        hash(randomUUID()),
        `wdv_${randomUUID()}`,
      ]);
    expect((await poll()).rows[0].result).toBe("pending");
    expect((await poll()).rows[0].result).toBe("slow_down");
    await asOwner((c) =>
      c.query(
        "update arnold.watch_pairings set expires_at=now()-interval '1 second' where pairing_id=$1",
        [p.id],
      ),
    );
    expect((await poll()).rows[0].result).toBe("expired");
  });
  it("resolves only active devices of active accounts and updates last-used at most hourly", async () => {
    const a = await paired();
    expect(await resolve(a.token)).toEqual([
      {
        user_id: a.userId,
        device_id: a.deviceId,
        scopes: ["arnold.watch.read", "arnold.watch.write"],
      },
    ]);
    const last = async () =>
      db.asUser(
        a.userId,
        async (c) =>
          (await c.query("select last_used_at from arnold.watch_devices"))
            .rows[0].last_used_at,
      );
    const before = await last();
    await resolve(a.token);
    expect(await last()).toEqual(before);
    expect(await resolve(hash("unknown"))).toEqual([]);
    await asOwner((c) =>
      c.query("update arnold.users set status='DISABLED' where user_id=$1", [
        a.userId,
      ]),
    );
    expect(await resolve(a.token)).toEqual([]);
    await asOwner((c) =>
      c.query("update arnold.users set status='ACTIVE' where user_id=$1", [
        a.userId,
      ]),
    );
    await db.asUser(a.userId, (c) =>
      c.query(
        "update arnold.watch_devices set status='revoked',revoked_at=now()",
      ),
    );
    expect(await resolve(a.token)).toEqual([]);
  });
  it("previews only open pairings and allows a poll after 4 s despite jitter (D-26)", async () => {
    const p = await start();
    const preview = async () =>
      (
        await db.query("select * from arnold.preview_watch_pairing($1)", [
          p.user,
        ])
      ).rows;
    expect(await preview()).toEqual([
      { device_label: "Forerunner 255", expires_at: expect.any(Date) },
    ]);
    expect(
      (
        await db.query("select * from arnold.preview_watch_pairing($1)", [
          hash(randomUUID()),
        ])
      ).rows,
    ).toEqual([]);
    const poll = async () =>
      (
        await db.query("select * from arnold.redeem_watch_pairing($1,$2,$3)", [
          p.device,
          hash(randomUUID()),
          `wdv_${randomUUID()}`,
        ])
      ).rows[0].result;
    expect(await poll()).toBe("pending");
    // 4.5 s later, a 5 s poll that arrived early, is no longer too fast.
    await asOwner((c) =>
      c.query(
        "update arnold.watch_pairings set last_polled_at = now() - interval '4.5 seconds' where pairing_id = $1",
        [p.id],
      ),
    );
    expect(await poll()).toBe("pending");
    const account = await newAccount(db);
    await approve(account.userId, p.user);
    expect(await preview()).toEqual([]);
    const columns = await asOwner(async (c) =>
      (
        await c.query(
          "select column_name from information_schema.columns where table_schema='arnold' and table_name='watch_pairings'",
        )
      ).rows.map((r) => r.column_name),
    );
    expect(columns).not.toContain("attempts");
  });
  it("gives no direct pairing rights and no public function EXECUTE", async () => {
    for (const t of ["watch_pairings"])
      for (const sql of [
        `select * from arnold.${t}`,
        `delete from arnold.${t}`,
      ])
        await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
    const functions = await asOwner(
      async (c) =>
        (
          await c.query(`select p.proname, p.proconfig, p.prosecdef,
      exists (select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='arnold' and p.proname in ('start_watch_pairing','approve_watch_pairing','preview_watch_pairing','redeem_watch_pairing','resolve_watch_token')`)
        ).rows,
    );
    expect(functions).toHaveLength(5);
    functions.forEach((f) => {
      expect(f.prosecdef).toBe(true);
      expect(f.public_execute).toBe(false);
      expect(f.proconfig).toContain('search_path=""');
    });
  });
  it("enforces RLS on all user tables and prevents cross-user device references", async () => {
    const a = await paired(),
      b = await newAccount(db),
      session = randomUUID();
    await db.asUser(a.userId, async (c) => {
      await c.query(
        "insert into arnold.health_consents values ($1,'garmin_health','v1',now(),null)",
        [a.userId],
      );
      await c.query(
        "insert into arnold.workout_recordings values ($1,$2,$3,'2026-11-09T10:00:00Z','2026-11-09T11:00:00Z','[]','1.0.0')",
        [a.userId, session, a.deviceId],
      );
      await c.query(
        "insert into arnold.workout_health(user_id,client_session_id,hr) values($1,$2,$3)",
        [a.userId, session, { values: [92, 0, 118] }],
      );
    });
    for (const t of tables) {
      expect((await db.query(`select * from arnold.${t}`)).rowCount).toBe(0);
      expect(
        (await db.asUser(b.userId, (c) => c.query(`select * from arnold.${t}`)))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await db.asUser(b.userId, (c) =>
            c.query(`update arnold.${t} set user_id=$1`, [a.userId]),
          )
        ).rowCount,
      ).toBe(0);
    }
    await expect(
      db.asUser(b.userId, (c) =>
        c.query(
          "insert into arnold.workout_recordings values($1,$2,$3,'x','y','[]','1')",
          [b.userId, randomUUID(), a.deviceId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.asUser(b.userId, (c) =>
        c.query(
          "insert into arnold.health_consents values($1,'garmin_health','v1',now(),null)",
          [a.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await a.identities.remove(a.userId);
    const counts = await asOwner(async (c) => {
      const values: number[] = [];
      for (const table of [...tables, "watch_pairings"]) {
        values.push(
          (
            await c.query(
              `select count(*)::int as n from arnold.${table} where user_id=$1`,
              [a.userId],
            )
          ).rows[0].n,
        );
      }
      return values;
    });
    expect(counts).toEqual([0, 0, 0, 0, 0]);
  });
  it("deduplicates completed client sessions per user, permits replacing/voiding, and prunes expired pairings", async () => {
    const a = await newAccount(db),
      first = await logOneSet(a),
      second = await logOneSet(a),
      session = randomUUID();
    await db.asUser(a.userId, (c) =>
      c.query(
        "update arnold.workouts set status='completed',client_session_id=$1 where workout_id=$2",
        [session, first],
      ),
    );
    await expect(
      db.asUser(a.userId, (c) =>
        c.query(
          "update arnold.workouts set status='completed',client_session_id=$1 where workout_id=$2",
          [session, second],
        ),
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await db.asUser(a.userId, async (c) => {
      await c.query(
        "update arnold.workouts set status='voided' where workout_id=$1",
        [first],
      );
      await c.query(
        "update arnold.workouts set status='completed',client_session_id=$1 where workout_id=$2",
        [session, second],
      );
    });
    const p = await start();
    await asOwner((c) =>
      c.query(
        "update arnold.watch_pairings set expires_at=now()-interval '1 second' where pairing_id=$1",
        [p.id],
      ),
    );
    await db.query("select * from arnold.prune(30)");
    expect(
      await asOwner(
        async (c) =>
          (
            await c.query(
              "select * from arnold.watch_pairings where pairing_id=$1",
              [p.id],
            )
          ).rowCount,
      ),
    ).toBe(0);
  });
});
