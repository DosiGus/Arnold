/**
 * RUN-008 over real Streamable HTTP: the run week tools, the run session
 * operations of the plan draft and the interference hints. Synthetic data only.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import {
  createFixturePlanning,
  planFixtureDataset,
} from "../src/server/plan/fixture";
import {
  changedDataset,
  WriteError,
} from "../src/server/workout/infrastructure";
import {
  PlanValidationResultSchema,
  PlanWriteResponseSchema,
  type PlanWriteResponse,
} from "../src/shared/plan-contract";
import {
  RunWeekResponseSchema,
  RunWriteResponseSchema,
  ScheduleRunWeekResponseSchema,
} from "../src/shared/run-contract";
import { exercise, set, workout } from "./fixtures/arnold-analytics";

type Runtime = ReturnType<typeof createFixturePlanning>;
const tz = "Europe/Berlin";
const dayOf = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString("sv", {
    timeZone: tz,
  });
const weekdayOf = (date: string) =>
  ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const today = dayOf(0);

/** Six working sets of legs (and a warm-up) on `date`: a heavy leg day. */
function withLegDay(date: string) {
  const base = planFixtureDataset("active_ppl");
  return {
    ...base,
    exercises: [
      ...base.exercises,
      exercise({ exercise_id: "ex-squat", primary_muscle: "legs" }),
    ],
    workouts: [
      ...base.workouts,
      workout({ workout_id: "w-leg", workout_date_local: date }),
    ],
    sets: [
      ...base.sets,
      ...Array.from({ length: 7 }, (_, i) =>
        set({
          set_id: `s-leg-${i}`,
          workout_id: "w-leg",
          exercise_id: "ex-squat",
          set_number: i + 1,
          set_type: i === 0 ? "warmup" : "working",
        }),
      ),
    ],
  } as never;
}

let clients: Client[] = [];
let servers: Server[] = [];
async function start(dataset = planFixtureDataset("active_ppl")) {
  const runtime = createFixturePlanning(dataset);
  const http = createHttpApp({
    workoutRuntime: runtime,
    allowedHosts: ["127.0.0.1", "localhost"],
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const client = new Client({ name: "synthetic-run-week-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
  clients.push(client);
  servers.push(http);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { runtime, client, call };
}
afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
          s.closeAllConnections();
        }),
    ),
  );
  clients = [];
  servers = [];
});

type Call = Awaited<ReturnType<typeof start>>["call"];
const planWrite = async (
  call: Call,
  name: string,
  args: Record<string, unknown>,
): Promise<PlanWriteResponse> => {
  const result = await call(name, args);
  if (!result.structuredContent)
    throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  return PlanWriteResponseSchema.parse(result.structuredContent);
};
const week = async (call: Call, args: Record<string, unknown>) =>
  ScheduleRunWeekResponseSchema.parse(
    (await call("schedule_run_week", { timezone: tz, ...args }))
      .structuredContent,
  );
const validate = async (call: Call, plan_version_id: string) =>
  PlanValidationResultSchema.parse(
    (await call("validate_training_plan", { plan_version_id, timezone: tz }))
      .structuredContent,
  );

const SESSIONS = [
  {
    type: "add_run_session",
    session_name: "Grundlage",
    run_type: "base",
    preferred_weekday: 2,
  },
  {
    type: "add_run_session",
    session_name: "Tempo",
    run_type: "tempo",
    preferred_weekday: 4,
  },
  {
    type: "add_run_session",
    session_name: "Langer Lauf",
    run_type: "long",
    preferred_weekday: 6,
  },
];

/** Profile, then a draft of the active plan with the given run sessions, optionally activated. */
async function setup(call: Call, edits: object[] = SESSIONS, activate = true) {
  const profile = RunWriteResponseSchema.parse(
    (
      await call("update_run_profile", {
        request_id: "rw-profile",
        goal: "10k",
        running_experience_months: 30,
        runs_per_week: 3,
        base_minutes_per_week: 180,
      })
    ).structuredContent,
  );
  expect(profile.ok).toBe(true);
  const created = await planWrite(call, "create_plan_version", {
    request_id: "rw-cv",
    source_plan_version_id: "pfx-v2",
  });
  const draft = created.result!.plan!.version;
  const updated = await planWrite(call, "update_plan_draft", {
    request_id: "rw-edit",
    plan_version_id: draft.plan_version_id,
    expected_row_revision: draft.row_revision,
    edits,
  });
  expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
  const version = updated.result!.plan!.version;
  if (activate) {
    const done = await planWrite(call, "activate_training_plan", {
      request_id: "rw-activate",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: {
        confirmed: true,
        plan_version_id: version.plan_version_id,
        row_revision: version.row_revision,
      },
    });
    expect(done.ok, JSON.stringify(done.error)).toBe(true);
  }
  return { updated, version };
}

describe("run week tools", () => {
  it("lists get_run_week and schedule_run_week", async () => {
    const { client } = await start();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_run_week");
    expect(names).toContain("schedule_run_week");
  });

  it("preview changes nothing; a missing plan or profile fails closed", async () => {
    const { call, runtime } = await start();
    const bare = await week(call, {});
    expect(bare.ok).toBe(false);
    expect(bare.error?.code).toBe("VALIDATION_ERROR");
    await setup(call);
    const before = JSON.stringify(await runtime.store.read());
    const preview = await week(call, {});
    expect(preview.ok).toBe(true);
    expect(preview.mode).toBe("preview");
    expect(preview.result!.preview_hash.length).toBeGreaterThan(0);
    expect(preview.result!.days.flatMap((d) => d.runs).length).toBeGreaterThan(
      0,
    );
    expect(JSON.stringify(await runtime.store.read())).toBe(before);
  });

  it("confirmation writes exactly once: replay, other content, stale hash", async () => {
    const { call, runtime } = await start();
    await setup(call);
    const preview = await week(call, {});
    const hash = preview.result!.preview_hash;
    const planned = () =>
      runtime.store
        .read()
        .then((d) =>
          d.workouts.filter(
            (w) => w.activity_type === "run" && w.status === "planned",
          ),
        );

    const stale = await week(call, {
      confirm: true,
      request_id: "rw-c0",
      preview_hash: "stale-hash",
    });
    expect(stale.error?.code).toBe("CONFIRMATION_REQUIRED");
    expect(await planned()).toHaveLength(0);

    const first = await week(call, {
      confirm: true,
      request_id: "rw-c1",
      preview_hash: hash,
    });
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    expect(first.mode).toBe("confirmed");
    const count = (await planned()).length;
    expect(count).toBeGreaterThan(0);
    // The planned workouts carry the plan and the session of the run session.
    const rows = await planned();
    expect(
      rows.every((w) => w.session_id !== null && w.plan_version_id !== null),
    ).toBe(true);

    const again = await week(call, {
      confirm: true,
      request_id: "rw-c1",
      preview_hash: hash,
    });
    expect(again.replayed).toBe(true);
    expect(again.ok).toBe(true);
    expect(await planned()).toHaveLength(count);

    const other = await week(call, {
      confirm: true,
      request_id: "rw-c1",
      preview_hash: hash,
      focus: "strength",
    });
    expect(other.error?.code).toBe("DUPLICATE_OPERATION");
    expect(await planned()).toHaveLength(count);
  });

  it("writes the level back and shows the week", async () => {
    const { call, runtime } = await start();
    // A session set far above what the profile allows is brought down to the
    // ceiling by the planner; that level is what gets stored.
    await setup(call, [
      {
        type: "add_run_session",
        session_name: "Grundlage",
        run_type: "base",
        preferred_weekday: 2,
        template: { level: 100 },
      },
      ...SESSIONS.slice(1),
    ]);
    const preview = await week(call, {});
    const result = preview.result!;
    expect(result.levels.length).toBeGreaterThan(0);
    expect(result.levels[0].to).toBeLessThan(result.levels[0].from);
    const done = await week(call, {
      confirm: true,
      request_id: "rw-l1",
      preview_hash: result.preview_hash,
    });
    expect(done.ok, JSON.stringify(done.error)).toBe(true);
    const data = await runtime.store.read();
    for (const level of result.levels)
      expect(
        data.planRunSessions.find((s) => s.session_id === level.session_id)!
          .template.level,
      ).toBe(level.to);
    // The calendar week that holds the scheduled runs: on a Sunday the next
    // seven days lie almost entirely in the following week.
    const runDay = result.days.find((d) => d.runs.length > 0)!.date;
    const view = RunWeekResponseSchema.parse(
      (await call("get_run_week", { timezone: tz, date: runDay }))
        .structuredContent,
    );
    expect(view.sessions).toHaveLength(3);
    expect(view.summary.runs_planned).toBeGreaterThan(0);
    for (const s of view.sessions) {
      const stored = data.planRunSessions.find(
        (r) => r.session_id === s.session_id,
      )!;
      expect(s.level).toBe(stored.template.level);
    }
  });
});

describe("plan draft with run sessions", () => {
  it("adds, changes and removes run sessions, validates and activates as before", async () => {
    const { call } = await start();
    const { updated, version } = await setup(call, SESSIONS, false);
    expect(version.run_sessions).toHaveLength(3);
    expect(updated.result!.validation!.valid).toBe(true);
    expect(
      updated.result!.changes.some((c) => c.kind === "session_added"),
    ).toBe(true);
    const tempo = version.run_sessions!.find((s) => s.run_type === "tempo")!;
    const next = await planWrite(call, "update_plan_draft", {
      request_id: "rw-edit2",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "update_run_session",
          session_id: tempo.session_id,
          session_name: "Tempodauerlauf",
          preferred_weekday: 3,
        },
        {
          type: "remove_run_session",
          session_id: version.run_sessions![0].session_id,
        },
      ],
    });
    expect(next.ok, JSON.stringify(next.error)).toBe(true);
    expect(next.result!.plan!.version.run_sessions).toHaveLength(2);
    expect(next.result!.changes.map((c) => c.kind)).toEqual(
      expect.arrayContaining(["session_removed", "session_renamed"]),
    );
    const v2 = next.result!.plan!.version;
    const check = await validate(call, v2.plan_version_id);
    expect(check.valid && check.activatable).toBe(true);
    const done = await planWrite(call, "activate_training_plan", {
      request_id: "rw-act2",
      plan_version_id: v2.plan_version_id,
      expected_row_revision: v2.row_revision,
      confirmation: {
        confirmed: true,
        plan_version_id: v2.plan_version_id,
        row_revision: v2.row_revision,
      },
    });
    expect(done.ok).toBe(true);
    // A name of a strength session is taken for a run session as well.
    const clash = await planWrite(call, "create_plan_version", {
      request_id: "rw-cv3",
      source_plan_version_id: v2.plan_version_id,
    });
    const d3 = clash.result!.plan!.version;
    expect(d3.run_sessions).toHaveLength(2);
    const dup = await planWrite(call, "update_plan_draft", {
      request_id: "rw-dup",
      plan_version_id: d3.plan_version_id,
      expected_row_revision: d3.row_revision,
      edits: [
        {
          type: "add_run_session",
          session_name: "Tempodauerlauf",
          run_type: "base",
        },
      ],
    });
    expect(dup.ok).toBe(false);
  });

  it("week rule hints: too many hard runs, close together; never blocking", async () => {
    const { call } = await start();
    const { version } = await setup(
      call,
      [
        {
          type: "add_run_session",
          session_name: "Tempo",
          run_type: "tempo",
          preferred_weekday: 2,
        },
        {
          type: "add_run_session",
          session_name: "Intervalle",
          run_type: "intervals",
          preferred_weekday: 3,
        },
        {
          type: "add_run_session",
          session_name: "Hügel",
          run_type: "hills",
          preferred_weekday: 5,
        },
      ],
      false,
    );
    const check = await validate(call, version.plan_version_id);
    expect(check.valid).toBe(true);
    expect(check.activatable).toBe(true);
    const rules = check.warnings.filter((w) => w.code === "RUN_WEEK_RULE");
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(rules.some((w) => w.message.includes("48 Stunden"))).toBe(true);
  });

  it("a plan with run sessions but no run profile gets a recommendation", async () => {
    const { call } = await start();
    const created = await planWrite(call, "create_plan_version", {
      request_id: "rw-np",
      source_plan_version_id: "pfx-v2",
    });
    const draft = created.result!.plan!.version;
    const updated = await planWrite(call, "update_plan_draft", {
      request_id: "rw-np2",
      plan_version_id: draft.plan_version_id,
      expected_row_revision: draft.row_revision,
      edits: SESSIONS,
    });
    const codes = updated.result!.validation!.recommendations.map(
      (r) => r.code,
    );
    expect(codes).toContain("RUN_PROFILE_MISSING");
    expect(updated.result!.validation!.valid).toBe(true);
  });
});

describe("interference with strength", () => {
  it("validation: hard run on the usual leg day and the day after", async () => {
    const { call } = await start(withLegDay(today));
    const { version } = await setup(
      call,
      [
        {
          type: "add_run_session",
          session_name: "Tempo",
          run_type: "tempo",
          preferred_weekday: weekdayOf(today),
        },
        {
          type: "add_run_session",
          session_name: "Intervalle",
          run_type: "intervals",
          preferred_weekday: weekdayOf(dayOf(1)),
        },
        {
          type: "add_run_session",
          session_name: "Locker",
          run_type: "base",
          preferred_weekday: weekdayOf(dayOf(3)),
        },
      ],
      false,
    );
    const check = await validate(call, version.plan_version_id);
    expect(check.activatable).toBe(true);
    const texts = check.recommendations
      .filter((r) => r.code === "RUN_INTERFERENCE")
      .map((r) => r.message);
    expect(
      texts.some((t) => t.includes('"Tempo"') && t.includes("Beintraining")),
    ).toBe(true);
    expect(
      texts.some(
        (t) => t.includes('"Intervalle"') && t.includes("schweren Beintag"),
      ),
    ).toBe(true);
    expect(texts.some((t) => t.includes('"Locker"'))).toBe(false);
  });

  it("plan_run warns about a hard run on a leg day and the day after; an easy run elsewhere does not", async () => {
    const { call } = await start(withLegDay(today));
    const plan = async (id: string, date: string, run_type: string) =>
      RunWriteResponseSchema.parse(
        (
          await call("plan_run", {
            request_id: id,
            timezone: tz,
            workout_date_local: date,
            run_type,
            minutes: 40,
          })
        ).structuredContent,
      );
    const same = await plan("rw-p1", today, "tempo");
    expect(same.ok, JSON.stringify(same.error)).toBe(true);
    expect(
      same.result!.warnings.some((w) =>
        w.includes("Beintraining am selben Tag"),
      ),
    ).toBe(true);
    const after = await plan("rw-p2", dayOf(1), "intervals");
    expect(
      after.result!.warnings.some((w) => w.includes("schwerer Beintag")),
    ).toBe(true);
    const calm = await plan("rw-p3", dayOf(4), "base");
    expect(
      calm.result!.warnings.some((w) => /Beintag|Beintraining/.test(w)),
    ).toBe(false);
  });
});

describe("separation and plan protection", () => {
  it("another user sees nothing of the week", async () => {
    const a = await start();
    await setup(a.call);
    await week(a.call, {}).then((p) =>
      week(a.call, {
        confirm: true,
        request_id: "rw-a1",
        preview_hash: p.result!.preview_hash,
      }),
    );
    const b = await start(planFixtureDataset("active_ppl"));
    const view = RunWeekResponseSchema.parse(
      (await b.call("get_run_week", { timezone: tz })).structuredContent,
    );
    expect(view.sessions).toHaveLength(0);
    expect(view.days.flatMap((d) => d.runs)).toHaveLength(0);
    const preview = await week(b.call, {});
    expect(preview.ok).toBe(false);
    expect(preview.result).toBeNull();
  });

  it("an active version only lets the level of a run session change", async () => {
    const { call, runtime } = await start();
    await setup(call);
    const data = await runtime.store.read();
    const active = data.plans.find((p) => p.status === "active")!;
    const before = data.planRunSessions.find(
      (s) =>
        s.plan_version_id === active.plan_version_id && s.run_type === "tempo",
    )!;
    const level = {
      ...before,
      template: { ...before.template, level: before.template.level + 1 },
      row_revision: before.row_revision + 1,
    };
    expect(() =>
      changedDataset(data, [
        { table: "planRunSessions", before, after: level },
      ]),
    ).not.toThrow();
    for (const after of [
      { ...level, session_name: "Umbenannt" },
      { ...level, run_type: "base" as const },
      { ...level, preferred_weekday: 7 },
      {
        ...level,
        template: { ...level.template, minutes: [10, 20] as [number, number] },
      },
    ])
      expect(() =>
        changedDataset(data, [{ table: "planRunSessions", before, after }]),
      ).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(WriteError).toBeDefined();
  });
});
