/**
 * UX-007 honest watch status: the plan mark, the watch's confirmation
 * (POST /plan/ack) and the rule behind watch_delivery. The routes run against
 * the real test Postgres with the real token check; the dataset is the
 * invented demo history on a fixed day, so nothing depends on the clock or
 * the time zone.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../src/shared/arnold-schema-v1.js";
import { WatchPlanDirectorySchema } from "../src/shared/watch-contract.js";
import { demoHistoryDataset } from "../src/server/plan/demo-history.js";
import {
  buildDirectory,
  planMark,
  planRoutes,
} from "../src/server/watch/plan.js";
import {
  compareVersions,
  currentPlanMark,
  deliveryOf,
  watchDelivery,
} from "../src/server/watch/delivery.js";
import { mountWatchApi } from "../src/server/watch/router.js";
import type { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import {
  hashWatchToken,
  newWatchToken,
} from "../src/server/auth/watch-token.js";
import { PostgresIdentityRepository } from "../src/server/db/identity.js";
import { appDatabase, newAccount } from "./fixtures/arnold-db.js";

const TODAY = "2026-11-09";
const MARK = "0123456789abcdef";
const OTHER = "fedcba9876543210";

/** The demo plan with one planned rest changed: a new plan state. */
function withChangedRest(dataset: ArnoldDataset): ArnoldDataset {
  const active = dataset.plans.find((p) => p.status === "active")!;
  let changed = false;
  return ArnoldDatasetSchema.parse({
    ...dataset,
    planItems: dataset.planItems.map((item) => {
      if (changed || item.plan_version_id !== active.plan_version_id)
        return item;
      changed = true;
      return { ...item, rest_seconds: (item.rest_seconds ?? 120) + 15 };
    }),
  });
}

describe("watch_delivery rule (pure)", () => {
  it("is no_watch without an active watch, whatever the plan", () => {
    expect(deliveryOf(MARK, [])).toBe("no_watch");
    expect(deliveryOf(null, [])).toBe("no_watch");
  });

  it("is delivered only when one watch confirmed exactly the current mark", () => {
    expect(
      deliveryOf(MARK, [
        { app_version: "0.2.0", plan_mark: OTHER },
        { app_version: "0.2.0", plan_mark: MARK },
      ]),
    ).toBe("delivered");
    expect(deliveryOf(MARK, [{ app_version: "0.2.0", plan_mark: OTHER }])).toBe(
      "pending",
    );
  });

  it("is pending for a watch app that can confirm but has not yet", () => {
    expect(deliveryOf(MARK, [{ app_version: "0.2.0", plan_mark: null }])).toBe(
      "pending",
    );
    expect(deliveryOf(MARK, [{ app_version: "1.0.0", plan_mark: null }])).toBe(
      "pending",
    );
  });

  it("is unknown for an old watch app without a mark, never delivered", () => {
    for (const app_version of ["", "0.1.0", "garbage"])
      expect(deliveryOf(MARK, [{ app_version, plan_mark: null }])).toBe(
        "unknown",
      );
  });

  it("is unknown without a plan to deliver", () => {
    expect(deliveryOf(null, [{ app_version: "0.2.0", plan_mark: MARK }])).toBe(
      "unknown",
    );
  });

  it("compares versions numerically", () => {
    expect(compareVersions("0.10.0", "0.2.0")).toBe(1);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
    expect(compareVersions("", "0.2.0")).toBeNull();
  });
});

describe("plan mark", () => {
  const demo = demoHistoryDataset(TODAY);

  it("is the same in both languages and is carried in the directory", () => {
    const de = buildDirectory(demo, "de");
    const en = buildDirectory(demo, "en");
    expect(de.v).toMatch(/^[0-9a-f]{16}$/);
    expect(en.v).toBe(de.v);
    expect(de.v).toBe(planMark(demo));
    expect(WatchPlanDirectorySchema.parse(de)).toEqual(de);
  });

  it("changes when the plan changes and is stable otherwise", () => {
    expect(planMark(demoHistoryDataset(TODAY))).toBe(planMark(demo));
    expect(planMark(withChangedRest(demo))).not.toBe(planMark(demo));
  });

  it("is null without an active plan", () => {
    const noPlan = ArnoldDatasetSchema.parse({
      ...demo,
      plans: demo.plans.map((p) => ({
        ...p,
        status: "archived" as const,
        retired_at_utc: p.retired_at_utc ?? "2026-11-01T00:00:00Z",
      })),
    });
    expect(currentPlanMark(noPlan)).toBeNull();
  });
});

describe("POST /plan/ack and watch_delivery (real Postgres)", () => {
  const db = appDatabase();
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
            s.closeAllConnections();
          }),
      ),
    );
  });
  afterAll(() => db.close());
  const sha = (v: string) => createHash("sha256").update(v).digest();

  /** One paired watch for a fresh account; `state.dataset` is what the user has. */
  async function serve() {
    const account = await newAccount(db);
    const state = { dataset: demoHistoryDataset(TODAY) };
    const runtime = {
      options: {
        db,
        auth: { assertActive: async () => {} },
        identities: new PostgresIdentityRepository(db),
      },
      forUser: async () => ({
        onboarding: { setupRequired: async () => false },
        store: { read: async () => state.dataset },
      }),
      exclusive: <T>(_c: unknown, action: () => Promise<T>) => action(),
    } as unknown as DatabaseArnoldRuntime;
    const device = sha(randomUUID()),
      code = sha(randomUUID()),
      token = newWatchToken();
    await db.query("select * from arnold.start_watch_pairing($1,$2,$3,600)", [
      device,
      code,
      "Forerunner 255",
    ]);
    await db.asUser(account.userId, (c) =>
      c.query("select * from arnold.approve_watch_pairing($1,$2)", [
        code,
        "Europe/Berlin",
      ]),
    );
    await db.query("select * from arnold.redeem_watch_pairing($1,$2,$3)", [
      device,
      hashWatchToken(token),
      `wdv_${randomUUID()}`,
    ]);
    const app = express();
    app.use(express.json());
    mountWatchApi(app, { runtime, routes: planRoutes(runtime) });
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/watch/v1`;
    const call = (
      path: string,
      init: { method?: string; body?: unknown; version?: string } = {},
    ) =>
      fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.version
            ? { "x-arnold-watch": `${init.version}/006-B3992-00` }
            : {}),
          ...(init.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    const delivery = () => watchDelivery(db, account.userId, state.dataset);
    return { account, state, call, delivery };
  }

  it("goes pending → delivered only after the watch confirms, and back to pending on a plan change", async () => {
    const { state, call, delivery } = await serve();
    // A new watch app announces itself and loads the directory.
    const directory = await call("/plan", { version: "0.2.0" });
    expect(directory.status).toBe(200);
    const { v } = (await directory.json()) as { v: string };
    // Loading alone is no proof: still pending.
    expect(await delivery()).toBe("pending");

    const ack = await call("/plan/ack", {
      method: "POST",
      body: { v },
      version: "0.2.0",
    });
    expect(ack.status).toBe(200);
    expect(await ack.json()).toMatchObject({ api_version: 1, v });
    expect(await delivery()).toBe("delivered");

    // The plan changes: the confirmed mark is no longer current.
    state.dataset = withChangedRest(state.dataset);
    expect(await delivery()).toBe("pending");
    const fresh = (await (await call("/plan")).json()) as { v: string };
    expect(fresh.v).not.toBe(v);
    await call("/plan/ack", { method: "POST", body: { v: fresh.v } });
    expect(await delivery()).toBe("delivered");
  });

  it("keeps an outdated confirmation pending", async () => {
    const { call, delivery } = await serve();
    await call("/plan/ack", {
      method: "POST",
      body: { v: OTHER },
      version: "0.2.0",
    });
    expect(await delivery()).toBe("pending");
  });

  it("is unknown for an old watch app that never sends a mark", async () => {
    const { call, delivery } = await serve();
    expect((await call("/plan", { version: "0.1.0" })).status).toBe(200);
    expect(await delivery()).toBe("unknown");
    // Without any version header as well.
    expect((await call("/plan")).status).toBe(200);
    expect(await delivery()).toBe("unknown");
  });

  it("refuses a malformed mark and stores nothing", async () => {
    const { call, delivery } = await serve();
    for (const body of [{}, { v: "XYZ" }, { v: MARK, extra: 1 }]) {
      const response = await call("/plan/ack", {
        method: "POST",
        body,
        version: "0.1.0",
      });
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    }
    expect(await delivery()).toBe("unknown");
  });

  it("refuses an ack without watch token", async () => {
    const { call } = await serve();
    const anonymous = await fetch(
      (await call("/plan")).url.replace("/plan", "/plan/ack"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ v: MARK }),
      },
    );
    expect(anonymous.status).toBe(401);
  });

  it("never shows another user's watch or confirmation", async () => {
    const alice = await serve();
    const directory = (await (
      await alice.call("/plan", { version: "0.2.0" })
    ).json()) as { v: string };
    await alice.call("/plan/ack", {
      method: "POST",
      body: { v: directory.v },
    });
    expect(await alice.delivery()).toBe("delivered");
    const bob = await newAccount(db);
    expect(await watchDelivery(db, bob.userId, alice.state.dataset)).toBe(
      "no_watch",
    );
  });

  it("is no_watch once the only watch is unpaired", async () => {
    const { account, call, delivery } = await serve();
    await call("/plan", { version: "0.2.0" });
    await db.asUser(account.userId, (c) =>
      c.query(
        "update arnold.watch_devices set status = 'revoked', revoked_at = now() where user_id = $1",
        [account.userId],
      ),
    );
    expect(await delivery()).toBe("no_watch");
  });
});
