/**
 * The whole product path for signed-in users, end to end: real HTTP, real MCP,
 * real token verification and the real Postgres. Two people use Arnold at the
 * same time; neither ever sees the other.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
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
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view.js";
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
  return (await (
    await clientFor(subject, scope)
  ).callTool({ name, arguments: args })) as CallToolResult;
}

/** Runs the setup up to and including the confirmation. */
async function setup(subject: string, person: Record<string, unknown> = {}) {
  const opened = OnboardingViewSchema.parse(
    (await call(subject, "show_arnold_onboarding", {})).structuredContent,
  );
  const claim = {
    onboarding_session_id: opened.state.session.onboarding_session_id,
    session_token: opened.session_token!,
  };
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
    expect(again.session_token).toBeNull();
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

    // "Alles wie letztes Mal": no changes at all.
    const again = await write(alice, "log_workout", {
      ...session,
      workout_date_local: "2026-10-30",
    });
    expect(again.ok, again.error?.message).toBe(true);
    expect(again.result!.sets.map((s) => s.load_kg)).toEqual([60, 60, 60]);

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
