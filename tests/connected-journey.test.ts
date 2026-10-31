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
  OnboardingViewSchema,
} from "../src/shared/onboarding-contract.js";
import {
  WriteResponseSchema,
  WorkoutContextSchema,
} from "../src/shared/workout-contract.js";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view.js";
import { PlanWriteResponseSchema } from "../src/shared/plan-contract.js";
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
import { missingHints } from "./fixtures/tool-hints.js";

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
          path: "arnold_plan",
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
    // B10: all three safety hints on every tool of the connected profile.
    expect(missingHints(tools)).toEqual([]);
    for (const name of Object.keys(TOOL_ACCESS).filter(
      (tool) => TOOL_ACCESS[tool] === "ACCOUNT_MANAGEMENT",
    ))
      expect(
        tools.map((tool) => tool.name),
        name,
      ).toContain(name);
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
    const response = await call("alice", "start_workout", {
      request_id: "early",
      workout_date_local: "2026-10-29",
      timezone: "Europe/Berlin",
      session_name: "Too early",
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response.content)).toContain("SETUP_REQUIRED");
    expect(google.creates).toBe(0);
  });
  it("sends a new user to the onboarding first, from any tracker tool", async () => {
    for (const name of ["show_arnold_dashboard", "get_arnold_dashboard"]) {
      const result = await call("alice", name, {});
      expect(result.isError, name).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        "show_arnold_onboarding",
      );
    }
    const opened = OnboardingViewSchema.parse(
      (await call("alice", "show_arnold_onboarding", {})).structuredContent,
    );
    expect(opened.state.session.current_step).toBe("welcome");
    expect(opened.state.resume.cross_device).toBe(true);
    expect(opened.session_token).toBeTruthy();
  });
  it("resumes the same setup in a new chat and never runs it twice", async () => {
    const first = OnboardingViewSchema.parse(
      (await call("alice", "show_arnold_onboarding", {})).structuredContent,
    );
    // A later chat: no session id, no secret — still the same setup.
    const again = OnboardingViewSchema.parse(
      (await call("alice", "show_arnold_onboarding", {})).structuredContent,
    );
    expect(again.resumed).toBe(true);
    expect(again.state.session.onboarding_session_id).toBe(
      first.state.session.onboarding_session_id,
    );
    // Bob does not get Alice's setup.
    const bob = OnboardingViewSchema.parse(
      (await call("bob", "show_arnold_onboarding", {})).structuredContent,
    );
    expect(bob.state.session.onboarding_session_id).not.toBe(
      first.state.session.onboarding_session_id,
    );
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
    // Set up for good: the onboarding does not start again, and the tracker
    // tools are open.
    const restart = OnboardingResponseSchema.parse(
      (
        await call("alice", "start_arnold_onboarding", {
          request_id: randomUUID(),
        })
      ).structuredContent,
    );
    expect(restart.ok).toBe(false);
    expect(restart.error?.code).toBe("ONBOARDING_ALREADY_COMPLETED");
    const shown = OnboardingViewSchema.parse(
      (await call("alice", "show_arnold_onboarding", {})).structuredContent,
    );
    expect(shown.state.session.status).toBe("COMPLETED");
    expect(shown.session_token ?? null).toBeNull();
    expect(
      (await call("alice", "show_arnold_dashboard", {})).isError ?? false,
    ).toBe(false);
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
        await call("alice", "get_arnold_dashboard", {
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
      profile: { training: { days_per_week: 2 } },
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

describe("B4: an expired Google grant leads to reconnecting, without data loss", () => {
  const meta = (result: CallToolResult) =>
    (result._meta as { arnold?: { code?: string; recovery?: string } })?.arnold;
  const text = (result: CallToolResult) =>
    result.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");

  it("answers every Google-dependent tool with GOOGLE_REAUTH_REQUIRED", async () => {
    const { claim, plan } = await connected();
    const workout = await startWorkout();
    google.revoked.add("alice");

    for (const name of [
      "get_arnold_dashboard",
      "show_arnold_dashboard",
      "get_arnold_workouts",
      "get_workout",
      "get_training_plan",
      "list_training_plans",
    ]) {
      const result = await call("alice", name);
      expect(result.isError, name).toBe(true);
      expect(meta(result), name).toMatchObject({
        code: "GOOGLE_REAUTH_REQUIRED",
        recovery: "reconnect_google",
      });
      expect(text(result), name).toContain(
        "Die Google-Freigabe ist abgelaufen. Bitte über die Karte neu verbinden.",
      );
    }

    const write = WriteResponseSchema.parse(
      (
        await call("alice", "log_workout_sets", {
          request_id: "set-while-expired",
          workout_id: workout.workout_id,
          sets: [setInput],
        })
      ).structuredContent,
    );
    expect(write.ok).toBe(false);
    expect(write.error).toMatchObject({
      code: "GOOGLE_REAUTH_REQUIRED",
      recovery: "reconnect_google",
      retryable: false,
    });

    const planWrite = PlanWriteResponseSchema.parse(
      (
        await call("alice", "create_plan_version", {
          request_id: "plan-while-expired",
          source_plan_version_id: plan.plan_version_id,
        })
      ).structuredContent,
    );
    expect(planWrite.ok).toBe(false);
    expect(planWrite.error).toMatchObject({
      code: "GOOGLE_REAUTH_REQUIRED",
      recovery: "reconnect_google",
    });

    const finish = await call("alice", "finish_arnold_setup", claim);
    expect(finish.isError).toBe(true);
    expect(meta(finish)).toMatchObject({
      code: "GOOGLE_REAUTH_REQUIRED",
      recovery: "reconnect_google",
    });

    expect(
      (await call("alice", "get_google_connection")).structuredContent,
    ).toMatchObject({ connection: { status: "REAUTH_REQUIRED" } });
  });

  it("expires mid-write, then the same request succeeds once after reconnecting", async () => {
    const { claim } = await connected();
    const workout = await startWorkout();
    const first = WriteResponseSchema.parse(
      (
        await call("alice", "log_workout_sets", {
          request_id: "set-before-expiry",
          workout_id: workout.workout_id,
          sets: [setInput],
        })
      ).structuredContent,
    );
    expect(first.ok, first.error?.message).toBe(true);

    const input = {
      request_id: "set-during-expiry",
      workout_id: workout.workout_id,
      sets: [{ ...setInput, reps: 8 }],
    };
    google.expireGrantBeforeNextWrite = true;
    const refused = WriteResponseSchema.parse(
      (await call("alice", "log_workout_sets", input)).structuredContent,
    );
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatchObject({
      code: "GOOGLE_REAUTH_REQUIRED",
      recovery: "reconnect_google",
    });

    // Reconnect through the normal card flow.
    expect((await consent("alice", claim)).response.status).toBe(200);
    expect(google.creates).toBe(1);

    const retried = WriteResponseSchema.parse(
      (await call("alice", "log_workout_sets", input)).structuredContent,
    );
    expect(retried.ok, retried.error?.message).toBe(true);
    const replay = WriteResponseSchema.parse(
      (await call("alice", "log_workout_sets", input)).structuredContent,
    );
    expect(replay.ok).toBe(true);
    expect(replay.replayed).toBe(true);

    const sets = WorkoutContextSchema.parse(
      (await call("alice", "get_workout", { workout_id: workout.workout_id }))
        .structuredContent,
    ).sets;
    expect(sets.map((set) => set.reps).sort()).toEqual([10, 8].sort());
    expect((await call("alice", "get_arnold_dashboard")).isError).toBeFalsy();
  });
});

describe("B6: delete_arnold_account", () => {
  type Confirm = {
    stage: string;
    summary: { stored_items: string[]; keeps: string[] };
    expires_at: string;
    confirmation_token?: string;
  };
  const tokenOf = (result: CallToolResult) =>
    (
      result._meta as {
        arnold?: { delete_account?: { confirmation_token?: string } };
      }
    )?.arnold?.delete_account?.confirmation_token;
  const meta = (result: CallToolResult) =>
    (result._meta as { arnold?: { code?: string; recovery?: string } })?.arnold;
  const identityFile = () =>
    readFile(join(directory, "identities.json"), "utf8");
  const userDirs = () => readdir(join(directory, "users")).catch(() => []);

  it("does nothing without a token and keeps the token away from the model", async () => {
    await connected();
    await startWorkout();
    const dirsBefore = await userDirs();
    const first = await call("alice", "delete_arnold_account");
    expect(first.isError).toBeFalsy();
    const visible = first.structuredContent as Confirm;
    expect(visible.stage).toBe("confirm");
    expect(visible.confirmation_token).toBeUndefined();
    expect(JSON.stringify(first.content)).not.toContain(tokenOf(first)!);
    expect(tokenOf(first)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(visible.summary.keeps.join(" ")).toContain("Google-Tabelle");
    expect(Date.parse(visible.expires_at)).toBeGreaterThan(Date.now());

    expect(await userDirs()).toEqual(dirsBefore);
    expect((await call("alice", "get_workout")).isError).toBeFalsy();
    expect(
      (await call("alice", "get_google_connection")).structuredContent,
    ).toMatchObject({ connection: { status: "CONNECTED" } });
    expect(google.revoked.has("alice")).toBe(false);
  });

  it("refuses a wrong, a foreign and a reused token without deleting anything", async () => {
    await connected("alice");
    await connected("bob");
    const aliceToken = tokenOf(await call("alice", "delete_arnold_account"))!;
    const bobToken = tokenOf(await call("bob", "delete_arnold_account"))!;
    // last_seen_at changes on every call; the rows themselves must stay.
    const rows = async () => {
      const state = JSON.parse(await identityFile());
      return [
        ...state.users.map((u: { user_id: string }) => u.user_id),
        ...state.identity_connections.map(
          (c: { connection_id: string }) => c.connection_id,
        ),
      ].sort();
    };
    const identities = await rows();

    for (const token of ["x".repeat(43), bobToken]) {
      const refused = await call("alice", "delete_arnold_account", {
        confirmation_token: token,
      });
      expect(refused.isError).toBe(true);
      expect(meta(refused)).toMatchObject({
        code: "CONFIRMATION_INVALID",
        recovery: "start_over",
      });
    }
    expect(await rows()).toEqual(identities);
    expect((await userDirs()).length).toBe(2);
    expect((await call("alice", "get_workout")).isError).toBeFalsy();

    // A wrong attempt does not burn the user's own live token.
    const deleted = await call("alice", "delete_arnold_account", {
      confirmation_token: aliceToken,
    });
    expect(deleted.isError, JSON.stringify(deleted.content)).toBeFalsy();
    const reused = await call("alice", "delete_arnold_account", {
      confirmation_token: aliceToken,
    });
    expect(meta(reused)).toMatchObject({ code: "CONFIRMATION_INVALID" });
  });

  it("deletes everything Arnold stores for one user and leaves the other untouched", async () => {
    await connected("alice");
    await connected("bob");
    await startWorkout("alice");
    const bobWorkout = await startWorkout("bob");
    const aliceDir = runtime.userDirectory(
      JSON.parse(await identityFile()).users[0].user_id,
    );
    const token = tokenOf(await call("alice", "delete_arnold_account"))!;
    const result = await call("alice", "delete_arnold_account", {
      confirmation_token: token,
    });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      stage: "deleted",
      google_sheet_kept: true,
      sheet_url: expect.stringMatching(
        /^https:\/\/docs\.google\.com\/spreadsheets\/d\/spreadsheet_\d+_alice\/edit$/,
      ),
    });

    // Google: grant revoked, the sheet stays.
    expect(google.revoked.has("alice")).toBe(true);
    expect([...google.files.values()].some((f) => f.owner === "alice")).toBe(
      true,
    );
    // Local: identity, credentials, setup, journal, audit and mapping gone.
    const identities = JSON.parse(await identityFile());
    expect(identities.users).toHaveLength(1);
    expect(identities.identity_connections).toHaveLength(1);
    expect(identities.identity_connections[0].subject).toBe("bob");
    const connections = await readFile(
      join(directory, "connections.json"),
      "utf8",
    );
    expect(connections).not.toContain("alice");
    await expect(readdir(aliceDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await userDirs()).toHaveLength(1);

    // Bob is untouched.
    expect(google.revoked.has("bob")).toBe(false);
    const bob = WorkoutContextSchema.parse(
      (
        await call("bob", "get_workout", {
          workout_id: bobWorkout.workout_id,
        })
      ).structuredContent,
    );
    expect(bob.workout?.workout_id).toBe(bobWorkout.workout_id);
    expect(
      (await call("bob", "get_google_connection")).structuredContent,
    ).toMatchObject({ connection: { status: "CONNECTED" } });

    // The same login later starts as a new, empty account.
    const fresh = await call("alice", "get_arnold_dashboard");
    expect(fresh.isError).toBe(true);
    expect(JSON.stringify(fresh.content)).toContain("SETUP_REQUIRED");
  });
});

describe("B8: retention in the connected runtime", () => {
  it("prunes old journal entries per user and keeps the account working", async () => {
    await connected("alice");
    await startWorkout("alice");
    const journal = async () =>
      JSON.parse(
        await readFile(
          join(
            runtime.userDirectory(
              JSON.parse(
                await readFile(join(directory, "identities.json"), "utf8"),
              ).users[0].user_id,
            ),
            "operations.json",
          ),
          "utf8",
        ),
      ) as { state: string }[];
    expect((await journal()).length).toBeGreaterThan(0);
    expect(await runtime.applyRetention(30)).toMatchObject({
      users: 1,
      journal: 0,
    });
    const later = await runtime.applyRetention(
      30,
      Date.now() + 31 * 86_400_000,
    );
    expect(later.journal).toBeGreaterThan(0);
    expect(later.snapshots).toBe(2);
    expect(await journal()).toEqual([]);
    expect((await call("alice", "get_workout")).isError).toBeFalsy();
    expect((await call("alice", "get_arnold_dashboard")).isError).toBeFalsy();
  });
});

describe("B7: get_arnold_stored_data", () => {
  it("lists kinds, counts and dates of stored data, never their content", async () => {
    await connected("alice");
    await startWorkout("alice");
    const result = await call("alice", "get_arnold_stored_data");
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    const data = result.structuredContent as {
      items: { key: string; count: number | null; newest_at: string | null }[];
      google_sheet_url: string | null;
      retention_days: number;
    };
    expect(data.items.map((item) => item.key).sort()).toEqual(
      [
        "account",
        "audit_log",
        "google_connection",
        "setup",
        "setup_snapshot",
        "tracker_mapping",
        "write_journal",
      ].sort(),
    );
    expect(data.retention_days).toBe(30);
    expect(data.google_sheet_url).toMatch(
      /^https:\/\/docs\.google\.com\/spreadsheets\/d\/spreadsheet_\d+_alice\/edit$/,
    );
    const journal = data.items.find((item) => item.key === "write_journal")!;
    expect(journal.count).toBeGreaterThan(0);
    expect(Date.parse(journal.newest_at!)).toBeLessThanOrEqual(Date.now());
    const text = JSON.stringify(result);
    for (const secret of [
      "alice@example.test",
      "Mein Trainingsplan",
      "refresh_",
      "bench-press",
    ])
      expect(text).not.toContain(secret);
  });

  it("shows no Google data and no sheet for a user who never connected", async () => {
    const result = await call("newcomer", "get_arnold_stored_data");
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    const data = result.structuredContent as {
      items: { key: string }[];
      google_sheet_url: string | null;
    };
    const keys = data.items.map((item) => item.key);
    expect(keys).toContain("account");
    expect(keys).not.toContain("google_connection");
    expect(keys).not.toContain("write_journal");
    expect(data.google_sheet_url).toBeNull();
  });
});

describe("B14: reconnecting a set-up account without the setup claim", () => {
  const meta = (result: CallToolResult) =>
    (result._meta as { arnold?: { code?: string; recovery?: string } })?.arnold;
  async function reconnect(subject: string, googleSubject = subject) {
    const started = await call(subject, "connect_google_account", {});
    expect(started.isError, JSON.stringify(started.content)).toBeFalsy();
    const launched = await fetch(
      (started.structuredContent as { authorization_url: string })
        .authorization_url,
      { redirect: "manual" },
    );
    expect(launched.status).toBe(303);
    const authorization = launched.headers.get("location")!;
    const cookie = launched.headers.get("set-cookie")!.split(";")[0];
    const code = google.authorize(authorization, googleSubject);
    const state = new URL(authorization).searchParams.get("state")!;
    return fetch(
      `${base}/auth/google/callback?${new URLSearchParams({ code, state })}`,
      { headers: { cookie } },
    );
  }

  it("reconnects after an expired grant with no claim and loses no data", async () => {
    await connected("alice");
    const workout = await startWorkout("alice");
    const first = WriteResponseSchema.parse(
      (
        await call("alice", "log_workout_sets", {
          request_id: "before-expiry",
          workout_id: workout.workout_id,
          sets: [setInput],
        })
      ).structuredContent,
    );
    expect(first.ok, first.error?.message).toBe(true);

    google.revoked.add("alice");
    const pending = {
      request_id: "while-expired",
      workout_id: workout.workout_id,
      sets: [{ ...setInput, reps: 6 }],
    };
    const refused = WriteResponseSchema.parse(
      (await call("alice", "log_workout_sets", pending)).structuredContent,
    );
    expect(refused.error?.code).toBe("GOOGLE_REAUTH_REQUIRED");

    // A new chat: the setup claim is gone, the verified account is enough.
    const response = await reconnect("alice");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.text()).toContain("wieder verbunden");
    expect(google.creates).toBe(1);
    expect(
      (await call("alice", "get_google_connection")).structuredContent,
    ).toMatchObject({ connection: { status: "CONNECTED" } });

    const retried = WriteResponseSchema.parse(
      (await call("alice", "log_workout_sets", pending)).structuredContent,
    );
    expect(retried.ok, retried.error?.message).toBe(true);
    const sets = WorkoutContextSchema.parse(
      (await call("alice", "get_workout", { workout_id: workout.workout_id }))
        .structuredContent,
    ).sets;
    expect(sets.map((set) => set.reps).sort()).toEqual([10, 6].sort());
    expect((await call("alice", "get_arnold_dashboard")).isError).toBeFalsy();
  });

  it("refuses a different Google account and keeps the tracker untouched", async () => {
    await connected("alice");
    await startWorkout("alice");
    google.revoked.add("alice");
    expect((await call("alice", "get_workout")).isError).toBe(true);

    const foreign = await reconnect("alice", "mallory");
    expect(foreign.status).toBe(400);
    expect(await foreign.text()).toContain("dasselbe Google-Konto");
    expect(
      (await readFile(join(directory, "connections.json"), "utf8")).includes(
        "mallory",
      ),
    ).toBe(false);
    expect(google.creates).toBe(1);

    // The right account still works afterwards.
    expect((await reconnect("alice")).status).toBe(200);
    expect((await call("alice", "get_workout")).isError).toBeFalsy();
  });

  it("still needs the setup claim before the account is set up", async () => {
    await setup("bob");
    const refused = await call("bob", "connect_google_account", {});
    expect(refused.isError).toBe(true);
    expect(meta(refused)).toMatchObject({
      code: "SETUP_REQUIRED",
      recovery: "finish_setup",
    });
    expect(google.creates).toBe(0);
  });

  it("accepts the claim fields only together", async () => {
    await connected("alice");
    const result = await call("alice", "connect_google_account", {
      onboarding_session_id: "only-one-field",
    });
    expect(result.isError).toBe(true);
  });
});

describe("B15: completed setup data follows the 30-day rule", () => {
  it("deletes the completed setup session and still runs the setup only once", async () => {
    const { claim } = await connected("alice");
    await startWorkout("alice");
    const sessionsFile = join(
      runtime.userDirectory(
        JSON.parse(await readFile(join(directory, "identities.json"), "utf8"))
          .users[0].user_id,
      ),
      "onboarding.json",
    );
    expect(JSON.parse(await readFile(sessionsFile, "utf8"))).toHaveLength(1);
    expect((await runtime.applyRetention(30)).setup_sessions).toBe(0);

    const later = await runtime.applyRetention(
      30,
      Date.now() + 31 * 86_400_000,
    );
    expect(later.setup_sessions).toBe(1);
    const left = await readFile(sessionsFile, "utf8");
    expect(JSON.parse(left)).toEqual([]);
    expect(left).not.toContain("strength");

    // Still set up: training works, and no second setup can start.
    expect((await call("alice", "get_arnold_dashboard")).isError).toBeFalsy();
    expect((await call("alice", "get_workout")).isError).toBeFalsy();
    const restart = OnboardingResponseSchema.parse(
      (
        await call("alice", "start_arnold_onboarding", {
          request_id: randomUUID(),
        })
      ).structuredContent,
    );
    expect(restart.error?.code).toBe("ONBOARDING_ALREADY_COMPLETED");
    const shown = await call("alice", "show_arnold_onboarding");
    expect(shown.isError).toBe(true);
    expect(JSON.stringify(shown)).toContain("ONBOARDING_ALREADY_COMPLETED");

    // An old claim no longer exists, and reconnecting does not need it (B14).
    google.revoked.add("alice");
    const started = await call("alice", "connect_google_account", {});
    expect(started.isError, JSON.stringify(started.content)).toBeFalsy();
    expect((await call("alice", "get_onboarding_state", claim)).isError).toBe(
      true,
    );
    expect(google.creates).toBe(1);
  });
});

describe("B16: finish_arnold_setup names the verified file", () => {
  it("returns the name Google reports, also when repeated after completion", async () => {
    const { claim } = await connected("alice");
    const first = await call("alice", "finish_arnold_setup", claim);
    expect(first.isError, JSON.stringify(first.content)).toBeFalsy();
    expect(first.structuredContent).toMatchObject({
      spreadsheet_url: expect.stringMatching(/^https:\/\/docs\.google\.com\//),
      spreadsheet_name: "Arnold – Mein Training",
    });

    // The user renamed the file in Drive: Arnold reports the real name.
    const file = [...google.files.values()].find((f) => f.owner === "alice")!;
    file.name = "Mein Krafttraining 2026";
    const again = await call("alice", "finish_arnold_setup", claim);
    expect(again.structuredContent).toMatchObject({
      spreadsheet_name: "Mein Krafttraining 2026",
    });
    expect(JSON.stringify(again.content)).toContain("Mein Krafttraining 2026");
  });

  it("leaves the name out when Google reports none", async () => {
    const { claim } = await connected("alice");
    const file = [...google.files.values()].find((f) => f.owner === "alice")!;
    file.name = "";
    const result = await call("alice", "finish_arnold_setup", claim);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).not.toHaveProperty("spreadsheet_name");
  });
});
