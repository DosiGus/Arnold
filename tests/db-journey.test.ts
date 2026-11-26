/**
 * The whole product path for signed-in users, end to end: real HTTP, real MCP,
 * real token verification and the real Postgres. Two people use Arnold at the
 * same time; neither ever sees the other.
 */
import { deleteConfirmation } from "../src/views/model/settings";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  hashWatchToken,
  newWatchToken,
} from "../src/server/auth/watch-token.js";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/server/http.js";
import { buildAuthSurface } from "../src/server/auth/router.js";
import { loadAuthConfig } from "../src/server/auth/config.js";
import { fetchAuthorizationServerMetadata } from "../src/server/auth/discovery.js";
import { PostgresIdentityRepository } from "../src/server/db/identity.js";
import { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import type { Database } from "../src/server/db/database.js";
import {
  OnboardingResponseSchema,
  OnboardingViewSchema,
} from "../src/shared/onboarding-contract.js";
import {
  WriteResponseSchema,
  WorkoutContextSchema,
} from "../src/shared/workout-contract.js";
import {
  ArnoldDashboardViewSchema,
  ArnoldWorkoutHistoryViewSchema,
} from "../src/shared/arnold-view.js";
import { HEALTH_CONSENT_TEXT_VERSION } from "../src/server/mcp-watch.js";
import {
  DeleteAccountConfirmSchema,
  StoredDataSchema,
} from "../src/shared/account-contract.js";
import { TOOL_ACCESS } from "../src/server/auth/tool-access.js";
import {
  jwksDocument,
  makeRsaKey,
  signJwt,
  validClaims,
} from "./fixtures/arnold-auth.js";
import { missingHints } from "./fixtures/tool-hints.js";
import { appDatabase } from "./fixtures/arnold-db.js";
import { PostgresOnboardingRepository } from "../src/server/db/onboarding.js";
import type { OnboardingRecord } from "../src/server/onboarding/repository.js";
import { asCard } from "./fixtures/card-view";

const key = makeRsaKey("journey-issuer");
const scopes = "arnold.read arnold.write arnold.plan arnold.account";
let issuerHttp: Server, issuer: string;
let http: Server, base: string;
let db: Database;
let runtime: DatabaseArnoldRuntime;
const clients = new Map<string, Client>();
// Subjects are unique per test run, so the shared test database never mixes.
let alice: string, bob: string;

const portOf = (server: Server) => (server.address() as { port: number }).port;
const listen = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    if (!server?.listening) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
const tokenFor = (subject: string, scope = scopes) =>
  signJwt(
    key,
    validClaims({ iss: issuer, aud: `${base}/mcp`, sub: subject, scope }),
  );

beforeAll(async () => {
  issuerHttp = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.url?.includes("jwks")
          ? jwksDocument(key)
          : {
              issuer,
              authorization_endpoint: `${issuer}authorize`,
              token_endpoint: `${issuer}token`,
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            },
      ),
    );
  }).listen(0, "127.0.0.1");
  await listen(issuerHttp);
  issuer = `http://127.0.0.1:${portOf(issuerHttp)}/`;
  db = appDatabase(10);
});
afterAll(async () => {
  await close(issuerHttp);
  await db.close();
});
beforeEach(async () => {
  alice = `alice-${randomUUID()}`;
  bob = `bob-${randomUUID()}`;
  const probe = createServer().listen(0, "127.0.0.1");
  await listen(probe);
  base = `http://127.0.0.1:${portOf(probe)}`;
  await close(probe);
  const config = loadAuthConfig({
    ARNOLD_ENV: "development",
    AUTH_MODE: "oidc",
    ARNOLD_PUBLIC_BASE_URL: base,
    AUTH_ISSUER: issuer,
    AUTH_JWKS_URI: `${issuer}jwks`,
    IDENTITY_STORE: "postgres",
    DATABASE_URL: "postgres://injected",
  });
  const identities = new PostgresIdentityRepository(db);
  const auth = buildAuthSurface({
    config,
    repository: identities,
    authorizationServerMetadata: await fetchAuthorizationServerMetadata({
      issuer,
    }),
  });
  runtime = new DatabaseArnoldRuntime({
    db,
    auth,
    identities,
    retentionDays: 30,
  });
  http = createHttpApp({ auth, database: runtime }).listen(
    Number(new URL(base).port),
    "127.0.0.1",
  );
  await listen(http);
});
afterEach(async () => {
  await Promise.all([...clients.values()].map((client) => client.close()));
  clients.clear();
  await close(http);
});

async function clientFor(subject: string, scope = scopes) {
  const id = `${subject}:${scope}`;
  let client = clients.get(id);
  if (!client) {
    client = new Client({ name: "db-journey", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: {
          headers: { authorization: `Bearer ${tokenFor(subject, scope)}` },
        },
      }),
    );
    clients.set(id, client);
  }
  return client;
}
async function call(
  subject: string,
  name: string,
  args: Record<string, unknown> = {},
  scope = scopes,
) {
  return asCard(
    (await (
      await clientFor(subject, scope)
    ).callTool({ name, arguments: args })) as CallToolResult,
  );
}

/** Runs the setup up to and including the confirmation. */
async function setup(subject: string, person: Record<string, unknown> = {}) {
  const opened = OnboardingViewSchema.parse(
    (await call(subject, "show_arnold_onboarding", {})).structuredContent,
  );
  const claim = {};
  const profile = OnboardingResponseSchema.parse(
    (
      await call(subject, "update_onboarding_profile", {
        ...claim,
        request_id: randomUUID(),
        profile: {
          path: "arnold_plan",
          person,
          training: {
            primary_goal: "strength",
            experience: "intermediate",
            days_per_week: 3,
            session_minutes: 60,
            environment: "gym",
          },
        },
      })
    ).structuredContent,
  );
  expect(profile.ok, profile.error?.message).toBe(true);
  const proposed = OnboardingResponseSchema.parse(
    (
      await call(subject, "submit_onboarding_plan_proposal", {
        ...claim,
        request_id: randomUUID(),
        name: "Mein Trainingsplan",
        origin: "manual",
        sessions: ["bench-press", "lat-pulldown", "squat"].map(
          (exercise_id, i) => ({
            session_name: `Einheit ${i + 1}`,
            exercises: [
              { exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 },
            ],
          }),
        ),
      })
    ).structuredContent,
  );
  expect(proposed.ok, proposed.error?.message).toBe(true);
  const plan = proposed.state!.plan!;
  const confirmed = OnboardingResponseSchema.parse(
    (
      await call(subject, "confirm_onboarding_plan", {
        ...claim,
        request_id: randomUUID(),
        confirmation: {
          plan_version_id: plan.plan_version_id,
          row_revision: plan.row_revision,
          confirmed: true,
        },
      })
    ).structuredContent,
  );
  expect(confirmed.ok, confirmed.error?.message).toBe(true);
  return { claim, plan, confirmed };
}

const setInput = {
  exercise_id: "bench-press",
  set_type: "working",
  reps: 10,
  reps_basis: "total",
  load_kg: 60,
  load_basis: "total",
  implement_count: 1,
  execution_mode: "bilateral_simultaneous",
  side: "both",
};

describe("signed-in users with the database", () => {
  it("refuses requests without a valid login", async () => {
    expect((await fetch(`${base}/mcp`, { method: "POST" })).status).toBe(401);
    const forged = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signJwt(makeRsaKey("other"), validClaims({ iss: issuer, aud: `${base}/mcp`, sub: alice, scope: scopes }))}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(forged.status).toBe(401);
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({
      auth: "oidc",
      source: "arnold_database",
      synthetic: false,
    });
  });

  it("classifies every tool and shows the account tools", async () => {
    const tools = (await (await clientFor(alice)).listTools()).tools;
    const names = tools.map((tool) => tool.name);
    for (const name of names) expect(TOOL_ACCESS[name], name).toBeDefined();
    expect(missingHints(tools)).toEqual([]);
    for (const name of [
      "get_arnold_stored_data",
      "delete_arnold_account",
      "finish_arnold_setup",
    ])
      expect(names).toContain(name);
    expect(names.some((name) => name.includes("google"))).toBe(false);
  });

  it("sends a new user to the setup before any training tool", async () => {
    for (const name of ["show_arnold_dashboard", "get_arnold_dashboard"]) {
      const result = await call(alice, name, {});
      expect(result.isError, name).toBe(true);
      expect(JSON.stringify(result.content)).toContain("SETUP_REQUIRED");
    }
    const early = await call(alice, "start_workout", {
      request_id: randomUUID(),
      workout_date_local: "2026-10-29",
      timezone: "Europe/Berlin",
      session_name: "Zu früh",
    });
    expect(early.isError).toBe(true);
  });

  it("completes the setup with the confirmation, activating exactly that plan", async () => {
    const { confirmed, plan } = await setup(alice, { body_weight_kg: 82.5 });
    expect(confirmed.state?.session.status).toBe("COMPLETED");
    const active = (await call(alice, "get_training_plan", {}))
      .structuredContent as {
      plan: { plan_version_id: string; status: string; row_revision: number };
    };
    expect(active.plan.plan_version_id).toBe(plan.plan_version_id);
    expect(active.plan.status).toBe("active");
    expect(active.plan.row_revision).toBe(plan.row_revision + 1);
    // The setup runs once per account, in every new chat.
    const again = OnboardingViewSchema.parse(
      (await call(alice, "show_arnold_onboarding", {})).structuredContent,
    );
    expect(again.state.session.status).toBe("COMPLETED");
    expect(again).not.toHaveProperty("session_token");
    const dashboard = await call(alice, "get_arnold_dashboard", {});
    expect(dashboard.isError, JSON.stringify(dashboard.content)).toBeFalsy();
    const view = ArnoldDashboardViewSchema.parse(dashboard.structuredContent);
    // The weight from the setup is the first entry on the goals card.
    expect(view.home.latest_body_weight?.weight_kg).toBe(82.5);
  });

  it("logs a training and keeps it strictly to its owner", async () => {
    await setup(alice);
    await setup(bob);
    const started = WriteResponseSchema.parse(
      (
        await call(alice, "start_workout", {
          request_id: randomUUID(),
          workout_date_local: "2026-10-29",
          timezone: "Europe/Berlin",
          session_name: "Einheit 1",
        })
      ).structuredContent,
    );
    expect(started.ok, started.error?.message).toBe(true);
    const workoutId = started.result!.workout!.workout_id;
    const logInput = {
      request_id: randomUUID(),
      workout_id: workoutId,
      sets: [setInput],
    };
    const logged = WriteResponseSchema.parse(
      (await call(alice, "log_workout_sets", logInput)).structuredContent,
    );
    expect(logged.ok, logged.error?.message).toBe(true);
    // A lost answer is retried with the same id: replayed, never doubled.
    const retried = WriteResponseSchema.parse(
      (await call(alice, "log_workout_sets", logInput)).structuredContent,
    );
    expect(retried.replayed).toBe(true);
    const own = WorkoutContextSchema.parse(
      (await call(alice, "get_workout", { workout_id: workoutId }))
        .structuredContent,
    );
    expect(own.sets).toHaveLength(1);

    // Bob knows the id and still cannot read or touch it.
    const foreign = await call(bob, "get_workout", { workout_id: workoutId });
    expect(foreign.isError).toBe(true);
    const write = WriteResponseSchema.parse(
      (
        await call(bob, "log_workout_sets", {
          request_id: randomUUID(),
          workout_id: workoutId,
          sets: [setInput],
        })
      ).structuredContent,
    );
    expect(write.ok).toBe(false);
    const bobs = (await call(bob, "get_arnold_workouts", {}))
      .structuredContent as { workouts?: unknown[] };
    expect(JSON.stringify(bobs)).not.toContain(workoutId);
    const completed = WriteResponseSchema.parse(
      (
        await call(alice, "complete_workout", {
          request_id: randomUUID(),
          workout_id: workoutId,
          expected_row_revision: own.workout!.row_revision,
        })
      ).structuredContent,
    );
    expect(completed.ok, completed.error?.message).toBe(true);
    const alices = (await call(alice, "get_arnold_workouts", {}))
      .structuredContent;
    expect(JSON.stringify(alices)).toContain(workoutId);
    const bobsAfter = (await call(bob, "get_arnold_workouts", {}))
      .structuredContent;
    expect(JSON.stringify(bobsAfter)).not.toContain(workoutId);
  });

  it("logs a planned workout in one step, edits it and takes it back", async () => {
    await setup(alice);
    await setup(bob);
    const write = async (
      subject: string,
      name: string,
      args: Record<string, unknown>,
    ) =>
      WriteResponseSchema.parse(
        (await call(subject, name, { request_id: randomUUID(), ...args }))
          .structuredContent,
      );
    const context = WorkoutContextSchema.parse(
      (await call(alice, "get_workout", {})).structuredContent,
    );
    const day = context.proposals[0];
    expect(day.session_name).toBe("Einheit 1");
    // The setup's plan carries Arnold's start weight: nothing to fill in.
    expect(day.exercises[0].missing).toEqual([]);
    expect(day.exercises[0].sets[0].load_kg).toBeGreaterThan(0);
    const session = {
      timezone: "Europe/Berlin",
      plan_version_id: day.plan_version_id,
      session_id: day.session_id,
    };
    const first = await write(alice, "log_workout", {
      ...session,
      workout_date_local: "2026-10-28",
      exercises: [{ plan_item_id: day.exercises[0].plan_item_id, load_kg: 60 }],
    });
    expect(first.ok, first.error?.message).toBe(true);
    expect(first.result!.workout!.status).toBe("completed");
    expect(first.result!.sets).toHaveLength(3);

    // "So gemacht" with no changes saves Arnold's recommendation: every set
    // reached the plan's repetitions, so one step more, from the bottom.
    const next = WorkoutContextSchema.parse(
      (await call(alice, "get_workout", {})).structuredContent,
    ).proposals[0].exercises[0];
    expect(next.source).toBe("progression");
    expect(next.progression?.decision).toBe("increase");
    const again = await write(alice, "log_workout", {
      ...session,
      workout_date_local: "2026-10-30",
    });
    expect(again.ok, again.error?.message).toBe(true);
    const bench = again.result!.sets.filter(
      (s) => s.exercise_id === day.exercises[0].exercise_id,
    );
    expect(bench.map((s) => s.load_kg)).toEqual([62.5, 62.5, 62.5]);
    expect(bench.map((s) => s.reps)).toEqual(next.sets.map((s) => s.reps));

    // Bob knows the id and still cannot replace or take it back.
    const foreign = await write(bob, "void_workout", {
      workout_id: again.result!.workout!.workout_id,
      expected_row_revision: 1,
      correction_reason: "Fremd",
    });
    expect(foreign.ok).toBe(false);

    const edited = await write(alice, "log_workout", {
      ...session,
      workout_date_local: "2026-10-30",
      replaces_workout_id: again.result!.workout!.workout_id,
      expected_row_revision: 1,
      exercises: [
        { plan_item_id: day.exercises[0].plan_item_id, load_kg: 62.5 },
      ],
    });
    expect(edited.ok, edited.error?.message).toBe(true);
    const undone = await write(alice, "void_workout", {
      workout_id: edited.result!.workout!.workout_id,
      expected_row_revision: 1,
      correction_reason: "Versehentlich",
    });
    expect(undone.ok, undone.error?.message).toBe(true);
    expect(undone.result!.workout!.status).toBe("voided");
    const history = JSON.stringify(
      (await call(alice, "get_arnold_workouts", {})).structuredContent,
    );
    expect(history).toContain(first.result!.workout!.workout_id);
  });

  it("pairs a watch, loads the plan and uploads a training that ChatGPT then shows (GAR-B2-06)", async () => {
    await setup(alice);
    await setup(bob);
    // Pairing through the 003 functions; the pairing endpoints and the
    // confirmation tool follow with GAR-B2-03.
    const identities = new PostgresIdentityRepository(db);
    const userId = (await identities.find(issuer, alice))!.user.user_id;
    const sha = (v: string) => createHash("sha256").update(v).digest();
    const device = sha(randomUUID()),
      code = sha(randomUUID()),
      token = newWatchToken();
    await db.query("select * from arnold.start_watch_pairing($1,$2,$3,600)", [
      device,
      code,
      "Forerunner 255",
    ]);
    await db.asUser(userId, (c) =>
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
    const watch = (path: string, init: RequestInit = {}) =>
      fetch(`${base}/api/watch/v1${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "accept-language": "de",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      });
    const directory = await (await watch("/plan")).json();
    const day = await (await watch(`/plan/sessions/${directory.next}`)).json();
    expect(day.items.length).toBeGreaterThan(0);
    const date = "2026-11-03";
    const t0 = Date.parse(`${date}T17:00:00Z`) / 1000;
    const uploaded = await watch("/workouts", {
      method: "POST",
      body: JSON.stringify({
        request_id: `gw_${randomUUID()}`,
        session_uuid: randomUUID(),
        plan_version_id: directory.p,
        session_id: directory.next,
        workout_date_local: date,
        utc_offset_min: 60,
        started_at_utc: `${date}T17:00:00Z`,
        ended_at_utc: `${date}T17:40:00Z`,
        exercises: day.items.map((item: { id: string; c: number }) => ({
          plan_item_id: item.id,
          exercise_id: day.cat[item.c].id,
          sets: [
            {
              reps: 10,
              load_g: 60000,
              side: "both",
              t0: t0 + 60,
              t1: t0 + 100,
            },
          ],
        })),
      }),
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { workout_id } = await uploaded.json();
    const history = JSON.stringify(
      (await call(alice, "get_arnold_workouts", {})).structuredContent,
    );
    expect(history).toContain(workout_id);
    // Bob's ChatGPT does not see it.
    expect(
      JSON.stringify(
        (await call(bob, "get_arnold_workouts", {})).structuredContent,
      ),
    ).not.toContain(workout_id);
  });

  it("says the plan is on the watch only after the watch confirmed it (UX-007)", async () => {
    const carol = `carol-${randomUUID()}`;
    const dave = `dave-${randomUUID()}`;
    await setup(carol);
    await setup(dave);
    const delivery = async (subject: string) =>
      (
        (await call(subject, "get_arnold_dashboard", {})).structuredContent as {
          watch_delivery?: string;
        }
      ).watch_delivery;
    expect(await delivery(carol)).toBe("no_watch");

    const identities = new PostgresIdentityRepository(db);
    const userId = (await identities.find(issuer, carol))!.user.user_id;
    const sha = (v: string) => createHash("sha256").update(v).digest();
    const device = sha(randomUUID()),
      code = sha(randomUUID()),
      token = newWatchToken();
    await db.query("select * from arnold.start_watch_pairing($1,$2,$3,600)", [
      device,
      code,
      "Forerunner 255",
    ]);
    await db.asUser(userId, (c) =>
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
    const watch = (path: string, version: string, body?: unknown) =>
      fetch(`${base}/api/watch/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "accept-language": "en",
          "x-arnold-watch": `${version}/006-B3992-00`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    // An old watch app loads the plan but cannot confirm: unknown.
    const old = await (await watch("/plan", "0.1.0")).json();
    expect(old.v).toMatch(/^[0-9a-f]{16}$/);
    expect(await delivery(carol)).toBe("unknown");
    // The new app loads (in English) and confirms: delivered.
    const directory = await (await watch("/plan", "0.2.0")).json();
    expect(await delivery(carol)).toBe("pending");
    const ack = await watch("/plan/ack", "0.2.0", { v: directory.v });
    expect(ack.status, await ack.clone().text()).toBe(200);
    expect(await delivery(carol)).toBe("delivered");
    // Dave sees nothing of Carol's watch.
    expect(await delivery(dave)).toBe("no_watch");

    // A new plan version is activated: the activation answer says pending.
    const plan = (
      (await call(carol, "get_training_plan", {})).structuredContent as {
        plan: { plan_version_id: string };
      }
    ).plan;
    const created = (
      await call(carol, "create_plan_version", {
        request_id: randomUUID(),
        source_plan_version_id: plan.plan_version_id,
      })
    ).structuredContent as {
      result: {
        plan: { version: { plan_version_id: string; row_revision: number } };
      };
    };
    const draft = created.result.plan.version;
    const activated = (
      await call(carol, "activate_training_plan", {
        request_id: randomUUID(),
        plan_version_id: draft.plan_version_id,
        expected_row_revision: draft.row_revision,
        confirmation: {
          plan_version_id: draft.plan_version_id,
          row_revision: draft.row_revision,
          confirmed: true,
        },
      })
    ).structuredContent as { ok: boolean; watch_delivery?: string };
    expect(activated.ok).toBe(true);
    expect(activated.watch_delivery).toBe("pending");
    expect(await delivery(carol)).toBe("pending");
    const next = await (await watch("/plan", "0.2.0")).json();
    expect(next.v).not.toBe(directory.v);
    await watch("/plan/ack", "0.2.0", { v: next.v });
    expect(await delivery(carol)).toBe("delivered");
  });

  it("shows a watch training with its recording and health data only to its owner (GAR-B5-02)", async () => {
    await setup(alice);
    await setup(bob);
    const identities = new PostgresIdentityRepository(db);
    const userId = (await identities.find(issuer, alice))!.user.user_id;
    const sha = (v: string) => createHash("sha256").update(v).digest();
    const device = sha(randomUUID()),
      code = sha(randomUUID()),
      token = newWatchToken();
    await db.query("select * from arnold.start_watch_pairing($1,$2,$3,600)", [
      device,
      code,
      "Forerunner 255",
    ]);
    await db.asUser(userId, (c) =>
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
    const watch = (path: string, init: RequestInit = {}) =>
      fetch(`${base}/api/watch/v1${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "accept-language": "de",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      });
    const consent = await call(alice, "set_garmin_health_consent", {
      granted: true,
      text_version: HEALTH_CONSENT_TEXT_VERSION,
    });
    expect(consent.isError, JSON.stringify(consent.content)).toBeFalsy();
    const directory = await (await watch("/plan")).json();
    const day = await (await watch(`/plan/sessions/${directory.next}`)).json();
    const date = "2026-11-04";
    const t0 = Date.parse(`${date}T17:00:00Z`) / 1000;
    const session = randomUUID();
    // Two sets of the first plan position, 150 s apart.
    const item = day.items[0] as { id: string; c: number };
    const uploaded = await watch("/workouts", {
      method: "POST",
      body: JSON.stringify({
        request_id: `gw_${randomUUID()}`,
        session_uuid: session,
        plan_version_id: directory.p,
        session_id: directory.next,
        workout_date_local: date,
        utc_offset_min: 60,
        started_at_utc: `${date}T17:00:00Z`,
        ended_at_utc: `${date}T17:45:00Z`,
        exercises: [
          {
            plan_item_id: item.id,
            exercise_id: day.cat[item.c].id,
            sets: [
              { reps: 10, load_g: 60000, side: "both", t0, t1: t0 + 40 },
              {
                reps: 10,
                load_g: 60000,
                side: "both",
                t0: t0 + 190,
                t1: t0 + 230,
              },
            ],
          },
        ],
      }),
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const { workout_id } = await uploaded.json();
    const stored = await watch(`/workouts/${session}/health`, {
      method: "PUT",
      body: JSON.stringify({
        hr: {
          interval_s: 5,
          start_utc: `${date}T17:00:00Z`,
          values: [90, 0, 120, 150],
        },
        calories_kcal: 280,
        before: { at_utc: `${date}T16:58:00Z`, body_battery: 64, stress: 31 },
        after: { at_utc: `${date}T17:47:00Z`, body_battery: 48 },
      }),
    });
    expect(stored.status, await stored.clone().text()).toBe(200);

    const history = ArnoldWorkoutHistoryViewSchema.parse(
      (await call(alice, "get_arnold_workouts", {})).structuredContent,
    );
    const shown = history.workouts.find((w) => w.workout_id === workout_id)!;
    expect(shown.from_watch).toBe(true);
    expect(shown.watch).toMatchObject({
      duration_s: 2700,
      rest: { measured_pauses: 1, actual_s: 150 },
      health: {
        heart_rate: { average_bpm: 120, max_bpm: 150, missing_seconds: 5 },
        heart_rate_curve: [90, null, 120, 150],
        calories_kcal: 280,
        before: { body_battery: 64, stress: 31, resting_hr: null },
        after: { body_battery: 48, stress: null, resting_hr: null },
        differences: { body_battery: -16, stress: null, resting_hr: null },
      },
    });
    // The planned rest is the plan position's, else the watch's 120 s.
    expect(shown.watch!.rest.planned_s).toBeGreaterThan(0);
    // A chat workout carries no watch block.
    expect(
      history.workouts
        .filter((w) => w.workout_id !== workout_id)
        .every((w) => w.watch === null && !w.from_watch),
    ).toBe(true);
    // Bob's ChatGPT does not see it, nor its health data.
    const bobs = ArnoldWorkoutHistoryViewSchema.parse(
      (await call(bob, "get_arnold_workouts", {})).structuredContent,
    );
    expect(JSON.stringify(bobs)).not.toContain(workout_id);
    expect(bobs.workouts.every((w) => w.watch === null)).toBe(true);
  });

  it("refuses training writes without the write scope", async () => {
    await setup(alice);
    await expect(
      call(
        alice,
        "start_workout",
        {
          request_id: randomUUID(),
          workout_date_local: "2026-10-29",
          timezone: "Europe/Berlin",
          session_name: "Ohne Recht",
        },
        "arnold.read",
      ),
    ).rejects.toThrow(/Insufficient scope/);
    const plan = (await call(alice, "get_training_plan", {}))
      .structuredContent as { plan: { status: string } };
    expect(plan.plan.status).toBe("active");
  });

  it("shows what is stored and deletes the account only with the card's token", async () => {
    await setup(alice);
    await setup(bob);
    const stored = StoredDataSchema.parse(
      (await call(alice, "get_arnold_stored_data", {})).structuredContent,
    );
    expect(stored.items.map((item) => item.key)).toContain("training_data");

    const first = await call(alice, "delete_arnold_account", {});
    expect(JSON.stringify(first.structuredContent)).not.toContain(
      "confirmation_token",
    );
    const confirm = DeleteAccountConfirmSchema.parse(
      (first._meta as { arnold: { delete_account: unknown } }).arnold
        .delete_account,
    );
    // The settings card reads the same confirmation with its own model.
    expect(
      deleteConfirmation(
        (first._meta as { arnold: Record<string, unknown> }).arnold,
      ),
    ).toEqual(confirm);
    // A guessed token deletes nothing.
    const guessed = await call(alice, "delete_arnold_account", {
      confirmation_token: "x".repeat(32),
    });
    expect(guessed.isError).toBe(true);
    // Bob cannot use Alice's token.
    const stolen = await call(bob, "delete_arnold_account", {
      confirmation_token: confirm.confirmation_token,
    });
    expect(stolen.isError).toBe(true);

    const deleted = await call(alice, "delete_arnold_account", {
      confirmation_token: confirm.confirmation_token,
    });
    expect(deleted.isError, JSON.stringify(deleted.content)).toBeFalsy();
    // The same login starts over with an empty account.
    const fresh = OnboardingViewSchema.parse(
      (await call(alice, "show_arnold_onboarding", {})).structuredContent,
    );
    expect(fresh.state.session.status).not.toBe("COMPLETED");
    // Bob is untouched.
    const bobsPlan = await call(bob, "get_training_plan", {});
    expect(bobsPlan.isError).toBeFalsy();
  });
});

/* ------------------------------------------------ setup after interruptions */

const response = async (
  subject: string,
  name: string,
  args: Record<string, unknown>,
) =>
  OnboardingResponseSchema.parse(
    (await call(subject, name, args)).structuredContent,
  );

async function profileReady(subject: string) {
  const opened = OnboardingViewSchema.parse(
    (await call(subject, "show_arnold_onboarding", {})).structuredContent,
  );
  const claim = {};
  const saved = await response(subject, "update_onboarding_profile", {
    ...claim,
    request_id: randomUUID(),
    expected_revision: opened.state.session.revision,
    profile: {
      path: "arnold_plan",
      training: {
        primary_goal: "strength",
        experience: "intermediate",
        days_per_week: 3,
        session_minutes: 60,
        environment: "gym",
      },
    },
  });
  expect(saved.ok, saved.error?.message).toBe(true);
  return { claim, state: saved.state! };
}

const proposalInput = (claim: Record<string, unknown>, revision: number) => ({
  ...claim,
  request_id: randomUUID(),
  expected_revision: revision,
  name: "Mein Trainingsplan",
  origin: "manual",
  sessions: ["bench-press", "lat-pulldown", "squat"].map((exercise_id, i) => ({
    session_name: `Einheit ${i + 1}`,
    exercises: [{ exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 }],
  })),
});

async function proposed(subject: string) {
  const ready = await profileReady(subject);
  const submitted = await response(
    subject,
    "submit_onboarding_plan_proposal",
    proposalInput(ready.claim, ready.state.session.revision),
  );
  expect(submitted.ok, submitted.error?.message).toBe(true);
  return { claim: ready.claim, state: submitted.state! };
}

/**
 * Fails the next setup write that would store `status`, as if the server had
 * stopped right before it. Everything before that write stays stored.
 */
function interruptBefore(status: string) {
  const original = PostgresOnboardingRepository.prototype.updateSession;
  let fired = false;
  return vi
    .spyOn(PostgresOnboardingRepository.prototype, "updateSession")
    .mockImplementation(async function (
      this: PostgresOnboardingRepository,
      record: OnboardingRecord,
      ...rest: [number, unknown?]
    ) {
      if (!fired && record.session.status === status) {
        fired = true;
        throw new Error("synthetic interruption");
      }
      return original.call(this, record, ...(rest as [number]));
    });
}

describe("setup after interruptions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the first card working when the setup is opened again", async () => {
    const first = OnboardingViewSchema.parse(
      (await call(alice, "show_arnold_onboarding", {})).structuredContent,
    );
    const second = OnboardingViewSchema.parse(
      (await call(alice, "show_arnold_onboarding", {})).structuredContent,
    );
    // The same setup, found by the account alone.
    expect(second.resumed).toBe(true);
    expect(second.state.session.revision).toBe(first.state.session.revision);

    // Both cards read and write the same setup, with the revision check.
    expect((await call(alice, "get_onboarding_state", {})).isError).toBeFalsy();
    const saved = await response(alice, "update_onboarding_profile", {
      request_id: randomUUID(),
      expected_revision: first.state.session.revision,
      profile: { training: { days_per_week: 4 } },
    });
    expect(saved.ok, saved.error?.message).toBe(true);
    const stale = await response(alice, "update_onboarding_profile", {
      request_id: randomUUID(),
      expected_revision: first.state.session.revision,
      profile: { training: { days_per_week: 2 } },
    });
    expect(stale.error?.code).toBe("REVISION_CONFLICT");
    expect(stale.state?.session.profile.training.days_per_week).toBe(4);

    // Another account never reaches it, whatever it sends.
    const foreign = await call(bob, "get_onboarding_state", {
      onboarding_session_id: "onb-guess",
      session_token: "x".repeat(43),
    });
    if (!foreign.isError) {
      const state = foreign.structuredContent as {
        session: { profile: { training: { days_per_week: number | null } } };
      };
      expect(state.session.profile.training.days_per_week).not.toBe(4);
    }
  });

  it("replays a lost request-plan answer with its original revision", async () => {
    const { claim, state } = await profileReady(alice);
    const input = {
      ...claim,
      request_id: randomUUID(),
      expected_revision: state.session.revision,
    };
    expect((await response(alice, "request_onboarding_plan", input)).ok).toBe(
      true,
    );
    const retry = await response(alice, "request_onboarding_plan", input);
    expect(retry.ok, retry.error?.message).toBe(true);
    expect(retry.replayed).toBe(true);
  });

  it("replays a lost confirmation answer with its original revision", async () => {
    const { claim, state } = await proposed(alice);
    const input = {
      ...claim,
      request_id: randomUUID(),
      expected_revision: state.session.revision,
      confirmation: {
        plan_version_id: state.plan!.plan_version_id,
        row_revision: state.plan!.row_revision,
        confirmed: true,
      },
    };
    const first = await response(alice, "confirm_onboarding_plan", input);
    expect(first.state?.session.status).toBe("COMPLETED");
    const retry = await response(alice, "confirm_onboarding_plan", input);
    expect(retry.ok, retry.error?.message).toBe(true);
    expect(retry.replayed).toBe(true);
    expect(retry.state?.session.status).toBe("COMPLETED");
  });

  it("finishes a confirmation that stopped between its two steps", async () => {
    const { claim, state } = await proposed(alice);
    const input = {
      ...claim,
      request_id: randomUUID(),
      expected_revision: state.session.revision,
      confirmation: {
        plan_version_id: state.plan!.plan_version_id,
        row_revision: state.plan!.row_revision,
        confirmed: true,
      },
    };
    interruptBefore("READY_TO_FINISH");
    const first = await response(alice, "confirm_onboarding_plan", input);
    expect(first.ok).toBe(false);
    expect(first.state?.session.status).toBe("PLAN_CONFIRMED");
    vi.restoreAllMocks();

    // The very same call, original revision included, finishes the setup.
    const retry = await response(alice, "confirm_onboarding_plan", input);
    expect(retry.ok, retry.error?.message).toBe(true);
    expect(retry.state?.session.status).toBe("COMPLETED");
    expect((await call(alice, "get_training_plan", {})).isError).toBeFalsy();
  });

  it("finishes a plan proposal that stopped after opening the proposal phase", async () => {
    const { claim, state } = await profileReady(alice);
    const input = proposalInput(claim, state.session.revision);
    interruptBefore("REVIEWING_PLAN");
    const first = await response(
      alice,
      "submit_onboarding_plan_proposal",
      input,
    );
    expect(first.ok).toBe(false);
    expect(first.state?.session.status).toBe("WAITING_FOR_PLAN_PROPOSAL");
    vi.restoreAllMocks();

    const retry = await response(
      alice,
      "submit_onboarding_plan_proposal",
      input,
    );
    expect(retry.ok, retry.error?.message).toBe(true);
    expect(retry.state?.session.status).toBe("REVIEWING_PLAN");
    expect(retry.state?.plan?.plan_version_id).toBeTruthy();
    // A third send is a replay of the finished request, not a second draft.
    const again = await response(
      alice,
      "submit_onboarding_plan_proposal",
      input,
    );
    expect(again.replayed).toBe(true);
    expect(again.state?.plan?.plan_version_id).toBe(
      retry.state?.plan?.plan_version_id,
    );
  });
});
