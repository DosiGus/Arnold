/**
 * D-20 (RDS-020): what the model sees of a tool result carries no internal id
 * and no bookkeeping timestamp. Every registered tool is called with synthetic
 * fixture data; its `structuredContent` and text are searched recursively.
 *
 * Hidden (MODEL_HIDDEN_KEYS): tracker_id, user_id, schema_id, file_role,
 * metrics_version, generated_at, created_at_utc, updated_at_utc,
 * onboarding_session_id, session_token. The card gets them back from
 * `_meta.arnold.internal`.
 *
 * Allowed on purpose (ALLOWED_HANDLES below): functional handles the model
 * needs for writes and follow-up calls, and domain times.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { z } from "zod";
import { createHttpApp } from "../src/server/http";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { planFixtureDataset } from "../src/server/plan/fixture";
import { registerAccountTools } from "../src/server/account/mcp-account";
import { registerWatchTools } from "../src/server/mcp-watch";
import {
  hideInternals,
  hideModelInternals,
} from "../src/server/mcp-model-output";
import {
  MODEL_HIDDEN_KEYS,
  mergeModelOutput,
  modelVisibleSchema,
  splitModelOutput,
} from "../src/shared/model-output-contract";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";
import { PlanContextSchema } from "../src/shared/plan-contract";
import { WorkoutContextSchema } from "../src/shared/workout-contract";
import { OnboardingBriefSchema } from "../src/shared/onboarding-contract";
import { asCard } from "./fixtures/card-view";

/**
 * Keys the model keeps although they look technical: it needs them for a
 * write or a follow-up call, or they are a time of the training itself.
 */
const ALLOWED_HANDLES = [
  // handles for follow-up calls and writes
  "plan_version_id",
  "plan_family_id",
  "session_id",
  "after_session_id",
  "exercise_id",
  "plan_item_id",
  "workout_id",
  "set_id",
  "goal_id",
  "body_weight_id",
  "plan_adjustment_id",
  "request_id",
  "revision",
  "row_revision",
  // domain times and dates
  "workout_date_local",
  "started_at_utc",
  "ended_at_utc",
  "activated_at_utc",
  "retired_at_utc",
  "archived_at_utc",
  "confirmed_at_utc",
  "cancelled_at_utc",
];

const TZ = "Europe/Berlin";
const rid = () => randomUUID();

/** Paths of hidden keys in a value. */
function hiddenPaths(value: unknown, path = "$"): string[] {
  if (Array.isArray(value))
    return value.flatMap((item, i) => hiddenPaths(item, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      MODEL_HIDDEN_KEYS.has(key)
        ? [`${path}.${key}`]
        : hiddenPaths(item, `${path}.${key}`),
    );
  return [];
}

/** Hidden property names anywhere in a JSON schema. */
function hiddenSchemaKeys(schema: unknown, path = "$"): string[] {
  if (Array.isArray(schema))
    return schema.flatMap((item, i) => hiddenSchemaKeys(item, `${path}[${i}]`));
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Record<string, unknown>;
  const own = [
    ...Object.keys((node.properties as object) ?? {}),
    ...(Array.isArray(node.required) ? (node.required as string[]) : []),
  ]
    .filter((key) => MODEL_HIDDEN_KEYS.has(key))
    .map((key) => `${path}.${key}`);
  return [
    ...own,
    ...Object.entries(node).flatMap(([key, item]) =>
      hiddenSchemaKeys(item, `${path}/${key}`),
    ),
  ];
}

const textOf = (result: CallToolResult) =>
  result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");

async function connect(runtime: ReturnType<typeof createFixtureOnboarding>) {
  const http = createHttpApp({
    workoutRuntime: runtime,
    allowedHosts: ["127.0.0.1", "localhost"],
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  const client = new Client({ name: "model-visible-output", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
  return { http, client };
}

async function disconnect(link?: { http: Server; client: Client }) {
  if (!link) return;
  await link.client.close();
  await new Promise<void>((resolve) => {
    link.http.close(() => resolve());
    link.http.closeAllConnections();
  });
}

/* --------------------------------------------------------------- recorder */

type Outcome = { tool: string; result: CallToolResult };
const outcomes: Outcome[] = [];
let tracker: { http: Server; client: Client };
let setup: { http: Server; client: Client };
let trackerId = "";

async function callOn(
  client: Client,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const result = (await client
    .callTool({ name: tool, arguments: args })
    .catch((error: Error) => ({
      isError: true,
      content: [{ type: "text", text: error.message }],
    }))) as CallToolResult;
  outcomes.push({ tool, result });
  return result;
}
const call = (tool: string, args: Record<string, unknown> = {}) =>
  callOn(tracker.client, tool, args);
const onboard = (tool: string, args: Record<string, unknown> = {}) =>
  callOn(setup.client, tool, args);
/** The card's view of a result, for chaining ids into the next call. */
const card = (result: CallToolResult) =>
  (asCard(result).structuredContent ?? {}) as Record<string, any>;

beforeAll(async () => {
  const dataset = planFixtureDataset("active_ppl");
  trackerId = dataset.config.tracker_id;
  const runtime = createFixtureOnboarding({ dataset });
  tracker = await connect(runtime);
  setup = await connect(createFixtureOnboarding());
  await runTrackerScenario();
  await runOnboardingScenario();
});
afterAll(async () => {
  await disconnect(tracker);
  await disconnect(setup);
});

/* -------------------------------------------------------------- scenarios */

async function runTrackerScenario() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
    new Date(),
  );

  // dashboard
  const dash = card(await call("get_arnold_dashboard", { timezone: TZ }));
  await call("show_arnold_dashboard", { timezone: TZ });
  await call("get_arnold_workouts", {});
  const exerciseId =
    dash.exercises?.[0]?.exercise_id ??
    dash.plan?.sessions?.[0]?.exercises?.[0]?.exercise_id;
  await call("get_arnold_exercise_progress", { exercise_id: exerciseId });
  await call("get_health_data", { timezone: TZ });

  // plans
  const planCtx = card(await call("get_plan_editor_context", {}));
  const active = planCtx.plan;
  const activeId: string = active.plan_version_id;
  await call("get_training_plan", {});
  await call("list_training_plans", {});
  await call("get_plan_history", {});
  await call("validate_training_plan", { plan_version_id: activeId });
  const draft = card(
    await call("create_plan_version", {
      request_id: rid(),
      source_plan_version_id: activeId,
    }),
  ).result?.plan?.version;
  await call("compare_plan_versions", {
    from_plan_version_id: activeId,
    to_plan_version_id: draft.plan_version_id,
  });
  const renamed =
    card(
      await call("update_plan_draft", {
        request_id: rid(),
        plan_version_id: draft.plan_version_id,
        expected_row_revision: draft.row_revision,
        edits: [{ type: "update_plan_metadata", name: "PPL neu" }],
      }),
    ).result?.plan?.version ?? draft;
  await call("archive_plan_draft", {
    request_id: rid(),
    plan_version_id: renamed.plan_version_id,
    expected_row_revision: renamed.row_revision,
  });
  const clone = card(
    await call("clone_plan_version", {
      request_id: rid(),
      source_plan_version_id: activeId,
    }),
  ).result?.plan?.version;
  await call("activate_training_plan", {
    request_id: rid(),
    plan_version_id: clone.plan_version_id,
    expected_row_revision: clone.row_revision,
    confirmation: {
      plan_version_id: clone.plan_version_id,
      row_revision: clone.row_revision,
      confirmed: true,
    },
  });
  const firstSession = active.sessions[0];
  await call("create_training_plan", {
    request_id: rid(),
    name: "Ganzkörper",
    sessions: [
      {
        session_name: "Ganzkörper A",
        exercises: [
          {
            exercise_id: firstSession.exercises[0].exercise_id,
            target_sets: 3,
            rep_min: 8,
            rep_max: 12,
          },
        ],
      },
    ],
  });

  // plan adjustments
  const adjustment = card(
    await call("create_plan_adjustment", {
      request_id: rid(),
      timezone: TZ,
      kind: "today",
      minutes_per_session: 20,
    }),
  ).result?.plan_adjustment?.adjustment;
  await call("get_plan_adjustments", {});
  if (adjustment) {
    const confirmed = card(
      await call("confirm_plan_adjustment", {
        request_id: rid(),
        plan_adjustment_id: adjustment.plan_adjustment_id,
        expected_row_revision: adjustment.row_revision,
      }),
    ).result?.plan_adjustment?.adjustment;
    await call("cancel_plan_adjustment", {
      request_id: rid(),
      plan_adjustment_id: adjustment.plan_adjustment_id,
      expected_row_revision: (confirmed ?? adjustment).row_revision,
    });
  } else {
    await call("confirm_plan_adjustment", {
      request_id: rid(),
      plan_adjustment_id: "missing",
      expected_row_revision: 1,
    });
    await call("cancel_plan_adjustment", {
      request_id: rid(),
      plan_adjustment_id: "missing",
      expected_row_revision: 1,
    });
  }

  // workouts
  await call("get_workout", {});
  const started = card(
    await call("start_workout", {
      request_id: rid(),
      workout_date_local: today,
      timezone: TZ,
      session_name: "Freies Training",
    }),
  ).result?.workout;
  const exercise = firstSession.exercises[0].exercise_id;
  const logged = card(
    await call("log_workout_sets", {
      request_id: rid(),
      workout_id: started.workout_id,
      sets: [
        {
          exercise_id: exercise,
          set_type: "working",
          reps: 8,
          reps_basis: "total",
          load_kg: 60,
          load_basis: "total",
          implement_count: 1,
          execution_mode: "bilateral_simultaneous",
          side: "both",
        },
        {
          exercise_id: exercise,
          set_type: "working",
          reps: 8,
          reps_basis: "total",
          load_kg: 60,
          load_basis: "total",
          implement_count: 1,
          execution_mode: "bilateral_simultaneous",
          side: "both",
        },
      ],
    }),
  ).result;
  await call("get_workout", { workout_id: started.workout_id });
  const set = logged?.sets?.[0] ?? { set_id: "missing", row_revision: 1 };
  const updated =
    card(
      await call("update_set", {
        request_id: rid(),
        set_id: set.set_id,
        expected_row_revision: set.row_revision,
        changes: { reps: 9 },
      }),
    ).result?.sets?.[0] ?? set;
  await call("void_set", {
    request_id: rid(),
    set_id: updated.set_id,
    expected_row_revision: updated.row_revision,
  });
  const current =
    card(await call("get_workout", { workout_id: started.workout_id }))
      .workout ?? {};
  const completed = card(
    await call("complete_workout", {
      request_id: rid(),
      workout_id: started.workout_id,
      expected_row_revision: current.row_revision,
    }),
  ).result?.workout;
  await call("mark_recap_seen", { workout_id: started.workout_id });
  await call("void_workout", {
    request_id: rid(),
    workout_id: started.workout_id,
    expected_row_revision: (completed ?? current).row_revision,
    correction_reason: "Test",
  });
  const second = card(
    await call("start_workout", {
      request_id: rid(),
      workout_date_local: today,
      timezone: TZ,
      session_name: "Zweites Training",
    }),
  ).result?.workout;
  await call("cancel_workout", {
    request_id: rid(),
    workout_id: second.workout_id,
    expected_row_revision: second.row_revision,
  });
  await call("log_workout", {
    request_id: rid(),
    workout_date_local: today,
    timezone: TZ,
    session_name: "Nachgetragen",
    exercises: [{ exercise_id: exercise, sets: [{ reps: 10, load_kg: 50 }] }],
    confirm_duplicate: true,
  });
  await call("create_exercise", {
    request_id: rid(),
    name_de: "Testübung",
    family_key: "test_family",
    variant_key: "test_variant",
    equipment: "dumbbell",
    primary_muscle: "chest",
    default_load_basis: "per_implement",
    default_execution_mode: "bilateral_simultaneous",
    default_implement_count: 2,
  });
  const goal = card(
    await call("create_training_goal", {
      request_id: rid(),
      kind: "body_weight",
      target_value: 75,
    }),
  ).result?.goal ?? { goal_id: "missing", row_revision: 1 };
  const goalNext =
    card(
      await call("update_training_goal", {
        request_id: rid(),
        goal_id: goal.goal_id,
        expected_row_revision: goal.row_revision,
        target_value: 74,
      }),
    ).result?.goal ?? goal;
  await call("archive_training_goal", {
    request_id: rid(),
    goal_id: goalNext.goal_id,
    expected_row_revision: goalNext.row_revision,
  });
  const weight = card(
    await call("log_body_weight", {
      request_id: rid(),
      measured_on: today,
      timezone: TZ,
      weight_kg: 80,
    }),
  ).result?.body_weight ?? { body_weight_id: "missing", row_revision: 1 };
  await call("void_body_weight", {
    request_id: rid(),
    body_weight_id: weight.body_weight_id,
    expected_row_revision: weight.row_revision,
  });

  // running
  await call("get_run_profile", { timezone: TZ });
  await call("update_run_profile", {
    request_id: rid(),
    goal: "fitness",
    runs_per_week: 2,
    running_experience_months: 12,
  });
  await call("get_run_week", { timezone: TZ });
  await call("schedule_run_week", { timezone: TZ });
  const planned = card(
    await call("plan_run", {
      request_id: rid(),
      timezone: TZ,
      run_type: "base",
      environment: "outdoor",
      minutes: 30,
      confirm_duplicate: true,
    }),
  ).result?.run ?? { workout_id: "missing", row_revision: 1 };
  const moved =
    card(
      await call("update_planned_run", {
        request_id: rid(),
        workout_id: planned.workout_id,
        expected_row_revision: planned.row_revision,
        run_type: "base",
        minutes: 35,
      }),
    ).result?.run ?? planned;
  await call("cancel_planned_run", {
    request_id: rid(),
    workout_id: moved.workout_id,
    expected_row_revision: moved.row_revision,
  });
  const run = card(
    await call("log_run", {
      request_id: rid(),
      timezone: TZ,
      workout_date_local: today,
      timer_s: 1800,
      distance_m: 5000,
      environment: "outdoor",
      confirm_duplicate: true,
    }),
  ).result?.run ?? { workout_id: "missing" };
  await call("rate_run", {
    request_id: rid(),
    workout_id: run.workout_id,
    rpe: 5,
  });
  await call("get_run_analysis", {
    view: "run",
    workout_id: run.workout_id,
    timezone: TZ,
  });
  await call("get_run_analysis", { view: "week", timezone: TZ });
  await call("show_arnold_run", { card: "run_week" });

  // mobility
  await call("get_mobility_overview", { timezone: TZ });
  await call("update_mobility_profile", {
    request_id: rid(),
    preference: {
      wants: true,
      morning: { weekdays: ["mon", "tue", "wed", "thu", "fri"], minutes: 10 },
      sessions: null,
      stiff_areas: [],
    },
    has_mat: false,
  });
  await call("log_mobility", {
    request_id: rid(),
    kind: "morning",
    timezone: TZ,
  });
  await call("show_arnold_mobility", { card: "mobility_today" });
}

async function runOnboardingScenario() {
  await onboard("show_arnold_onboarding");
  await onboard("start_arnold_onboarding", { request_id: rid() });
  await onboard("cancel_onboarding", { request_id: rid() });
  await onboard("start_arnold_onboarding", { request_id: rid() });
  await onboard("update_onboarding_profile", {
    request_id: rid(),
    profile: {
      path: "arnold_plan",
      training: {
        primary_goal: "muscle_gain",
        experience: "intermediate",
        days_per_week: 3,
        session_minutes: 60,
        environment: "gym",
      },
    },
  });
  await onboard("get_onboarding_state");
  await onboard("get_plan_card");
  await onboard("request_onboarding_plan", { request_id: rid() });
  const brief = OnboardingBriefSchema.parse(
    card(await onboard("get_onboarding_brief")),
  );
  const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
  const submitted = card(
    await onboard("submit_onboarding_plan_proposal", {
      request_id: rid(),
      name: "Push/Pull/Legs",
      origin: "ai_proposal",
      sessions: ["Push", "Pull", "Legs"].map((session_name, index) => ({
        session_name,
        exercises: [
          { exercise_id: ids[index], target_sets: 3, rep_min: 8, rep_max: 12 },
        ],
      })),
    }),
  );
  const plan = submitted.state.plan;
  await onboard("get_onboarding_plan");
  await onboard("get_onboarding_handoff");
  await onboard("revise_onboarding_plan", {
    request_id: rid(),
    reason: "Andere Übungen",
  });
  await onboard("confirm_onboarding_plan", {
    request_id: rid(),
    confirmation: {
      plan_version_id: plan.plan_version_id,
      row_revision: plan.row_revision,
      confirmed: true,
    },
  });
  await onboard("finish_arnold_setup", { request_id: rid() });
}

/* ------------------------------------------------------------------ tests */

describe("model-visible tool output (D-20)", () => {
  it("calls every registered tool at least once", async () => {
    const listed = new Set(
      [
        ...(await tracker.client.listTools()).tools,
        ...(await setup.client.listTools()).tools,
      ].map((tool) => tool.name),
    );
    const called = new Set(outcomes.map((o) => o.tool));
    expect([...listed].filter((name) => !called.has(name))).toEqual([]);
  });

  it("succeeds for the reading and writing paths the cards use", () => {
    const failed = (tool: string) =>
      outcomes
        .filter((o) => o.tool === tool && o.result.isError)
        .map((o) => `${tool}: ${textOf(o.result)}`);
    expect(
      [
        "get_arnold_dashboard",
        "show_arnold_dashboard",
        "get_arnold_workouts",
        "get_arnold_exercise_progress",
        "get_health_data",
        "get_plan_editor_context",
        "get_training_plan",
        "list_training_plans",
        "get_plan_history",
        "validate_training_plan",
        "compare_plan_versions",
        "create_plan_version",
        "clone_plan_version",
        "create_training_plan",
        "get_workout",
        "start_workout",
        "log_workout_sets",
        "complete_workout",
        "log_body_weight",
        "create_training_goal",
        "get_plan_adjustments",
        "show_arnold_onboarding",
        "start_arnold_onboarding",
        "update_onboarding_profile",
        "get_onboarding_state",
        "get_plan_card",
        "submit_onboarding_plan_proposal",
        "get_onboarding_plan",
      ].flatMap(failed),
    ).toEqual([]);
  });

  it("carries no hidden key in any structuredContent", () => {
    const leaks = outcomes.flatMap(({ tool, result }) =>
      hiddenPaths(result.structuredContent).map((path) => `${tool} ${path}`),
    );
    expect(leaks).toEqual([]);
  });

  it("names no hidden key and no tracker id in any text", () => {
    expect(trackerId).not.toBe("");
    const leaks = outcomes.flatMap(({ tool, result }) => {
      const text = textOf(result);
      return [
        ...[...MODEL_HIDDEN_KEYS].filter((key) => text.includes(key)),
        ...(text.includes(trackerId) ? [trackerId] : []),
        ...(JSON.stringify(result.structuredContent ?? null).includes(trackerId)
          ? ["tracker id value in structuredContent"]
          : []),
      ].map((leak) => `${tool}: ${leak}`);
    });
    expect(leaks).toEqual([]);
  });

  it("keeps the functional handles the model needs for follow-up calls", () => {
    const plan = outcomes.find((o) => o.tool === "get_plan_editor_context")!;
    const visible = JSON.stringify(plan.result.structuredContent);
    for (const key of ["plan_version_id", "session_id", "row_revision"])
      expect(visible, key).toContain(`"${key}"`);
    const start = outcomes.find((o) => o.tool === "start_workout")!;
    const workout = (start.result.structuredContent as Record<string, any>)
      .result.workout;
    expect(workout).toHaveProperty("workout_id");
    expect(workout).toHaveProperty("row_revision");
    expect(workout).toHaveProperty("workout_date_local");
    expect(workout).toHaveProperty("started_at_utc");
    expect(ALLOWED_HANDLES.filter((key) => MODEL_HIDDEN_KEYS.has(key))).toEqual(
      [],
    );
  });

  it("hands the card the hidden values, so the full contract parses again", () => {
    const parse = <S extends z.ZodType>(
      tool: string,
      schema: S,
    ): z.output<S> => {
      const outcome = outcomes.find(
        (o) => o.tool === tool && !o.result.isError,
      )!;
      expect(schema.safeParse(outcome.result.structuredContent).success).toBe(
        false,
      );
      return schema.parse(asCard(outcome.result).structuredContent);
    };
    const dashboard = parse("get_arnold_dashboard", ArnoldDashboardViewSchema);
    expect(dashboard.source.tracker_id).toBe(trackerId);
    expect(parse("get_plan_editor_context", PlanContextSchema).tracker_id).toBe(
      trackerId,
    );
    expect(parse("get_workout", WorkoutContextSchema).tracker_id).toBe(
      trackerId,
    );
  });
});

describe("advertised output schemas (D-20)", () => {
  it("name no hidden key, in every profile tool", async () => {
    const tools = [
      ...(await tracker.client.listTools()).tools,
      ...(await setup.client.listTools()).tools,
    ];
    const leaks = tools.flatMap((tool) =>
      hiddenSchemaKeys(tool.outputSchema).map((path) => `${tool.name} ${path}`),
    );
    expect(leaks).toEqual([]);
  });

  it("name no hidden key in the account and watch tools of the database profile", async () => {
    // Registration only; the handlers would need a database.
    const server = hideModelInternals(
      new McpServer({ name: "t", version: "1" }),
    );
    const runtime = {} as Parameters<typeof registerAccountTools>[1];
    registerAccountTools(server, runtime, "ui://arnold/test.html");
    registerWatchTools(server, runtime, "ui://arnold/test.html");
    const registered = (
      server as unknown as {
        _registeredTools: Record<string, { outputSchema?: z.ZodType }>;
      }
    )._registeredTools;
    const names = Object.keys(registered);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_arnold_stored_data",
        "delete_arnold_account",
        "pair_garmin_watch",
        "list_garmin_watches",
      ]),
    );
    const leaks = names.flatMap((name) => {
      const schema = registered[name].outputSchema;
      return schema
        ? hiddenSchemaKeys(z.toJSONSchema(schema, { io: "output" })).map(
            (path) => `${name} ${path}`,
          )
        : [];
    });
    expect(leaks).toEqual([]);
  });
});

describe("split and merge (D-20)", () => {
  const full = {
    tracker_id: "t-1",
    plan: {
      plan_version_id: "p-1",
      row_revision: 3,
      created_at_utc: "2026-11-01T10:00:00Z",
      sessions: [
        { session_id: "s-1", updated_at_utc: "2026-11-02T10:00:00Z" },
        { session_id: "s-2" },
      ],
    },
    profile: { updated_at_utc: null, days: 3 },
  };

  it("takes every hidden key out and puts it back unchanged", () => {
    const { visible, internal } = splitModelOutput(full);
    expect(hiddenPaths(visible)).toEqual([]);
    expect(visible.plan.sessions[1]).toEqual({ session_id: "s-2" });
    expect(mergeModelOutput(visible, internal)).toEqual(full);
    // Merging twice changes nothing (the card may see a result twice).
    expect(
      mergeModelOutput(mergeModelOutput(visible, internal), internal),
    ).toEqual(full);
  });

  it("leaves a result without hidden keys untouched", () => {
    const clean = { structuredContent: { workout_id: "w-1" } };
    expect(hideInternals(clean)).toBe(clean);
    const schema = z.strictObject({ workout_id: z.string() });
    expect(modelVisibleSchema(schema)).toBe(schema);
  });

  it("shrinks a strict schema so the visible part validates", () => {
    const schema = z.strictObject({
      tracker_id: z.string(),
      items: z.array(
        z.strictObject({ id: z.string(), created_at_utc: z.string() }),
      ),
    });
    const value = {
      tracker_id: "t",
      items: [{ id: "a", created_at_utc: "2026-11-01T00:00:00Z" }],
    };
    const { visible } = splitModelOutput(value);
    expect(schema.safeParse(visible).success).toBe(false);
    expect(modelVisibleSchema(schema).parse(visible)).toEqual(visible);
  });
});
