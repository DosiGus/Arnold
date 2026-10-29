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
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/server/http.js";
import { createConfiguredHttpApp } from "../src/server/bootstrap.js";
import { buildAuthSurface } from "../src/server/auth/router.js";
import { loadAuthConfig } from "../src/server/auth/config.js";
import { fetchAuthorizationServerMetadata } from "../src/server/auth/discovery.js";
import { FileIdentityRepository } from "../src/server/identity/repository.js";
import { GoogleConnectionService } from "../src/server/google/connection-service.js";
import { FileGoogleCredentialRepository } from "../src/server/google/credential-repository.js";
import {
  generateEncryptionKey,
  TokenCipher,
} from "../src/server/google/crypto.js";
import {
  ConnectedArnoldRuntime,
  type SetupClaim,
} from "../src/server/connected/runtime.js";
import { GoogleBrowserFlow } from "../src/server/connected/google-browser.js";
import {
  OnboardingResponseSchema,
  OnboardingStateSchema,
} from "../src/shared/onboarding-contract.js";
import {
  WriteResponseSchema,
  WorkoutContextSchema,
} from "../src/shared/workout-contract.js";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view.js";
import { TOOL_ACCESS } from "../src/server/auth/tool-access.js";
import {
  googleOAuthConfig,
  googleIdTokenKeys,
} from "./fixtures/arnold-google.js";
import {
  jwksDocument,
  makeRsaKey,
  signJwt,
  validClaims,
} from "./fixtures/arnold-auth.js";
import { ConnectedGoogle } from "./fixtures/connected-google.js";

const key = makeRsaKey("connected-issuer");
const cipher = new TokenCipher(generateEncryptionKey("journey-key"));
const scopes =
  "arnold.profile arnold.read arnold.write arnold.plan arnold.account";
let issuerHttp: Server, issuer: string;
let http: Server, base: string, directory: string;
let google: ConnectedGoogle;
let identities: FileIdentityRepository;
let runtime: ConnectedArnoldRuntime;
let clients = new Map<string, Client>();
const portOf = (server: Server) => (server.address() as { port: number }).port;
const listen = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections();
  });
const claimsFor = (subject: string, scope = scopes) =>
  validClaims({ iss: issuer, aud: `${base}/mcp`, sub: subject, scope });
const tokenFor = (subject: string, scope = scopes) =>
  signJwt(key, claimsFor(subject, scope));

beforeAll(async () => {
  issuerHttp = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        _req.url?.includes("jwks")
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
});
afterAll(() => close(issuerHttp));
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "arnold-connected-"));
  google = new ConnectedGoogle();
  const probe = createServer().listen(0, "127.0.0.1");
  await listen(probe);
  base = `http://127.0.0.1:${portOf(probe)}`;
  await close(probe);
  await boot();
});
afterEach(async () => {
  await Promise.all([...clients.values()].map((client) => client.close()));
  clients.clear();
  await close(http);
  await rm(directory, { recursive: true, force: true });
});
async function boot() {
  identities = new FileIdentityRepository(join(directory, "identities.json"));
  const config = loadAuthConfig({
    ARNOLD_ENV: "development",
    AUTH_MODE: "oidc",
    ARNOLD_PUBLIC_BASE_URL: base,
    AUTH_ISSUER: issuer,
    AUTH_JWKS_URI: `${issuer}jwks`,
    IDENTITY_STORE: "file",
    IDENTITY_STORE_FILE: join(directory, "identities.json"),
  });
  const auth = buildAuthSurface({
    config,
    repository: identities,
    authorizationServerMetadata: await fetchAuthorizationServerMetadata({
      issuer,
    }),
  });
  const connections = new GoogleConnectionService({
    config: {
      ...googleOAuthConfig,
      redirectUri: `${base}/auth/google/callback`,
    },
    repository: new FileGoogleCredentialRepository(
      join(directory, "connections.json"),
    ),
    cipher,
    idTokenKeys: googleIdTokenKeys,
    fetchImpl: google.fetch,
  });
  runtime = new ConnectedArnoldRuntime({
    directory: join(directory, "users"),
    auth,
    connections,
    fetchImpl: google.fetch,
  });
  const browser = new GoogleBrowserFlow(
    runtime,
    connections,
    auth,
    new URL(base),
  );
  http = createHttpApp({ auth, connected: { runtime, browser } }).listen(
    Number(new URL(base).port),
    "127.0.0.1",
  );
  await listen(http);
}
async function clientFor(subject: string, scope = scopes) {
  const id = `${subject}:${scope}`;
  let client = clients.get(id);
  if (!client) {
    client = new Client({ name: "connected-journey", version: "1" });
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
async function setup(subject = "alice") {
  const started = OnboardingResponseSchema.parse(
    (
      await call(subject, "start_arnold_onboarding", {
        request_id: randomUUID(),
      })
    ).structuredContent,
  );
  expect(started.ok, started.error?.message).toBe(true);
  const claim: SetupClaim = {
    onboarding_session_id: started.state!.session.onboarding_session_id,
    session_token: started.session_token!,
  };
  const profile = OnboardingResponseSchema.parse(
    (
      await call(subject, "update_onboarding_profile", {
        ...claim,
        request_id: randomUUID(),
        profile: {
          primary_goal: "strength",
          experience: "intermediate",
          days_per_week: 3,
          session_minutes: 60,
          environment: "gym",
          starting_point: "new_plan",
        },
      })
    ).structuredContent,
  );
  expect(profile.ok, profile.error?.message).toBe(true);
  await call(subject, "request_onboarding_plan", {
    ...claim,
    request_id: randomUUID(),
  });
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
  expect(confirmed.state?.session.status).toBe("AWAITING_GOOGLE_CONNECTION");
  return { claim, plan };
}
async function launch(subject: string, claim: SetupClaim) {
  const started = await call(subject, "connect_google_account", claim);
  expect(started.isError, JSON.stringify(started.content)).toBeFalsy();
  const response = await fetch(
    (started.structuredContent as { authorization_url: string })
      .authorization_url,
    { redirect: "manual" },
  );
  expect(response.status).toBe(303);
  return {
    authorization: response.headers.get("location")!,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
  };
}
async function consent(
  subject: string,
  claim: SetupClaim,
  googleSubject = subject,
) {
  const flow = await launch(subject, claim);
  const code = google.authorize(flow.authorization, googleSubject);
  const state = new URL(flow.authorization).searchParams.get("state")!;
  const callback = `${base}/auth/google/callback?${new URLSearchParams({ code, state })}`;
  return {
    response: await fetch(callback, { headers: { cookie: flow.cookie } }),
    callback,
    cookie: flow.cookie,
  };
}
async function connected(subject = "alice") {
  const result = await setup(subject);
  const { response } = await consent(subject, result.claim);
  expect(response.status, await response.text()).toBe(200);
  return result;
}
async function startWorkout(subject = "alice") {
  const response = WriteResponseSchema.parse(
    (
      await call(subject, "start_workout", {
        request_id: "first-workout",
        workout_date_local: "2026-10-29",
        timezone: "Europe/Berlin",
        session_name: "Einheit 1",
      })
    ).structuredContent,
  );
  expect(response.ok, response.error?.message).toBe(true);
  return response.result!.workout!;
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

describe("connected end-to-end journey (Google simulated, real HTTP and MCP)", () => {
  it("refuses Google setup after the confirmed onboarding session expires", async () => {
    const { claim } = await setup();
    const [userDirectory] = await readdir(join(directory, "users"));
    const path = join(directory, "users", userDirectory, "onboarding.json");
    const records = JSON.parse(await readFile(path, "utf8"));
    records[0].session.expires_at_utc = new Date(
      Date.now() - 1000,
    ).toISOString();
    await writeFile(path, JSON.stringify(records));
    expect((await call("alice", "connect_google_account", claim)).isError).toBe(
      true,
    );
    expect(google.creates).toBe(0);
  });
  it("registers classified Google tools and does not expose secrets", async () => {
    const tools = (await (await clientFor("alice")).listTools()).tools;
    expect(tools.map((tool) => tool.name)).toContain("connect_google_account");
    for (const tool of tools)
      expect(TOOL_ACCESS[tool.name], tool.name).toBeDefined();
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({
      auth: "oidc",
      source: "arnold_connected",
      synthetic: false,
    });
    expect(JSON.stringify(health)).not.toContain("secret");
  });
  it("refuses an unauthenticated endpoint and writes before provisioning", async () => {
    expect((await fetch(`${base}/mcp`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${base}/auth/google/status`)).status).toBe(401);
    const response = WriteResponseSchema.parse(
      (
        await call("alice", "start_workout", {
          request_id: "early",
          workout_date_local: "2026-10-29",
          timezone: "Europe/Berlin",
          session_name: "Too early",
        })
      ).structuredContent,
    );
    expect(response.ok).toBe(false);
    expect(google.creates).toBe(0);
  });
  it("creates exactly one personal tracker, completes onboarding, and keeps the confirmed plan", async () => {
    const { claim, plan } = await connected();
    const state = OnboardingStateSchema.parse(
      (await call("alice", "get_onboarding_state", claim)).structuredContent,
    );
    expect(state.session.status).toBe("COMPLETED");
    expect(state.handoff).toMatchObject({
      status: "completed",
      google_connection_pending: false,
    });
    expect(state.plan?.plan_version_id).toBe(plan.plan_version_id);
    expect(state.plan?.status).toBe("active");
    await call("alice", "finish_arnold_setup", claim);
    expect(google.creates).toBe(1);
    const stored = await readFile(join(directory, "connections.json"), "utf8");
    expect(stored).not.toContain("refresh_alice");
    expect(stored).not.toContain("access_alice");
  });
  it("stores one real-path set, suppresses retries, and updates analytics after completion", async () => {
    await connected();
    const workout = await startWorkout();
    const input = {
      request_id: "first-set",
      workout_id: workout.workout_id,
      sets: [setInput],
    };
    const first = WriteResponseSchema.parse(
      (await call("alice", "log_workout_sets", input)).structuredContent,
    );
    expect(first.ok, first.error?.message).toBe(true);
    expect(
      WriteResponseSchema.parse(
        (await call("alice", "log_workout_sets", input)).structuredContent,
      ).replayed,
    ).toBe(true);
    expect(
      WriteResponseSchema.parse(
        (
          await call("alice", "complete_workout", {
            request_id: "complete",
            workout_id: workout.workout_id,
            expected_row_revision: 1,
          })
        ).structuredContent,
      ).ok,
    ).toBe(true);
    const dashboard = ArnoldDashboardViewSchema.parse(
      (
        await call("alice", "get_arnold_dashboard_v2", {
          from: "2026-10-29",
          to: "2026-10-29",
        })
      ).structuredContent,
    );
    expect(dashboard.totals.workouts_in_period).toBe(1);
    expect(
      dashboard.kpis.find((kpi) => kpi.key === "nominal_volume")?.value,
    ).toBe(600);
  });
  it("survives a full runtime restart, refreshes Google, and replays the saved set without a duplicate", async () => {
    const { claim } = await connected();
    const workout = await startWorkout();
    const input = {
      request_id: "persisted-set",
      workout_id: workout.workout_id,
      sets: [setInput],
    };
    expect(
      WriteResponseSchema.parse(
        (await call("alice", "log_workout_sets", input)).structuredContent,
      ).ok,
    ).toBe(true);
    await Promise.all([...clients.values()].map((client) => client.close()));
    clients.clear();
    await close(http);
    await boot();
    const state = OnboardingStateSchema.parse(
      (await call("alice", "get_onboarding_state", claim)).structuredContent,
    );
    expect(state.session.status).toBe("COMPLETED");
    const context = WorkoutContextSchema.parse(
      (await call("alice", "get_workout", { workout_id: workout.workout_id }))
        .structuredContent,
    );
    expect(context.sets).toHaveLength(1);
    expect(
      WriteResponseSchema.parse(
        (await call("alice", "log_workout_sets", input)).structuredContent,
      ).replayed,
    ).toBe(true);
    expect(google.creates).toBe(1);
    expect(google.refreshes).toBe(1);
  });
  it("isolates two users and rejects a foreign session even with its secret", async () => {
    const alice = await connected("alice");
    await startWorkout("alice");
    await connected("bob");
    const foreign = await call("bob", "get_onboarding_state", alice.claim);
    expect(foreign.isError).toBe(true);
    const own = WorkoutContextSchema.parse(
      (await call("bob", "get_workout")).structuredContent,
    );
    expect(own.workouts).toHaveLength(0);
    expect(google.creates).toBe(2);
  });
  it("refuses callback replay and a callback without its browser cookie", async () => {
    const { claim } = await setup();
    const flow = await launch("alice", claim);
    const code = google.authorize(flow.authorization, "alice");
    const callback = `${base}/auth/google/callback?${new URLSearchParams({ code, state: new URL(flow.authorization).searchParams.get("state")! })}`;
    expect((await fetch(callback)).status).toBe(400);
    expect(google.creates).toBe(0);
    expect(
      (await fetch(callback, { headers: { cookie: flow.cookie } })).status,
    ).toBe(200);
    expect(
      (await fetch(callback, { headers: { cookie: flow.cookie } })).status,
    ).toBe(400);
    expect(google.creates).toBe(1);
  });
  it("does not provision when the confirmed profile changes during Google consent", async () => {
    const { claim } = await setup();
    const flow = await launch("alice", claim);
    await call("alice", "update_onboarding_profile", {
      ...claim,
      request_id: "change",
      profile: { days_per_week: 2 },
    });
    const callback = `${base}/auth/google/callback?${new URLSearchParams({ code: google.authorize(flow.authorization, "alice"), state: new URL(flow.authorization).searchParams.get("state")! })}`;
    expect(
      (await fetch(callback, { headers: { cookie: flow.cookie } })).status,
    ).toBe(400);
    expect(google.creates).toBe(0);
  });
  it("reconciles a lost create response without making a second file", async () => {
    const { claim } = await setup();
    google.loseCreateResponse = true;
    const { response } = await consent("alice", claim);
    expect(response.status).toBe(400);
    expect(google.creates).toBe(1);
    const finished = await call("alice", "finish_arnold_setup", claim);
    expect(finished.isError, JSON.stringify(finished.content)).toBeFalsy();
    expect(google.creates).toBe(1);
  });
  it("accepts a lost initialization response only after matching the full readback", async () => {
    google.loseInitializeResponse = true;
    await connected();
    expect(google.creates).toBe(1);
    expect(google.writes).toBe(1);
  });
  it("keeps an uncertain initialization blocked across retries instead of overwriting a file", async () => {
    const { claim } = await setup();
    google.rejectInitialize = true;
    expect((await consent("alice", claim)).response.status).toBe(400);
    google.rejectInitialize = false;
    expect((await call("alice", "finish_arnold_setup", claim)).isError).toBe(
      true,
    );
    expect(google.creates).toBe(1);
    expect(google.writes).toBe(0);
  });
  it("revokes Google and preserves the training file while denying further reads", async () => {
    await connected();
    await call("alice", "disconnect_google_account", { confirm: true });
    expect(google.files.size).toBe(1);
    expect((await call("alice", "get_workout")).isError).toBe(true);
    expect(
      await readFile(join(directory, "connections.json"), "utf8"),
    ).not.toContain("refresh_token");
  });
  it("re-checks disabled users at the browser callback", async () => {
    const { claim } = await setup();
    const flow = await launch("alice", claim);
    const user = await identities.find(issuer, "alice");
    await identities.setStatus(user!.user.user_id, "DISABLED");
    const callback = `${base}/auth/google/callback?${new URLSearchParams({ code: google.authorize(flow.authorization, "alice"), state: new URL(flow.authorization).searchParams.get("state")! })}`;
    expect(
      (await fetch(callback, { headers: { cookie: flow.cookie } })).status,
    ).toBe(400);
    expect(google.creates).toBe(0);
  });
  it("boots OIDC through the environment-driven entrypoint instead of requiring an injected auth surface", async () => {
    const app = await createConfiguredHttpApp(
      {},
      {
        ARNOLD_ENV: "development",
        AUTH_MODE: "oidc",
        ARNOLD_PUBLIC_BASE_URL: base,
        AUTH_ISSUER: issuer,
        AUTH_JWKS_URI: `${issuer}jwks`,
        IDENTITY_STORE: "file",
        IDENTITY_STORE_FILE: join(directory, "startup-identities.json"),
      },
    );
    expect(app).toBeTypeOf("function");
  });

  it("isolates simultaneous Google provisioning and set writes for two users", async () => {
    await Promise.all([connected("alice"), connected("bob")]);
    const [alice, bob] = await Promise.all([
      startWorkout("alice"),
      startWorkout("bob"),
    ]);
    const writes = await Promise.all([
      call("alice", "log_workout_sets", {
        request_id: "same-operation",
        workout_id: alice.workout_id,
        sets: [setInput],
      }),
      call("bob", "log_workout_sets", {
        request_id: "same-operation",
        workout_id: bob.workout_id,
        sets: [{ ...setInput, load_kg: 80 }],
      }),
    ]);
    for (const write of writes)
      expect(WriteResponseSchema.parse(write.structuredContent).ok).toBe(true);
    const a = WorkoutContextSchema.parse(
      (await call("alice", "get_workout", { workout_id: alice.workout_id }))
        .structuredContent,
    );
    const b = WorkoutContextSchema.parse(
      (await call("bob", "get_workout", { workout_id: bob.workout_id }))
        .structuredContent,
    );
    expect(a.sets[0].load_kg).toBe(60);
    expect(b.sets[0].load_kg).toBe(80);
    expect(a.tracker_id).not.toBe(b.tracker_id);
    expect(
      (await call("bob", "get_workout", { workout_id: alice.workout_id }))
        .isError,
    ).toBe(true);
  });
  it("reconnects the original Google account without creating another file", async () => {
    const { claim } = await connected();
    await call("alice", "disconnect_google_account", { confirm: true });
    expect((await consent("alice", claim)).response.status).toBe(200);
    expect((await call("alice", "get_workout")).isError).toBeFalsy();
    expect(google.creates).toBe(1);
  });
  it("refuses a different Google account for a provisioned tracker before storing its tokens", async () => {
    const { claim } = await connected();
    await call("alice", "disconnect_google_account", { confirm: true });
    expect(
      (await consent("alice", claim, "different-google-user")).response.status,
    ).toBe(400);
    const status = (await call("alice", "get_google_connection"))
      .structuredContent;
    expect(status).toEqual({ connection: null });
    expect(google.creates).toBe(1);
  });
  it("marks revoked Google credentials as needing reauthorization even while an access token is cached", async () => {
    await connected();
    google.revoked.add("alice");
    expect((await call("alice", "get_workout")).isError).toBe(true);
    expect(
      (await call("alice", "get_google_connection")).structuredContent,
    ).toMatchObject({
      connection: { status: "REAUTH_REQUIRED", has_refresh_token: false },
    });
  });
  it("reconciles a lost set-write response across a full runtime restart", async () => {
    await connected();
    const workout = await startWorkout();
    const input = {
      request_id: "uncertain-set",
      workout_id: workout.workout_id,
      sets: [setInput],
    };
    google.loseWriteResponse = true;
    const first = WriteResponseSchema.parse(
      (await call("alice", "log_workout_sets", input)).structuredContent,
    );
    // The domain may reconcile immediately; either way, a retry after restart
    // must prove the committed row rather than append it again.
    expect(first.ok || first.error?.code === "COMMIT_STATUS_UNKNOWN").toBe(
      true,
    );
    await Promise.all([...clients.values()].map((client) => client.close()));
    clients.clear();
    await close(http);
    await boot();
    const retry = WriteResponseSchema.parse(
      (await call("alice", "log_workout_sets", input)).structuredContent,
    );
    expect(retry.ok).toBe(true);
    expect(
      WorkoutContextSchema.parse(
        (await call("alice", "get_workout", { workout_id: workout.workout_id }))
          .structuredContent,
      ).sets,
    ).toHaveLength(1);
  });
  it("allows a retry after a definite file-creation rejection", async () => {
    const { claim } = await setup();
    google.rejectCreate = 429;
    expect((await consent("alice", claim)).response.status).toBe(400);
    expect(
      (await call("alice", "finish_arnold_setup", claim)).isError,
    ).toBeFalsy();
    expect(google.creates).toBe(1);
  });
  it("refuses under-scoped onboarding and Google mutations", async () => {
    const caller = await clientFor("limited", "arnold.read");
    const result = await caller
      .callTool({
        name: "start_arnold_onboarding",
        arguments: { request_id: "no-plan-scope" },
      })
      .catch(() => ({ isError: true }));
    expect(result.isError).toBe(true);
    const { claim } = await setup("limited");
    const connect = await call(
      "limited",
      "connect_google_account",
      claim,
      "arnold.read arnold.plan",
    ).catch(() => ({ isError: true }));
    expect(connect.isError).toBe(true);
    expect(google.creates).toBe(0);
  });
});
