/**
 * MOB-003: telling the setup by voice.
 *
 * What a voice message needs from the server: everything recognised is saved
 * in one call, the text after every call names at most three open questions,
 * the tool descriptions allow voice, chat and buttons alike, and the finish
 * hands the mobility answer over exactly like the run details: refused
 * without a mobility service, reported (never swallowed) when it fails, safe
 * to repeat.
 */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/server/http";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { OnboardingService } from "../src/server/onboarding/service";
import {
  OnboardingResponseSchema,
  type OnboardingProfilePatch,
  type OnboardingResponse,
} from "../src/shared/onboarding-contract";
import type { MobilityPreference } from "../src/shared/mobility-contract";
import { asCard } from "./fixtures/card-view";

const rid = () => randomUUID();

const TRAINING = {
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
} as const;

/* ------------------------------------------------------------- over MCP */

let client: Client;
let http: Server;
let runtime: ReturnType<typeof createFixtureOnboarding>;

const call = async (name: string, args: Record<string, unknown> = {}) =>
  asCard((await client.callTool({ name, arguments: args })) as CallToolResult);
const textOf = (result: CallToolResult) => {
  const block = result.content[0];
  return block && block.type === "text" ? block.text : "";
};
const write = async (
  name: string,
  args: Record<string, unknown>,
): Promise<OnboardingResponse> =>
  OnboardingResponseSchema.parse((await call(name, args)).structuredContent);

beforeEach(async () => {
  runtime = createFixtureOnboarding();
  http = createHttpApp({
    workoutRuntime: runtime,
    allowedHosts: ["127.0.0.1", "localhost"],
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  client = new Client({ name: "synthetic-voice-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
});
afterEach(async () => {
  await client.close();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

async function startSetup() {
  const response = await write("start_arnold_onboarding", {
    request_id: rid(),
  });
  expect(response.ok).toBe(true);
  return {};
}

const descriptions = async () =>
  new Map(
    (await client.listTools()).tools.map((tool) => [
      tool.name,
      tool.description ?? "",
    ]),
  );

describe("the tool descriptions", () => {
  it("drop the button-only rule and allow voice, chat and buttons", async () => {
    const show = (await descriptions()).get("show_arnold_onboarding")!;
    expect(show).not.toContain("per Button erfasst");
    expect(show).not.toContain("im Chat nichts doppelt abfragen");
    expect(show).toContain("Sprachnachricht");
    expect(show).toContain("EINEM update_onboarding_profile-Aufruf");
    expect(show).toContain("höchstens drei Fragen");
    expect(show).toContain("open_questions");
    expect(show).toMatch(/nie geraten/i);
    expect(show).toContain("arnold_plan");
  });

  it("name training.mobility with its values and the pain rule", async () => {
    const update = (await descriptions()).get("update_onboarding_profile")!;
    expect(update).toContain("mobility");
    expect(update).toContain("wants:false");
    expect(update).toContain("wants:true");
    for (const word of [
      "own_days",
      "after_strength",
      "arnold_decides",
      "neck",
      "calves_ankles",
      "wrists",
    ])
      expect(update).toContain(word);
    expect(update).toContain("protect_areas");
    expect(update).toMatch(/steif heißt nicht Schmerz/);
    // The example of a free narration.
    expect(update).toContain("Kraft und Laufen, viermal die Woche");
  });

  it("stay under the usual length", async () => {
    for (const [name, text] of await descriptions())
      expect(text.length, name).toBeLessThan(3000);
  });

  it("the instructions carry the voice paragraph", () => {
    const text = client.getInstructions() ?? "";
    expect(text).toContain("Einrichtung per Sprache");
    expect(text).toContain("EINEM update_onboarding_profile-Aufruf");
  });
});

describe("a free narration", () => {
  it("'Kraft und Laufen, viermal die Woche' is stored in one call", async () => {
    const claim = await startSetup();
    const saved = await write("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: {
        path: "arnold_plan",
        training: {
          primary_goal: "strength",
          secondary_goals: ["endurance_running"],
          days_per_week: 4,
        },
      },
    });
    expect(saved.ok, saved.error?.message).toBe(true);
    const training = saved.state!.session.profile.training;
    expect(training.primary_goal).toBe("strength");
    expect(training.secondary_goals).toEqual(["endurance_running"]);
    expect(training.days_per_week).toBe(4);
    // Nothing that was not said is guessed.
    expect(training.experience).toBeNull();
    expect(training.environment).toBeNull();
    expect(training.session_minutes).toBeNull();
    expect(training.mobility).toBeUndefined();
    // One call, one revision.
    expect(saved.state!.session.profile.revision).toBe(1);
  });

  it("the text after the call names at most three open questions", async () => {
    const claim = await startSetup();
    const saved = await call("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: {
        path: "arnold_plan",
        training: {
          primary_goal: "strength",
          secondary_goals: ["endurance_running"],
          days_per_week: 4,
        },
      },
    });
    const state = OnboardingResponseSchema.parse(
      saved.structuredContent,
    ).state!;
    // experience, session_minutes, environment, run_details, mobility.
    expect(state.open_questions.length).toBeGreaterThan(3);
    const text = textOf(saved);
    expect(text).toContain(
      "Offene Fragen (höchstens drei in einer Nachricht):",
    );
    const asks = state.open_questions.map((q) => q.ask);
    for (const ask of asks.slice(0, 3)) expect(text).toContain(ask);
    for (const ask of asks.slice(3)) expect(text).not.toContain(ask);
    // The old "fills in the cards" sentence is gone, chat and voice count.
    expect(text).not.toContain("füllt in der App die Karten");
    expect(text).toContain("Sprachnachricht");
    // No secret in the transcript text.
    expect(text).not.toContain("session_token");
    expect(text).not.toContain("onb-");
  });

  it("asks for mobility once when the profile is otherwise complete", async () => {
    const claim = await startSetup();
    await write("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: { path: "arnold_plan", training: TRAINING },
    });
    const text = textOf(await call("get_onboarding_state", claim));
    expect(text).toContain(
      "Sollen eine Morgenroutine oder Mobility-Einheiten dazukommen?",
    );
    await write("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: { training: { mobility: { wants: false } } },
    });
    expect(textOf(await call("get_onboarding_state", claim))).not.toContain(
      "Offene Fragen",
    );
  });

  it("keeps the welcome text of the card hint", async () => {
    const claim = await startSetup();
    const text = textOf(await call("get_onboarding_state", claim));
    expect(text).toMatch(/Karte zeigen/);
    expect(text).toContain("Offene Fragen");
  });
});

/* -------------------------------------------------------------- finishing */

type Calls = { preference: MobilityPreference; session: string }[];

/** The same setup, with a (fake) mobility service wired in. */
function withMobilityService(
  service: OnboardingService,
  record?: (
    preference: MobilityPreference,
    session: string,
    context: unknown,
  ) => Promise<void>,
) {
  return new OnboardingService({
    ...(service as unknown as { options: Record<string, unknown> }).options,
    recordMobilityProfile: record,
  } as never);
}

async function confirmedSetup(
  service: OnboardingService,
  profile: OnboardingProfilePatch,
) {
  const started = await service.startOnboarding({ request_id: rid() });
  const claim = {};
  const saved = await service.updateProfile({
    request_id: rid(),
    ...claim,
    profile,
  });
  expect(saved.ok, saved.error?.message).toBe(true);
  const brief = await service.getBrief(claim);
  const submitted = await service.submitPlanProposal({
    request_id: rid(),
    ...claim,
    name: "Mein Plan",
    origin: "ai_proposal",
    sessions: brief.exercise_catalog.slice(0, 3).map((e, i) => ({
      session_name: `Einheit ${i + 1}`,
      exercises: [
        { exercise_id: e.exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 },
      ],
    })),
  });
  expect(submitted.ok, submitted.error?.message).toBe(true);
  const plan = submitted.state!.plan!;
  const done = await service.confirmPlan({
    request_id: rid(),
    ...claim,
    confirmation: {
      plan_version_id: plan.plan_version_id,
      row_revision: plan.row_revision,
      confirmed: true,
    },
  });
  expect(done.ok, done.error?.message).toBe(true);
  return claim;
}

const WANTS: MobilityPreference = {
  wants: true,
  morning: {
    weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    minutes: 10,
  },
  sessions: null,
  stiff_areas: ["hips"],
};

const withMobility = (
  mobility: MobilityPreference,
): OnboardingProfilePatch => ({
  path: "arnold_plan",
  training: { ...TRAINING, mobility },
});

describe("finishing with a mobility answer", () => {
  it("is refused without a mobility service and activates nothing", async () => {
    const fixture = createFixtureOnboarding();
    const claim = await confirmedSetup(fixture.onboarding, withMobility(WANTS));
    const bare = withMobilityService(fixture.onboarding, undefined);
    const refused = await bare.finishSetup({ request_id: rid(), ...claim });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("PLAN_WRITE_UNAVAILABLE");
    expect(refused.error?.message).toMatch(/Mobility/);
    // Nothing was activated: the setup is not completed.
    const state = await bare.getOnboardingState(claim);
    expect(state.session.status).not.toBe("COMPLETED");
    expect(state.session.status).toBe("READY_TO_FINISH");
  });

  it("a setup without any mobility answer finishes without the option", async () => {
    const fixture = createFixtureOnboarding();
    const claim = await confirmedSetup(fixture.onboarding, {
      path: "arnold_plan",
      training: TRAINING,
    });
    const bare = withMobilityService(fixture.onboarding, undefined);
    const done = await bare.finishSetup({ request_id: rid(), ...claim });
    expect(done.ok, done.error?.message).toBe(true);
    expect(done.state!.session.status).toBe("COMPLETED");
  });

  it("hands the answer over once, after the plan is active", async () => {
    const fixture = createFixtureOnboarding();
    const claim = await confirmedSetup(fixture.onboarding, withMobility(WANTS));
    const calls: Calls = [];
    let statusAtCall: string | null = null;
    const service = withMobilityService(
      fixture.onboarding,
      async (preference, session) => {
        calls.push({ preference, session });
        // The plan is already active and the setup committed as finished.
        statusAtCall = (await fixture.onboarding.getOnboardingState(claim))
          .session.status;
      },
    );
    const done = await service.finishSetup({ request_id: rid(), ...claim });
    expect(done.ok, done.error?.message).toBe(true);
    expect(done.state!.session.status).toBe("COMPLETED");
    expect(calls).toEqual([{ preference: WANTS, session: expect.any(String) }]);
    expect(statusAtCall).toBe("COMPLETED");
    expect(done.state!.open_questions).toEqual([]);
  });

  it("hands over a no as well, so it is never asked again", async () => {
    const fixture = createFixtureOnboarding();
    const claim = await confirmedSetup(
      fixture.onboarding,
      withMobility({ wants: false }),
    );
    const calls: Calls = [];
    const service = withMobilityService(fixture.onboarding, async (p, s) => {
      calls.push({ preference: p, session: s });
    });
    const done = await service.finishSetup({ request_id: rid(), ...claim });
    expect(done.ok, done.error?.message).toBe(true);
    expect(calls).toEqual([
      { preference: { wants: false }, session: expect.any(String) },
    ]);
  });

  it("a repeated finish stays idempotent: same answer, same session id", async () => {
    const fixture = createFixtureOnboarding();
    const claim = await confirmedSetup(fixture.onboarding, withMobility(WANTS));
    // The fake keeps one answer per setup, like the real service's request id.
    const stored = new Map<string, MobilityPreference>();
    const service = withMobilityService(fixture.onboarding, async (p, s) => {
      stored.set(s, p);
    });
    const first = await service.finishSetup({ request_id: rid(), ...claim });
    const second = await service.finishSetup({ request_id: rid(), ...claim });
    expect(first.ok).toBe(true);
    expect(second.ok, second.error?.message).toBe(true);
    expect(second.replayed).toBe(true);
    expect(second.state!.session.status).toBe("COMPLETED");
    expect([...stored.values()]).toEqual([WANTS]);
  });

  it("reports a failure of the option and lets the finish be repeated", async () => {
    const fixture = createFixtureOnboarding();
    const claim = await confirmedSetup(fixture.onboarding, withMobility(WANTS));
    let failing = true;
    let attempts = 0;
    const service = withMobilityService(fixture.onboarding, async () => {
      attempts += 1;
      if (failing) throw new Error("Datenbank nicht erreichbar");
    });
    const failed = await service.finishSetup({ request_id: rid(), ...claim });
    expect(failed.ok).toBe(false);
    expect(failed.error?.code).toBe("PLAN_WRITE_UNAVAILABLE");
    expect(failed.error?.retryable).toBe(true);
    expect(failed.error?.message).toMatch(/Dein Plan ist aktiv, aber/);
    expect(failed.error?.message).toMatch(/Mobility/);
    // The internal reason does not reach the chat.
    expect(failed.error?.message).not.toContain("Datenbank");
    expect(attempts).toBe(1);

    failing = false;
    const again = await service.finishSetup({ request_id: rid(), ...claim });
    expect(again.ok, again.error?.message).toBe(true);
    expect(again.state!.session.status).toBe("COMPLETED");
    expect(attempts).toBe(2);
  });
});
