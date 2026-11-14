/**
 * RUN-026 against the real Postgres: the run answers of the setup end up in
 * the run profile of exactly the person who gave them, never in anyone
 * else's; a running goal without them cannot ask for a plan; and repeating
 * the finish never saves the run profile twice.
 */
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
  type OnboardingResponse,
} from "../src/shared/onboarding-contract.js";
import {
  jwksDocument,
  makeRsaKey,
  signJwt,
  validClaims,
} from "./fixtures/arnold-auth.js";
import { appDatabase } from "./fixtures/arnold-db.js";

const key = makeRsaKey("onboarding-run-issuer");
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
    client = new Client({ name: "db-onboarding-run", version: "1" });
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

const RUN = {
  goal: "10k",
  runs_per_week: 3,
  base_minutes_per_week: 120,
  longest_run_4w_min: 45,
  preferred_environment: "outdoor",
} as const;

const parse = (result: CallToolResult) =>
  OnboardingResponseSchema.parse(result.structuredContent);

async function open(subject: string) {
  const opened = OnboardingViewSchema.parse(
    (await call(subject, "show_arnold_onboarding", {})).structuredContent,
  );
  return {
    onboarding_session_id: opened.state.session.onboarding_session_id,
    session_token: opened.session_token!,
  };
}

async function saveProfile(
  subject: string,
  claim: Record<string, unknown>,
  goal: string,
  run?: object,
) {
  const saved = parse(
    await call(subject, "update_onboarding_profile", {
      ...claim,
      request_id: randomUUID(),
      profile: {
        path: "arnold_plan",
        training: {
          primary_goal: goal,
          experience: "intermediate",
          days_per_week: 3,
          session_minutes: 60,
          environment: "gym",
          ...(run ? { run } : {}),
        },
      },
    }),
  );
  expect(saved.ok, saved.error?.message).toBe(true);
  return saved;
}

const proposal = (subject: string, claim: Record<string, unknown>) =>
  call(subject, "submit_onboarding_plan_proposal", {
    ...claim,
    request_id: randomUUID(),
    name: "Mein Trainingsplan",
    origin: "manual",
    sessions: ["bench-press", "lat-pulldown", "squat"].map(
      (exercise_id, i) => ({
        session_name: `Einheit ${i + 1}`,
        exercises: [{ exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 }],
      }),
    ),
  });

/** Proposal and confirmation; the finish happens with the confirmation. */
async function confirmPlan(subject: string, claim: Record<string, unknown>) {
  const proposed = parse(await proposal(subject, claim));
  expect(proposed.ok, proposed.error?.message).toBe(true);
  const plan = proposed.state!.plan!;
  const confirmed = parse(
    await call(subject, "confirm_onboarding_plan", {
      ...claim,
      request_id: randomUUID(),
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    }),
  );
  expect(confirmed.ok, confirmed.error?.message).toBe(true);
  return confirmed;
}

const runProfile = async (subject: string) =>
  (await call(subject, "get_run_profile", {})).structuredContent as {
    profile: null | {
      row_revision: number;
      goal: string;
      base_minutes_per_week: number | null;
      longest_run_4w_min: number | null;
      runs_per_week: number;
    };
  };

describe("setup with the goal Ausdauer und Laufen (database)", () => {
  it("refuses a plan request and a proposal while the run answers are missing", async () => {
    const claim = await open(alice);
    await saveProfile(alice, claim, "endurance_running");
    const request = parse(
      await call(alice, "request_onboarding_plan", {
        ...claim,
        request_id: randomUUID(),
      }),
    );
    expect(request.ok).toBe(false);
    expect(request.error?.code).toBe("PROFILE_INCOMPLETE");
    const proposed = parse(await proposal(alice, claim));
    expect(proposed.ok).toBe(false);
    expect(proposed.error?.code).toBe("PROFILE_INCOMPLETE");
    // The run service stays closed until the setup is done (SETUP_REQUIRED).
    expect((await call(alice, "get_run_profile", {})).isError).toBe(true);
  });

  it("hands the run answers to the run profile of this person only", async () => {
    const aliceClaim = await open(alice);
    const bobClaim = await open(bob);
    await saveProfile(alice, aliceClaim, "endurance_running", RUN);
    await saveProfile(bob, bobClaim, "strength");
    const done = await confirmPlan(alice, aliceClaim);
    expect(done.state?.session.status).toBe("COMPLETED");
    const mine = (await runProfile(alice)).profile;
    expect(mine).toMatchObject({
      row_revision: 1,
      goal: "10k",
      runs_per_week: 3,
      base_minutes_per_week: 120,
      longest_run_4w_min: 45,
    });
    // Bob's setup has no running goal: after his own setup he still has none.
    expect((await confirmPlan(bob, bobClaim)).state?.session.status).toBe(
      "COMPLETED",
    );
    expect((await runProfile(bob)).profile).toBeNull();
    expect((await runProfile(alice)).profile?.row_revision).toBe(1);
  });

  it("repeating the finish saves the run profile only once", async () => {
    const claim = await open(alice);
    await saveProfile(alice, claim, "strength", undefined);
    await saveProfile(alice, claim, "strength", undefined);
    // Running as a further goal counts the same as a main goal.
    const profile = parse(
      await call(alice, "update_onboarding_profile", {
        ...claim,
        request_id: randomUUID(),
        profile: {
          training: { secondary_goals: ["endurance_running"], run: RUN },
        },
      }),
    );
    expect(profile.ok, profile.error?.message).toBe(true);
    await confirmPlan(alice, claim);
    expect((await runProfile(alice)).profile?.row_revision).toBe(1);
    for (let i = 0; i < 2; i++) {
      const again: OnboardingResponse = parse(
        await call(alice, "finish_arnold_setup", {
          ...claim,
          request_id: randomUUID(),
        }),
      );
      expect(again.ok, again.error?.message).toBe(true);
      expect((await runProfile(alice)).profile?.row_revision).toBe(1);
    }
  });
});
