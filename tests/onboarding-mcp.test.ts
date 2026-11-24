/**
 * The onboarding MCP surface over real Streamable HTTP.
 *
 * These tests drive the server the way ChatGPT would: a real client, real tool
 * discovery, real Zod-validated inputs and outputs. They are the proof for §9
 * and §19 — that a chat turn and the wizard reach one server state through one
 * set of rules, with no shadow copy of the profile anywhere.
 *
 * The suite also guards the existing surface: `show_arnold_dashboard` and the
 * Task 005 plan tools must keep working unchanged next to the new ones.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { newTrackerDataset } from "../src/server/account/catalog";
import { planFixtureDataset } from "../src/server/plan/fixture";
import {
  ONBOARDING_CONTRACT,
  OnboardingBriefSchema,
  OnboardingHandoffSchema,
  OnboardingResponseSchema,
  OnboardingStateSchema,
  OnboardingViewSchema,
  type OnboardingResponse,
} from "../src/shared/onboarding-contract";
import {
  PlanWriteResponseSchema,
  TrainingPlanVersionSchema,
} from "../src/shared/plan-contract";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";

let client: Client;
let http: Server;
let runtime: ReturnType<typeof createFixtureOnboarding>;

const rid = () => randomUUID();

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;

const textOf = (result: CallToolResult) => {
  const block = result.content[0];
  return block && block.type === "text" ? block.text : "";
};

const write = async (
  name: string,
  args: Record<string, unknown>,
): Promise<OnboardingResponse> =>
  OnboardingResponseSchema.parse((await call(name, args)).structuredContent);

const TRAINING = {
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
} as const;
const COMPLETE = { path: "arnold_plan", training: TRAINING } as const;

async function listen(
  dataset: ReturnType<typeof planFixtureDataset> = planFixtureDataset("empty"),
) {
  runtime = createFixtureOnboarding({ dataset });
  http = createHttpApp({
    workoutRuntime: runtime,
    allowedHosts: ["127.0.0.1", "localhost"],
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  client = new Client({ name: "synthetic-onboarding-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
}

beforeEach(() => listen());
afterEach(async () => {
  await client.close();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

/** Starts a setup through MCP and returns the claim the chat would hold. */
async function startSetup() {
  const response = await write("start_arnold_onboarding", {
    request_id: rid(),
  });
  expect(response.ok).toBe(true);
  return {};
}

async function withProfile() {
  const claim = await startSetup();
  await write("update_onboarding_profile", {
    request_id: rid(),
    ...claim,
    profile: COMPLETE,
  });
  return claim;
}

async function withProposal() {
  const claim = await withProfile();
  await write("request_onboarding_plan", { request_id: rid(), ...claim });
  const brief = OnboardingBriefSchema.parse(
    (await call("get_onboarding_brief", claim)).structuredContent,
  );
  const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
  const submitted = await write("submit_onboarding_plan_proposal", {
    request_id: rid(),
    ...claim,
    name: "Push/Pull/Legs",
    origin: "ai_proposal",
    sessions: [
      {
        session_name: "Push",
        exercises: [
          { exercise_id: ids[0], target_sets: 3, rep_min: 8, rep_max: 12 },
        ],
      },
      {
        session_name: "Pull",
        exercises: [
          { exercise_id: ids[1], target_sets: 3, rep_min: 8, rep_max: 12 },
        ],
      },
      {
        session_name: "Legs",
        exercises: [
          { exercise_id: ids[2], target_sets: 3, rep_min: 6, rep_max: 10 },
        ],
      },
    ],
  });
  expect(submitted.ok, submitted.error?.message).toBe(true);
  return { claim, state: submitted.state! };
}

/* -------------------------------------------------------------- discovery */

describe("tool discovery", () => {
  it("publishes every onboarding tool", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const expected of [
      "show_arnold_onboarding",
      "start_arnold_onboarding",
      "get_onboarding_state",
      "update_onboarding_profile",
      "get_onboarding_brief",
      "request_onboarding_plan",
      "submit_onboarding_plan_proposal",
      "get_onboarding_plan",
      "confirm_onboarding_plan",
      "revise_onboarding_plan",
      "get_onboarding_handoff",
      "cancel_onboarding",
    ])
      expect(names).toContain(expected);
  });

  it("keeps the dashboard and plan tools available", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    // The existing surface must not be disturbed by the new one.
    for (const expected of [
      "show_arnold_dashboard",
      "get_arnold_dashboard",
      "get_training_plan",
      "update_plan_draft",
      "activate_training_plan",
      "get_plan_editor_context",
    ])
      expect(names).toContain(expected);
  });

  it("names the required answers per module, without ids or defaults", async () => {
    const tools = (await client.listTools()).tools;
    const text = tools
      .filter((tool) => /onboarding|arnold_setup/.test(tool.name))
      .map(
        (tool) =>
          `${tool.description ?? ""} ${JSON.stringify(tool.inputSchema)}`,
      )
      .join("\n");
    expect(text).not.toMatch(
      /onboarding_session_id|session_token|tracker_id|onb-/,
    );
    const update = tools.find(
      (t) => t.name === "update_onboarding_profile",
    )!.description!;
    expect(update).toMatch(/keine? Standardwert|nichts mit Standardwerten/);
    for (const needle of [
      "primary_goal",
      "session_minutes",
      "runs_per_week",
      "longest_run_4w_min",
      "stiff_areas",
      "has_mat",
      "weekdays",
    ])
      expect(update).toContain(needle);
  });

  it("describes when to use each tool so a model can choose", async () => {
    const tools = (await client.listTools()).tools;
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    // Discovery is a product feature: each description must say what situation
    // it is for, not just what it technically does.
    expect(byName.get("show_arnold_onboarding")!.description).toMatch(
      /einrichten|Einrichtung/i,
    );
    // New users go here first, and the app offers the two paths.
    expect(byName.get("show_arnold_onboarding")!.description).toMatch(
      /IMMER zuerst/,
    );
    expect(byName.get("show_arnold_onboarding")!.description).toMatch(
      /Eigenen Plan übernehmen/,
    );
    expect(byName.get("start_arnold_onboarding")!.description).toMatch(
      /fortgesetzt|resume_session/i,
    );
    expect(byName.get("update_onboarding_profile")!.description).toMatch(
      /zusammengeführt/i,
    );
    expect(byName.get("get_onboarding_brief")!.description).toMatch(
      /nicht erfunden/i,
    );
    expect(byName.get("submit_onboarding_plan_proposal")!.description).toMatch(
      /NICHT aktiviert/,
    );
    expect(byName.get("confirm_onboarding_plan")!.description).toMatch(
      /ausdrücklich/i,
    );
    expect(byName.get("get_onboarding_handoff")!.description).toMatch(
      /Aktiviert selbst nichts/i,
    );
    expect(byName.get("finish_arnold_setup")!.description).toMatch(
      /wiederholbar/i,
    );
    for (const tool of byName.values())
      expect(tool.description ?? "", tool.name).not.toMatch(/Google/);
  });

  it("tells every conversation that the onboarding comes first", async () => {
    expect(client.getInstructions()).toMatch(/show_arnold_onboarding/);
    expect(client.getInstructions()).toMatch(/SETUP_REQUIRED/);
    expect(client.getInstructions()).toMatch(/nur einmal/);
  });

  it("tells the chat what comes next after every step", async () => {
    const claim = await startSetup();
    const welcome = await call("get_onboarding_state", claim);
    expect(textOf(welcome)).toMatch(/zwei Buttons/);
    const own = await write("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: { path: "own_plan" },
    });
    expect(own.ok).toBe(true);
    const text = textOf(await call("get_onboarding_state", claim));
    expect(text).toMatch(/Foto/);
    expect(text).toMatch(/existing_routine/);
  });

  it("marks reads read-only and writes not", async () => {
    const tools = new Map(
      (await client.listTools()).tools.map((tool) => [tool.name, tool]),
    );
    expect(tools.get("get_onboarding_state")!.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(tools.get("get_onboarding_brief")!.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(
      tools.get("update_onboarding_profile")!.annotations?.readOnlyHint,
    ).toBe(false);
    expect(
      tools.get("confirm_onboarding_plan")!.annotations?.readOnlyHint,
    ).toBe(false);
    // Cancelling ends a setup, so it is flagged for a confirmation step.
    expect(tools.get("cancel_onboarding")!.annotations?.destructiveHint).toBe(
      true,
    );
  });

  it("publishes both app resources", async () => {
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain("ui://arnold/onboarding-v2.html");
    expect(uris).toContain("ui://arnold/onboarding-v1.html");
    expect(uris).toContain("ui://arnold/dashboard-v2.html");
    // The tools point at URIs that name the current bundle.
    const { tools } = await client.listTools();
    const opener = (
      tools.find((t) => t.name === "show_arnold_onboarding")!._meta?.ui as {
        resourceUri: string;
      }
    ).resourceUri;
    expect(opener).toMatch(
      /^ui:\/\/arnold\/onboarding-v2-([0-9a-f]{12}|dev)\.html$/,
    );
    expect(uris).toContain(opener);
  });

  it("serves the onboarding resource, also under an earlier hash", async () => {
    for (const uri of [
      "ui://arnold/onboarding-v1.html",
      // The address of a previous deploy, which ChatGPT may still hold.
      "ui://arnold/onboarding-v2-a9c0db0b4b9e.html",
    ]) {
      const resource = await client.readResource({ uri });
      const content = resource.contents[0];
      expect(content.uri).toBe(uri);
      expect(content.mimeType).toBeTruthy();
      expect("text" in content).toBe(true);
      expect(String((content as { text: string }).text).length).toBeGreaterThan(
        100,
      );
    }
  });
});

/* ------------------------------------------------- no internals in output */

/** Keys that belong to the stored setup and never to a tool output (D-11, D-20). */
const INTERNAL_KEYS = new Set([
  "onboarding_session_id",
  "session_token",
  "tracker_id",
  "token_fingerprint",
  "owner_subject",
  "setup_binding",
  "confirmation_timestamp",
  "created_at_utc",
  "updated_at_utc",
  "expires_at_utc",
  "proposed_at_utc",
  "confirmed_at_utc",
  "generated_at_utc",
]);

/**
 * Every internal key or setup id found in an output. The plan projection
 * (`plan`) keeps its own ids and timestamps until the cards are rebuilt
 * (RDS-007/009): the editor and the confirmation need them.
 */
function internals(value: unknown, path = "$"): string[] {
  if (typeof value === "string") return value.includes("onb-") ? [path] : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) => internals(item, `${path}[${index}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      key === "plan"
        ? []
        : // The profile keeps its field, always emptied in outputs.
          INTERNAL_KEYS.has(key) && !(key === "updated_at_utc" && item === null)
          ? [`${path}.${key}`]
          : internals(item, `${path}.${key}`),
    );
  return [];
}

describe("onboarding outputs", () => {
  it("carry no setup id, secret, tracker id or session timestamp", async () => {
    const outputs: Record<string, CallToolResult> = {};
    const record = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await call(name, args);
      expect(result.isError, `${name}: ${textOf(result)}`).toBeFalsy();
      outputs[`${name}#${Object.keys(outputs).length}`] = result;
      return result;
    };
    await record("show_arnold_onboarding");
    await record("start_arnold_onboarding", { request_id: rid() });
    await record("update_onboarding_profile", {
      request_id: rid(),
      profile: COMPLETE,
    });
    await record("get_onboarding_state");
    await record("request_onboarding_plan", { request_id: rid() });
    const brief = OnboardingBriefSchema.parse(
      (await record("get_onboarding_brief")).structuredContent,
    );
    const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
    const submitted = OnboardingResponseSchema.parse(
      (
        await record("submit_onboarding_plan_proposal", {
          request_id: rid(),
          name: "Push/Pull/Legs",
          origin: "ai_proposal",
          sessions: ["Push", "Pull", "Legs"].map((session_name, index) => ({
            session_name,
            exercises: [
              {
                exercise_id: ids[index],
                target_sets: 3,
                rep_min: 8,
                rep_max: 12,
              },
            ],
          })),
        })
      ).structuredContent,
    );
    const plan = submitted.state!.plan!;
    await record("get_onboarding_plan");
    await record("get_onboarding_handoff");
    await record("confirm_onboarding_plan", {
      request_id: rid(),
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    });
    await record("finish_arnold_setup", { request_id: rid() });

    for (const [name, result] of Object.entries(outputs)) {
      expect(internals(result.structuredContent), name).toEqual([]);
      const text = JSON.stringify(result.content);
      expect(text, name).not.toContain("onb-");
      expect(text, name).not.toContain("session_token");
    }
  });
});

/* ------------------------------------------------------------ opening the app */

describe("show_arnold_onboarding", () => {
  it("starts a setup and carries its contract, but no id or secret", async () => {
    const result = await call("show_arnold_onboarding");
    const view = OnboardingViewSchema.parse(result.structuredContent);
    expect(view.onboarding_contract).toBe(ONBOARDING_CONTRACT);
    expect(view.resumed).toBe(false);
    expect(view.state.session.status).toBe("COLLECTING_PROFILE");
    expect(result.structuredContent).not.toHaveProperty("session_token");
    expect(JSON.stringify(result.structuredContent)).not.toContain("onb-");
  });

  it("continues the caller's setup without any credential", async () => {
    await withProfile();
    const view = OnboardingViewSchema.parse(
      (await call("show_arnold_onboarding")).structuredContent,
    );
    expect(view.resumed).toBe(true);
    expect(view.state.session.profile.training.days_per_week).toBe(3);
  });

  it("ignores a legacy session id instead of selecting by it", async () => {
    await withProfile();
    const view = OnboardingViewSchema.parse(
      (
        await call("show_arnold_onboarding", {
          onboarding_session_id: "onb-someone-else",
          session_token: "x".repeat(43),
        })
      ).structuredContent,
    );
    // Still the caller's own setup: the identity decides, not the arguments.
    expect(view.state.session.profile.training.days_per_week).toBe(3);
  });
});

/* --------------------------------------------------------- input validation */

describe("input validation", () => {
  it("rejects an unknown goal", async () => {
    const claim = await startSetup();
    const result = await call("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: { training: { primary_goal: "bodybuilding" } },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects an out-of-range day count", async () => {
    const claim = await startSetup();
    const result = await call("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: { training: { days_per_week: 9 } },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects an unknown field", async () => {
    const claim = await startSetup();
    const result = await call("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: { medical_history: "nothing" },
    });
    // There is no health field in the contract, so the schema refuses it.
    expect(result.isError).toBe(true);
  });

  it("rejects a call with neither answers nor a step", async () => {
    const claim = await startSetup();
    const result = await call("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
    });
    expect(result.isError).toBe(true);
  });

  it("rejects a missing request id on a write", async () => {
    const claim = await startSetup();
    const result = await call("update_onboarding_profile", {
      ...claim,
      profile: { training: { days_per_week: 3 } },
    });
    expect(result.isError).toBe(true);
  });
});

/* ------------------------------------------------------- structured errors */

describe("structured failures", () => {
  it("reports a missing profile with its code", async () => {
    const claim = await startSetup();
    const result = await call("request_onboarding_plan", {
      request_id: rid(),
      ...claim,
    });
    expect(result.isError).toBe(true);
    const payload = OnboardingResponseSchema.parse(result.structuredContent);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("PROFILE_INCOMPLETE");
    expect(textOf(result)).toContain("PROFILE_INCOMPLETE");
    // The refusal still carries the state that stands.
    expect(payload.state?.session.status).toBe("COLLECTING_PROFILE");
  });

  it("reports a missing setup with its code", async () => {
    const result = await call("get_onboarding_state", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("SESSION_NOT_FOUND");
  });

  it("reports a stale confirmation with its code", async () => {
    const { claim, state } = await withProposal();
    const result = await call("confirm_onboarding_plan", {
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: state.plan!.plan_version_id,
        row_revision: state.plan!.row_revision + 3,
        confirmed: true,
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("STALE_CONFIRMATION");
  });
});

/* ---------------------------------------------------- the conversational flow */

describe("the flow a chat turn drives", () => {
  it("builds the profile across turns", async () => {
    const claim = await startSetup();
    // "Ich habe schon Trainingserfahrung und gehe viermal pro Woche ins Gym."
    const first = await write("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: {
        path: "arnold_plan",
        training: {
          experience: "intermediate",
          days_per_week: 4,
          environment: "gym",
        },
      },
    });
    expect(first.ok).toBe(true);
    expect(first.state!.progress.missing_fields).toContain(
      "training.primary_goal",
    );

    // "Ich will Muskeln aufbauen."
    const second = await write("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: { training: { primary_goal: "muscle_gain" } },
    });
    expect(second.state!.session.profile.training.days_per_week).toBe(4);
    expect(second.state!.session.profile.training.primary_goal).toBe(
      "muscle_gain",
    );

    // "Eigentlich möchte ich lieber nur dreimal die Woche trainieren."
    const third = await write("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: { training: { days_per_week: 3 } },
    });
    expect(third.state!.session.profile.training.days_per_week).toBe(3);
    expect(third.state!.session.profile.training.experience).toBe(
      "intermediate",
    );
  });

  it("answers 'show me my setup' with the stored state", async () => {
    const claim = await withProfile();
    const result = await call("get_onboarding_state", claim);
    const state = OnboardingStateSchema.parse(result.structuredContent);
    expect(state.session.profile.training.primary_goal).toBe("muscle_gain");
    expect(state.progress.profile_complete).toBe(true);
    // The summary line is readable without exposing ids or secrets.
    expect(textOf(result)).toContain("Muskeln aufbauen");
    expect(textOf(result)).not.toContain("session_token");
    expect(textOf(result)).not.toContain("onb-");
  });

  it("serves a brief that constrains the proposal", async () => {
    const claim = await withProfile();
    await write("request_onboarding_plan", { request_id: rid(), ...claim });
    const result = await call("get_onboarding_brief", claim);
    const brief = OnboardingBriefSchema.parse(result.structuredContent);
    expect(brief.availability!.days_per_week).toBe(3);
    expect(brief.exercise_catalog.length).toBeGreaterThan(0);
    expect(brief.must_not_invent.length).toBeGreaterThan(0);
    expect(textOf(result)).toContain("Randbedingungen");
  });

  it("stores a proposal as a draft and says it is not activated", async () => {
    const { state } = await withProposal();
    expect(state.session.status).toBe("REVIEWING_PLAN");
    expect(state.plan!.status).toBe("draft");
    const dataset = await runtime.store.read();
    expect(dataset.plans.filter((p) => p.status === "active")).toHaveLength(0);
  });

  it("shares one state between the chat tools and the UI tools", async () => {
    const { claim, state } = await withProposal();
    // The wizard's own read and the plan editor's context must describe the
    // same draft: one server state, two surfaces.
    const planResult = await call("get_onboarding_plan", claim);
    const plan = TrainingPlanVersionSchema.parse(
      (planResult.structuredContent as { plan: unknown }).plan,
    );
    const editorContext = (
      await call("get_plan_editor_context", {
        plan_version_id: state.plan!.plan_version_id,
      })
    ).structuredContent as { plan: { plan_version_id: string } };
    expect(plan.plan_version_id).toBe(state.plan!.plan_version_id);
    expect(editorContext.plan.plan_version_id).toBe(
      state.plan!.plan_version_id,
    );
  });

  it("carries an editor change into the onboarding state", async () => {
    const { claim, state } = await withProposal();
    const plan = state.plan!;
    // Edited through the Task 005 tool, exactly as the editor or a chat turn
    // would. There is no second plan engine to keep in sync.
    const edited = PlanWriteResponseSchema.parse(
      (
        await call("update_plan_draft", {
          request_id: rid(),
          plan_version_id: plan.plan_version_id,
          expected_row_revision: plan.row_revision,
          edits: [
            {
              type: "rename_session",
              session_id: plan.sessions[0].session_id,
              session_name: "Push schwer",
            },
          ],
        })
      ).structuredContent,
    );
    expect(edited.ok).toBe(true);

    const after = OnboardingStateSchema.parse(
      (await call("get_onboarding_state", claim)).structuredContent,
    );
    expect(after.plan!.sessions[0].session_name).toBe("Push schwer");
    expect(after.plan!.row_revision).toBeGreaterThan(plan.row_revision);
  });
});

/* -------------------------------------------------- confirmation and handoff */

describe("confirmation over MCP", () => {
  const confirmation = (plan: {
    plan_version_id: string;
    row_revision: number;
  }) => ({
    plan_version_id: plan.plan_version_id,
    row_revision: plan.row_revision,
    confirmed: true as const,
  });

  /** Confirms through the service, so the setup stops at READY_TO_FINISH. */
  async function confirmedWithoutFinish() {
    const { claim, state } = await withProposal();
    const plan = state.plan!;
    const confirmed = await runtime.onboarding.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: confirmation(plan),
    });
    expect(confirmed.state!.session.status).toBe("READY_TO_FINISH");
    return { claim, plan };
  }

  it("confirms the current revision and finishes the setup in one step", async () => {
    const { claim, state } = await withProposal();
    const plan = state.plan!;
    const result = await call("confirm_onboarding_plan", {
      request_id: rid(),
      ...claim,
      confirmation: confirmation(plan),
    });
    const payload = OnboardingResponseSchema.parse(result.structuredContent);
    expect(payload.ok, payload.error?.message).toBe(true);
    expect(payload.state!.session.status).toBe("COMPLETED");
    expect(payload.state!.handoff.status).toBe("completed");
    expect(textOf(result)).toMatch(/eingerichtet/);
    expect(textOf(result)).not.toMatch(/Google/);
    // Exactly the confirmed version is active now.
    const dataset = await runtime.store.read();
    const active = dataset.plans.filter((p) => p.status === "active");
    expect(active.map((p) => p.plan_version_id)).toEqual([
      plan.plan_version_id,
    ]);
    expect(active[0].row_revision).toBe(plan.row_revision + 1);
  });

  it("reports the handoff without a secret before the finishing step", async () => {
    const { claim, plan } = await confirmedWithoutFinish();
    const result = await call("get_onboarding_handoff", claim);
    const handoff = OnboardingHandoffSchema.parse(
      (result.structuredContent as { handoff: unknown }).handoff,
    );
    expect(handoff.status).toBe("ready_to_finish");
    expect(handoff.finish_pending).toBe(true);
    expect(handoff.confirmed_plan_version_id).toBe(plan.plan_version_id);
    expect(handoff).not.toHaveProperty("setup_binding");
    expect(JSON.stringify(handoff)).not.toContain("token");
    expect(textOf(result)).toContain("finish_arnold_setup");
    // Reading the handoff activates nothing.
    const dataset = await runtime.store.read();
    expect(dataset.plans.filter((p) => p.status === "active")).toHaveLength(0);
  });

  it("finishes an interrupted setup with finish_arnold_setup, once", async () => {
    const { claim, plan } = await confirmedWithoutFinish();
    const requestId = rid();
    const first = await write("finish_arnold_setup", {
      request_id: requestId,
      ...claim,
    });
    expect(first.ok, first.error?.message).toBe(true);
    expect(first.state!.session.status).toBe("COMPLETED");
    const again = await write("finish_arnold_setup", {
      request_id: rid(),
      ...claim,
    });
    expect(again.ok).toBe(true);
    expect(again.replayed).toBe(true);
    const active = (await runtime.store.read()).plans.filter(
      (p) => p.status === "active",
    );
    expect(active).toHaveLength(1);
    expect(active[0].plan_version_id).toBe(plan.plan_version_id);
  });

  it("invalidates the confirmation after an editor change and activates nothing", async () => {
    const { claim, plan } = await confirmedWithoutFinish();
    await call("update_plan_draft", {
      request_id: rid(),
      plan_version_id: plan.plan_version_id,
      expected_row_revision: plan.row_revision,
      edits: [
        {
          type: "rename_session",
          session_id: plan.sessions[0].session_id,
          session_name: "Push leicht",
        },
      ],
    });
    const result = await call("get_onboarding_handoff", claim);
    const handoff = OnboardingHandoffSchema.parse(
      (result.structuredContent as { handoff: unknown }).handoff,
    );
    expect(handoff.status).toBe("superseded");
    expect(textOf(result)).toContain("Noch nicht übergabebereit");
    const finish = await write("finish_arnold_setup", {
      request_id: rid(),
      ...claim,
    });
    expect(finish.ok).toBe(false);
    expect(
      (await runtime.store.read()).plans.map((p) => p.status),
    ).not.toContain("active");
  });

  it("does not activate a plan before the confirmation", async () => {
    const { claim } = await withProposal();
    const finish = await write("finish_arnold_setup", {
      request_id: rid(),
      ...claim,
    });
    expect(finish.ok).toBe(false);
    expect(finish.error?.code).toBe("CONFIRMATION_REQUIRED");
    const dataset = await runtime.store.read();
    expect(dataset.plans.filter((p) => p.status === "active")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- idempotency */

describe("no duplicate operations", () => {
  it("replays a repeated profile write", async () => {
    const claim = await startSetup();
    const requestId = rid();
    const first = await write("update_onboarding_profile", {
      request_id: requestId,
      ...claim,
      profile: { training: { days_per_week: 3 } },
    });
    const second = await write("update_onboarding_profile", {
      request_id: requestId,
      ...claim,
      profile: { training: { days_per_week: 7 } },
    });
    expect(second.replayed).toBe(true);
    expect(second.state!.session.profile.training.days_per_week).toBe(3);
    expect(second.state!.session.revision).toBe(first.state!.session.revision);
  });

  it("does not create a second draft for a repeated proposal", async () => {
    const claim = await withProfile();
    await write("request_onboarding_plan", { request_id: rid(), ...claim });
    const brief = OnboardingBriefSchema.parse(
      (await call("get_onboarding_brief", claim)).structuredContent,
    );
    const payload = {
      request_id: rid(),
      ...claim,
      name: "Ganzkörper",
      origin: "ai_proposal" as const,
      sessions: [
        {
          session_name: "Ganzkörper",
          exercises: [{ exercise_id: brief.exercise_catalog[0].exercise_id }],
        },
      ],
    };
    await write("submit_onboarding_plan_proposal", payload);
    const second = await write("submit_onboarding_plan_proposal", payload);
    expect(second.replayed).toBe(true);
    const dataset = await runtime.store.read();
    expect(dataset.plans).toHaveLength(1);
  });
});

/* -------------------------------------------------- the existing surface */

describe("the existing app keeps working", () => {
  it("still opens the dashboard with its own contract", async () => {
    const result = await call("show_arnold_dashboard");
    const view = ArnoldDashboardViewSchema.parse(result.structuredContent);
    expect(view.ui_contract).toBeTruthy();
    // An onboarding payload must never be mistaken for a dashboard payload.
    expect(
      OnboardingViewSchema.safeParse(result.structuredContent).success,
    ).toBe(false);
  });

  it("keeps the dashboard free of onboarding state", async () => {
    await withProposal();
    const view = ArnoldDashboardViewSchema.parse(
      (await call("show_arnold_dashboard")).structuredContent,
    );
    expect(JSON.stringify(view)).not.toContain("COLLECTING_PROFILE");
  });

  it("keeps the plan editor context working", async () => {
    const result = await call("get_plan_editor_context");
    expect(result.isError).toBeFalsy();
  });
});

/* ------------------------------------------------------------- cancellation */

describe("cancelling over MCP", () => {
  it("ends the setup and refuses further writes", async () => {
    const claim = await withProfile();
    const cancelled = await write("cancel_onboarding", {
      request_id: rid(),
      ...claim,
    });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state!.session.status).toBe("CANCELLED");

    const result = await call("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: { training: { days_per_week: 5 } },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("SESSION_CANCELLED");
  });

  it("allows a fresh setup afterwards", async () => {
    const claim = await withProfile();
    await write("cancel_onboarding", { request_id: rid(), ...claim });
    const restarted = await write("start_arnold_onboarding", {
      request_id: rid(),
      resume_session: claim,
    });
    expect(restarted.ok).toBe(true);
    // A new setup: the cancelled answers are not carried over.
    expect(restarted.state!.session.profile.training.days_per_week).toBeNull();
    expect(restarted.state!.session.status).toBe("COLLECTING_PROFILE");
  });
});

describe("proposal against the profile over MCP (UX-012)", () => {
  // The starter catalog, so the exercise ids are the ones the rules know.
  beforeEach(async () => {
    await client.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await listen(newTrackerDataset("trk_ux012"));
  });
  async function ready(training: Record<string, unknown>) {
    const claim = await startSetup();
    await write("update_onboarding_profile", {
      request_id: rid(),
      ...claim,
      profile: {
        path: "arnold_plan",
        training: { ...TRAINING, days_per_week: 1, ...training },
      },
    });
    await write("request_onboarding_plan", { request_id: rid(), ...claim });
    return claim;
  }
  const propose = (claim: Awaited<ReturnType<typeof ready>>, ids: string[]) =>
    write("submit_onboarding_plan_proposal", {
      request_id: rid(),
      ...claim,
      name: "Test",
      origin: "ai_proposal",
      sessions: [
        {
          session_name: "Tag",
          exercises: ids.map((exercise_id) => ({
            exercise_id,
            target_sets: 3,
            rep_min: 8,
            rep_max: 12,
          })),
        },
      ],
    });

  it("refuses an avoided exercise and saves no draft", async () => {
    const claim = await ready({ avoided_exercise_ids: ["deadlift"] });
    const refused = await propose(claim, ["squat", "deadlift"]);
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("PLAN_PROPOSAL_INVALID");
    expect(refused.error?.message).toContain("Kreuzheben");
    expect(refused.error?.details?.join(" ")).toContain(
      "PROPOSAL_AVOIDED_EXERCISE",
    );
    const state = OnboardingStateSchema.parse(
      (await call("get_onboarding_state", claim)).structuredContent,
    );
    expect(state.plan).toBeNull();

    // the same call without it goes through
    expect((await propose(claim, ["squat", "leg-press"])).ok).toBe(true);
  });

  it("stores a plan with a missing-equipment hint and shows the hint", async () => {
    const claim = await ready({
      environment: "home",
      equipment: ["dumbbells"],
    });
    const response = await propose(claim, ["leg-press"]);
    expect(response.ok, response.error?.message).toBe(true);
    const codes = response.state!.validation.warnings.map((w) => w.code);
    expect(codes).toContain("PROPOSAL_EQUIPMENT_MISSING");
    expect(response.state!.plan).not.toBeNull();
  });

  it("refuses a plan over the time budget with a German sentence (D-10)", async () => {
    const claim = await ready({ session_minutes: 30 });
    const response = await propose(claim, [
      "squat",
      "bench-press",
      "lat-pulldown",
      "leg-curl",
    ]);
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("PLAN_PROPOSAL_INVALID");
    expect(response.error?.message).toContain("geplant sind 30");
    expect(response.state?.plan ?? null).toBeNull();
  });

  it("refuses a plan that does not emphasise the focus (D-10)", async () => {
    const claim = await ready({
      session_minutes: 90,
      focus_muscle_groups: ["back"],
    });
    const response = await propose(claim, ["squat", "bench-press", "leg-curl"]);
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("PLAN_PROPOSAL_INVALID");
    expect(response.error?.message).toContain("Schwerpunkt");
  });

  it("stores a plan within the rules and passes the hints through (D-10)", async () => {
    const claim = await ready({ session_minutes: 45 });
    const fine = await propose(claim, ["squat", "bench-press", "lat-pulldown"]);
    expect(fine.ok, fine.error?.message).toBe(true);
    const warnings = fine.state!.validation.warnings;
    expect(warnings.map((w) => w.code)).not.toContain(
      "PROPOSAL_OVER_TIME_BUDGET",
    );
    // One day of three sets each is little for muscle gain: a hint, no block.
    const hints = warnings.filter((w) => w.code === "PLAN_QUALITY_HINT");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].message).toContain("Wochensätze");
  });
});
