/**
 * MOB-005 against the real Postgres: the mobility service for two users (rows,
 * request_id replay, the watch result, row level security) and the setup, whose
 * mobility answer ends up in the profile of exactly the person who gave it.
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
import { MobilityService } from "../src/server/mobility/service.js";
import { TrainingPlanService } from "../src/server/plan/service.js";
import { WorkoutLoggingService } from "../src/server/workout/service.js";
import type { AuthorizationGuard } from "../src/server/workout/infrastructure.js";
import { MobilityOverviewSchema } from "../src/shared/mobility-contract.js";
import {
  OnboardingResponseSchema,
  OnboardingViewSchema,
} from "../src/shared/onboarding-contract.js";
import {
  jwksDocument,
  makeRsaKey,
  signJwt,
  validClaims,
} from "./fixtures/arnold-auth.js";
import { appDatabase, asOwner, newAccount } from "./fixtures/arnold-db.js";

const key = makeRsaKey("mobility-service-issuer");
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
    client = new Client({ name: "db-mobility-service", version: "1" });
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

const parse = (result: CallToolResult) =>
  OnboardingResponseSchema.parse(result.structuredContent);
const TZ = "Europe/Berlin";

/* ------------------------------------------------- the service, two users */

type Account = Awaited<ReturnType<typeof newAccount>>;

function servicesFor(account: Account, now = "2026-11-23T08:00:00Z") {
  const authorization: AuthorizationGuard = {
    authorize: async () => ({
      subject: account.userId,
      trackerId: account.trackerId,
      verified: true,
      kind: "authenticated",
      permissions: ["write", "correct_completed"],
    }),
  };
  const options = {
    mode: "database" as const,
    trackerId: account.trackerId,
    store: account.store,
    authorization,
    clock: () => new Date(now),
  };
  return {
    mobility: new MobilityService(options),
    plans: new TrainingPlanService(options),
    logging: new WorkoutLoggingService(options),
  };
}

const MORNING = {
  type: "add_mobility_session",
  kind: "morning",
  session_name: "Morgenroutine",
  minutes: 10,
  exercise_ids: [
    "mob_neck_rolls",
    "mob_neck_side",
    "mob_shoulder_circles",
    "mob_arm_circles",
    "mob_doorway_chest",
  ],
  weekdays: [1, 2, 3, 4, 5, 6, 7],
};

async function activePlanWithMobility(plans: TrainingPlanService) {
  const created = await plans.execute("create_training_plan", {
    request_id: randomUUID(),
    name: "Testplan",
    days_per_week: 2,
    sessions: [
      {
        session_name: "A",
        exercises: [
          { exercise_id: "squat", target_sets: 3, rep_min: 6, rep_max: 8 },
        ],
      },
    ],
  });
  expect(created.error).toBeNull();
  const draft = created.result!.plan!.version;
  const edited = await plans.execute("update_plan_draft", {
    request_id: randomUUID(),
    plan_version_id: draft.plan_version_id,
    expected_row_revision: draft.row_revision,
    edits: [MORNING],
  });
  expect(edited.error).toBeNull();
  const version = edited.result!.plan!.version;
  const activated = await plans.execute("activate_training_plan", {
    request_id: randomUUID(),
    plan_version_id: version.plan_version_id,
    expected_row_revision: version.row_revision,
    confirmation: {
      plan_version_id: version.plan_version_id,
      row_revision: version.row_revision,
      confirmed: true,
    },
  });
  expect(activated.error).toBeNull();
  return version.plan_version_id;
}

const count = (userId: string, table: string) =>
  db.asUser(userId, async (c) =>
    Number(
      (await c.query(`select count(*) as n from arnold.${table}`)).rows[0].n,
    ),
  );

describe("the mobility service on Postgres", () => {
  it("stores profile, routine and result for its own user and replays a request_id", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const a = servicesFor(alice);
    const b = servicesFor(bob);
    expect((await a.mobility.getOverview(undefined, TZ)).profile.state).toBe(
      "not_asked",
    );

    const wants = {
      wants: true as const,
      morning: {
        weekdays: ["mon", "tue"] as ("mon" | "tue")[],
        minutes: 10 as const,
      },
      sessions: null,
      stiff_areas: ["hips" as const],
    };
    const request_id = randomUUID();
    const first = await a.mobility.updateProfile(
      { request_id, preference: wants },
      undefined,
    );
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(
      await a.mobility.updateProfile(
        { request_id, preference: wants },
        undefined,
      ),
    ).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(await count(alice.userId, "mobility_profiles")).toBe(1);

    await activePlanWithMobility(a.plans);
    const logId = randomUUID();
    const logged = await a.mobility.logMobility(
      { request_id: logId, kind: "morning", timezone: TZ, minutes: 9 },
      undefined,
    );
    expect(logged.ok).toBe(true);
    const replayed = await a.mobility.logMobility(
      { request_id: logId, kind: "morning", timezone: TZ, minutes: 9 },
      undefined,
    );
    expect(replayed).toMatchObject({
      ok: true,
      replayed: true,
      workout_id: logged.workout_id,
    });
    const duplicate = await a.mobility.logMobility(
      { request_id: randomUUID(), kind: "morning", timezone: TZ },
      undefined,
    );
    expect(duplicate.error?.code).toBe("DUPLICATE_MOBILITY");

    const mine = MobilityOverviewSchema.parse(
      await a.mobility.getOverview(undefined, TZ),
    );
    expect(mine.profile.state).toBe("yes");
    expect(mine.today.date_local).toBe("2026-11-23");
    expect(mine.today.items).toMatchObject([{ kind: "morning", done: true }]);
    expect(mine.recent).toMatchObject([
      { workout_id: logged.workout_id, source: "chat", timer_s: 540 },
    ]);
    expect(mine.adherence).toMatchObject({
      planned_count: 1,
      done_count: 1,
      ratio: 1,
    });

    // Bob sees nothing of it.
    const theirs = await b.mobility.getOverview(undefined, TZ);
    expect(theirs.profile.state).toBe("not_asked");
    expect(theirs.recent).toEqual([]);
    expect(theirs.today.items).toEqual([]);
    expect(await count(bob.userId, "mobility_profiles")).toBe(0);
    expect(await count(bob.userId, "mobility_results")).toBe(0);
    expect(await count(alice.userId, "mobility_results")).toBe(1);
    expect(await count(alice.userId, "plan_mobility_sessions")).toBeGreaterThan(
      0,
    );
    expect(await count(bob.userId, "plan_mobility_sessions")).toBe(0);
  });

  it("keeps the audit events of both writes and the receipts together", async () => {
    const alice = await newAccount(db);
    const a = servicesFor(alice);
    const request_id = randomUUID();
    const logged = await a.mobility.logMobility(
      { request_id, kind: "session", timezone: TZ },
      undefined,
    );
    expect(logged.ok).toBe(true);
    const events = await db.asUser(alice.userId, async (c) =>
      (
        await c.query(
          `select event_type from arnold.audit_events where operation_id = $1 order by event_type`,
          [request_id],
        )
      ).rows.map((r) => r.event_type),
    );
    expect(events).toEqual(["MOBILITY_LOGGED", "WORKOUT_LOGGED"]);
    expect(await alice.store.hasOperation(request_id)).toBe(true);
  });

  it("saves the watch result once and refuses the recording under a new id", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const a = servicesFor(alice);
    const planVersion = await activePlanWithMobility(a.plans);
    const session = (await alice.store.read()).planMobilitySessions!.find(
      (s) => s.plan_version_id === planVersion,
    )!;
    const req = {
      request_id: `gm_${randomUUID()}`,
      session_uuid: randomUUID(),
      plan_version_id: session.plan_version_id,
      session_id: session.session_id,
      kind: "morning",
      workout_date_local: "2026-11-23",
      utc_offset_min: 60,
      started_at_utc: "2026-11-23T06:00:00Z",
      ended_at_utc: "2026-11-23T06:10:00Z",
      timer_s: 560,
      elapsed_s: 600,
      ended_early: true,
      ex: session.template.exercise_ids.slice(0, 3).map((c, i) => ({
        c,
        st: i === 2 ? "partial" : "done",
        t: 60,
      })),
    };
    const first = await a.mobility.saveWatchMobility(req, undefined, TZ);
    expect(first).toMatchObject({ ok: true, value: { replayed: false } });
    expect(
      await a.mobility.saveWatchMobility(req, undefined, TZ),
    ).toMatchObject({
      ok: true,
      value: { replayed: true },
    });
    const conflict = await a.mobility.saveWatchMobility(
      { ...req, request_id: `gm_${randomUUID()}` },
      undefined,
      TZ,
    );
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_WORKOUT" },
    });
    const row = (await alice.store.read()).mobilityResults![0]!;
    expect(row).toMatchObject({
      result_source: "watch",
      ended_early: true,
      exercises_total: 5,
      exercises_done: 2,
      exercises_skipped: 1,
    });
    expect(await count(bob.userId, "mobility_results")).toBe(0);
  });

  it("voids a routine through void_workout and the overview drops it", async () => {
    const alice = await newAccount(db);
    const a = servicesFor(alice);
    const logged = await a.mobility.logMobility(
      { request_id: randomUUID(), kind: "session", timezone: TZ },
      undefined,
    );
    const voided = await a.logging.execute(
      "void_workout",
      {
        request_id: randomUUID(),
        workout_id: logged.workout_id,
        expected_row_revision: 1,
        correction_reason: "Versehentlich gespeichert.",
      },
      undefined,
    );
    expect(voided.error).toBeNull();
    expect((await a.mobility.getOverview(undefined, TZ)).recent).toEqual([]);
  });

  it("row level security: another user sees and changes nothing", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const a = servicesFor(alice);
    await a.mobility.updateProfile(
      { request_id: randomUUID(), preference: { wants: false } },
      undefined,
    );
    const seen = await db.asUser(bob.userId, (c) =>
      c.query("select * from arnold.mobility_profiles"),
    );
    expect(seen.rowCount).toBe(0);
    const updated = await db.asUser(bob.userId, (c) =>
      c.query("update arnold.mobility_profiles set wants = true"),
    );
    expect(updated.rowCount).toBe(0);
    expect((await a.mobility.getOverview(undefined, TZ)).profile.state).toBe(
      "no",
    );
    // The service is bound to its own user: a store of another user never
    // reads these rows, whatever the caller passes.
    const b = servicesFor(bob);
    expect((await b.mobility.getOverview(undefined, TZ)).profile.state).toBe(
      "not_asked",
    );
    // The raw table, read as the owner, holds exactly one profile of Alice.
    const owned = await asOwner(async (c) =>
      Number(
        (
          await c.query(
            "select count(*) as n from arnold.mobility_profiles where user_id = $1",
            [alice.userId],
          )
        ).rows[0].n,
      ),
    );
    expect(owned).toBe(1);
  });
});

/* -------------------------------------------- the setup, through the runtime */

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
  mobility?: object,
) {
  const saved = parse(
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
          ...(mobility ? { mobility } : {}),
        },
      },
    }),
  );
  expect(saved.ok, saved.error?.message).toBe(true);
}

async function confirmPlan(subject: string, claim: Record<string, unknown>) {
  const proposed = parse(
    await call(subject, "submit_onboarding_plan_proposal", {
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
    }),
  );
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

const overview = async (subject: string) =>
  MobilityOverviewSchema.parse(
    (await call(subject, "get_mobility_overview", { timezone: TZ }))
      .structuredContent,
  );

const profileRows = (subject: string) =>
  asOwner(
    async (c) =>
      (
        await c.query(
          `select p.wants, p.row_revision, p.morning_minutes, p.stiff_areas
           from arnold.mobility_profiles p
           join arnold.identity_connections i on i.user_id = p.user_id
          where i.subject = $1`,
          [subject],
        )
      ).rows,
  );

describe("setup with a mobility answer (database)", () => {
  it("finishes with a yes, saves the profile for this person only, and repeating changes nothing", async () => {
    const aliceClaim = await open(alice);
    const bobClaim = await open(bob);
    await saveProfile(alice, aliceClaim, {
      wants: true,
      morning: { weekdays: ["mon", "wed", "fri"], minutes: 10 },
      sessions: null,
      stiff_areas: ["hips"],
    });
    await saveProfile(bob, bobClaim);
    const done = await confirmPlan(alice, aliceClaim);
    expect(done.state?.session.status).toBe("COMPLETED");

    const mine = await overview(alice);
    expect(mine.profile).toEqual({
      state: "yes",
      preference: {
        wants: true,
        morning: { weekdays: ["mon", "wed", "fri"], minutes: 10 },
        sessions: null,
        stiff_areas: ["hips"],
      },
    });
    expect(await profileRows(alice)).toMatchObject([
      { wants: true, row_revision: 1 },
    ]);

    // Bob's setup carries no mobility answer: he has no profile afterwards.
    expect((await confirmPlan(bob, bobClaim)).state?.session.status).toBe(
      "COMPLETED",
    );
    expect((await overview(bob)).profile.state).toBe("not_asked");
    expect(await profileRows(bob)).toEqual([]);

    for (let i = 0; i < 2; i++) {
      const again = parse(
        await call(alice, "finish_arnold_setup", {
          ...aliceClaim,
          request_id: randomUUID(),
        }),
      );
      expect(again.ok, again.error?.message).toBe(true);
      expect(await profileRows(alice)).toMatchObject([
        { wants: true, row_revision: 1 },
      ]);
    }
  });

  it("saves a no as well and keeps no details", async () => {
    const claim = await open(alice);
    await saveProfile(alice, claim, { wants: false });
    const done = await confirmPlan(alice, claim);
    expect(done.state?.session.status).toBe("COMPLETED");
    expect((await overview(alice)).profile).toEqual({
      state: "no",
      preference: { wants: false },
    });
    expect(await profileRows(alice)).toMatchObject([
      { wants: false, row_revision: 1, morning_minutes: null, stiff_areas: [] },
    ]);
  });

  it("the mobility tools stay closed until the setup is done", async () => {
    const claim = await open(alice);
    await saveProfile(alice, claim, { wants: false });
    expect(
      (await call(alice, "get_mobility_overview", { timezone: TZ })).isError,
    ).toBe(true);
    const log = await call(alice, "log_mobility", {
      request_id: randomUUID(),
      kind: "session",
      timezone: TZ,
    });
    expect(log.isError).toBe(true);
    expect(await profileRows(alice)).toEqual([]);
  });
});
