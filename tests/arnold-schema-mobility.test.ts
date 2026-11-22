/**
 * MOB-001: the raw data schema 1.2.0 (mobility). Cross-checks of the dataset
 * (session_id spaces, results, workouts), the row rules, and that every older
 * dataset stays valid.
 */
import { describe, expect, it } from "vitest";
import {
  ARNOLD_SCHEMA_VERSION,
  ARNOLD_TABLES,
  ARNOLD_TABLE_HEADERS,
  ArnoldDatasetSchema,
  ArnoldMobilityProfileSchema,
  ArnoldMobilityResultSchema,
  ArnoldPlanMobilitySessionSchema,
  isMobilityWorkout,
  isRunWorkout,
  isStrengthWorkout,
  strengthTrainingView,
  type ArnoldDataset,
} from "../src/shared/arnold-schema-v1";
import { fullDataset } from "./fixtures/arnold-dashboard";

const STAMP = "2026-11-01T06:00:00Z";
const technical = {
  created_at_utc: STAMP,
  updated_at_utc: STAMP,
  row_revision: 1,
};
const PLAN = "pv-test-2";
const STRENGTH = "sess-upper-a";

const template = {
  catalog_version: "mob-1",
  rules_version: "mob-timing-1",
  exercise_ids: ["mob_neck_rolls", "mob_shoulder_circles"],
  items: [
    {
      exercise_id: "mob_neck_rolls",
      sides: 1,
      seconds_per_side: 45,
      reps: null,
    },
    {
      exercise_id: "mob_shoulder_circles",
      sides: 1,
      seconds_per_side: 45,
      reps: null,
    },
  ],
  total_s: 95,
};

const mobilitySession = (over: Record<string, unknown> = {}) => ({
  plan_mobility_session_id: "pms-1",
  plan_version_id: PLAN,
  session_id: "sess-mob-morning",
  session_name: "Morgenroutine",
  session_order: 10,
  kind: "morning",
  placement: "own_day",
  weekdays: [1, 3, 5],
  after_session_id: null,
  minutes: 10,
  template,
  status: "active",
  row_revision: 1,
  ...over,
});

const mobilityWorkout = (id: string, over: Record<string, unknown> = {}) => ({
  workout_id: id,
  workout_date_local: "2026-11-02",
  timezone: "Europe/Berlin",
  started_at_utc: "2026-11-02T06:30:00Z",
  ended_at_utc: "2026-11-02T06:40:00Z",
  plan_version_id: null,
  session_id: null,
  session_name_snapshot: "Morgenroutine",
  status: "completed",
  source: "chat",
  notes: null,
  activity_type: "mobility",
  ...technical,
  ...over,
});

const mobilityResult = (id: string, over: Record<string, unknown> = {}) => ({
  workout_id: id,
  activity_type: "mobility",
  kind: "morning",
  plan_version_id: null,
  session_id: null,
  minutes_planned: 10,
  timer_s: 540,
  elapsed_s: 600,
  exercises_total: 2,
  exercises_done: 2,
  exercises_skipped: 0,
  ended_early: false,
  items: [
    { c: "mob_neck_rolls", st: "done", t: 45 },
    { c: "mob_shoulder_circles", st: "done", t: 45 },
  ],
  result_source: "watch",
  catalog_version: "mob-1",
  rules_version: "mob-timing-1",
  ...technical,
  ...over,
});

const profile = (over: Record<string, unknown> = {}) => ({
  mobility_profile_id: "mp-1",
  wants: true,
  morning_weekdays: [1, 2, 3],
  morning_minutes: 10,
  sessions_placement: "own_days",
  sessions_per_week: 2,
  sessions_minutes: 20,
  stiff_areas: ["hips", "upper_back"],
  ...technical,
  ...over,
});

const base = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(fullDataset()));

/** The base dataset plus mobility rows; `over` replaces whole arrays. */
const withMobility = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...base(),
  mobilityProfiles: [profile()],
  planMobilitySessions: [mobilitySession()],
  workouts: [
    ...(base().workouts as unknown[]),
    mobilityWorkout("w-mob-1", {
      plan_version_id: PLAN,
      session_id: "sess-mob-morning",
    }),
    mobilityWorkout("w-mob-2", { workout_date_local: "2026-11-03" }),
  ],
  mobilityResults: [
    mobilityResult("w-mob-1", {
      plan_version_id: PLAN,
      session_id: "sess-mob-morning",
    }),
    mobilityResult("w-mob-2", { kind: "session", minutes_planned: null }),
  ],
  ...over,
});

const parse = (data: unknown) => ArnoldDatasetSchema.safeParse(data);
const messages = (data: unknown) => {
  const r = parse(data);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};
const rejects = (data: unknown, fragment: string) => {
  const found = messages(data);
  expect(
    found.some((m) => m.includes(fragment)),
    `expected "${fragment}" in ${JSON.stringify(found)}`,
  ).toBe(true);
};
const workouts = (data: Record<string, unknown>) =>
  data.workouts as Record<string, unknown>[];

describe("schema 1.2.0", () => {
  it("is version 1.2.0 with the three mobility tables", () => {
    expect(ARNOLD_SCHEMA_VERSION).toBe("1.2.0");
    for (const t of [
      "MOBILITY_PROFILES",
      "PLAN_MOBILITY_SESSIONS",
      "MOBILITY_RESULTS",
    ] as const)
      expect(ARNOLD_TABLES).toContain(t);
  });

  it("lists exactly the columns of each row schema", () => {
    const keys = (schema: { shape: Record<string, unknown> }) =>
      Object.keys(schema.shape);
    const rowShape = (schema: unknown) => {
      // The row schemas are readonly wrappers around the strict object.
      let s = schema as {
        shape?: Record<string, unknown>;
        def?: { innerType?: unknown };
      };
      while (!s.shape && s.def?.innerType) s = s.def.innerType as typeof s;
      return s as { shape: Record<string, unknown> };
    };
    expect([...ARNOLD_TABLE_HEADERS.MOBILITY_RESULTS].sort()).toEqual(
      keys(rowShape(ArnoldMobilityResultSchema)).sort(),
    );
    expect([...ARNOLD_TABLE_HEADERS.PLAN_MOBILITY_SESSIONS].sort()).toEqual(
      keys(rowShape(ArnoldPlanMobilitySessionSchema)).sort(),
    );
    expect([...ARNOLD_TABLE_HEADERS.MOBILITY_PROFILES].sort()).toEqual(
      keys(rowShape(ArnoldMobilityProfileSchema)).sort(),
    );
  });

  it("lists ended_early as a column of the results", () => {
    expect(ARNOLD_TABLE_HEADERS.MOBILITY_RESULTS).toContain("ended_early");
  });

  it.each(["1.0.0", "1.1.0", "1.2.0"] as const)(
    "accepts a %s dataset without any mobility array",
    (version) => {
      const data = base();
      (data.config as Record<string, unknown>).schema_version = version;
      for (const entry of data.configEntries as Record<string, unknown>[])
        if (entry.key === "schema_version") entry.value = version;
      const r = parse(data);
      expect(r.success, JSON.stringify(!r.success && r.error.issues)).toBe(
        true,
      );
      if (r.success) {
        expect(r.data.mobilityProfiles).toBeUndefined();
        expect(r.data.planMobilitySessions).toBeUndefined();
        expect(r.data.mobilityResults).toBeUndefined();
      }
    },
  );

  it("accepts a full mobility dataset", () => {
    const r = parse(withMobility());
    expect(r.success, JSON.stringify(!r.success && r.error.issues)).toBe(true);
  });

  it("accepts empty mobility arrays", () => {
    expect(
      parse({
        ...base(),
        mobilityProfiles: [],
        planMobilitySessions: [],
        mobilityResults: [],
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown schema version", () => {
    const data = base();
    (data.config as Record<string, unknown>).schema_version = "1.3.0";
    expect(parse(data).success).toBe(false);
  });
});

describe("session_id space of a plan version", () => {
  it("rejects a mobility session that reuses a strength session_id", () => {
    rejects(
      withMobility({
        planMobilitySessions: [mobilitySession({ session_id: STRENGTH })],
        workouts: base().workouts,
        mobilityResults: [],
      }),
      "Session-ID innerhalb der Planversion doppelt",
    );
  });

  it("rejects a mobility session that reuses a run session_id", () => {
    const run = {
      plan_run_session_id: "prs-1",
      plan_version_id: PLAN,
      session_id: "sess-run-base",
      session_order: 9,
      session_name: "Grundlage",
      run_type: "base",
      template: { level: 0, minutes: [30, 60] },
      preferred_weekday: 3,
      status: "active",
      row_revision: 1,
    };
    const ok = withMobility({
      planRunSessions: [run],
      planMobilitySessions: [mobilitySession()],
    });
    expect(parse(ok).success).toBe(true);
    rejects(
      withMobility({
        planRunSessions: [run],
        planMobilitySessions: [
          mobilitySession({ session_id: "sess-run-base" }),
        ],
      }),
      "Session-ID innerhalb der Planversion doppelt",
    );
  });

  it("rejects the same session_id twice among mobility sessions", () => {
    rejects(
      withMobility({
        planMobilitySessions: [
          mobilitySession(),
          mobilitySession({ plan_mobility_session_id: "pms-2" }),
        ],
      }),
      "Session-ID innerhalb der Planversion doppelt",
    );
  });

  it("allows the same session_id in another plan version", () => {
    const sessions = [
      mobilitySession(),
      mobilitySession({
        plan_mobility_session_id: "pms-2",
        plan_version_id: "pv-test-1",
      }),
    ];
    expect(
      parse(withMobility({ planMobilitySessions: sessions })).success,
    ).toBe(true);
  });

  it("rejects a duplicate plan_mobility_session_id and an unknown plan version", () => {
    rejects(
      withMobility({
        planMobilitySessions: [
          mobilitySession(),
          mobilitySession({ session_id: "sess-mob-2" }),
        ],
      }),
      "Doppelte ID",
    );
    rejects(
      withMobility({
        planMobilitySessions: [mobilitySession({ plan_version_id: "pv-none" })],
        workouts: base().workouts,
        mobilityResults: [],
      }),
      "Referenz auf PLANS fehlt",
    );
  });
});

describe("after_session_id", () => {
  const after = (over: Record<string, unknown> = {}) =>
    mobilitySession({
      kind: "session",
      minutes: 20,
      placement: "after_strength",
      weekdays: [],
      after_session_id: STRENGTH,
      ...over,
    });

  it("must be a strength session of the same plan version", () => {
    const ok = withMobility({
      planMobilitySessions: [after()],
      workouts: base().workouts,
      mobilityResults: [],
    });
    expect(parse(ok).success).toBe(true);
    for (const anchor of ["sess-none", "sess-mob-morning"])
      rejects(
        withMobility({
          planMobilitySessions: [after({ after_session_id: anchor })],
          workouts: base().workouts,
          mobilityResults: [],
        }),
        "Krafteinheit",
      );
  });

  it("does not take a strength session of another plan version", () => {
    // sess-lower-b exists only in pv-test-2; the anchor is looked up in pv-test-1.
    rejects(
      withMobility({
        planMobilitySessions: [
          after({
            plan_version_id: "pv-test-1",
            after_session_id: "sess-lower-b",
          }),
        ],
        workouts: base().workouts,
        mobilityResults: [],
      }),
      "Krafteinheit",
    );
  });
});

describe("mobility workouts and results", () => {
  it("needs a result for every mobility workout", () => {
    rejects(
      withMobility({
        mobilityResults: [
          mobilityResult("w-mob-1", {
            plan_version_id: PLAN,
            session_id: "sess-mob-morning",
          }),
        ],
      }),
      "fehlt MOBILITY_RESULTS",
    );
    rejects(withMobility({ mobilityResults: [] }), "fehlt MOBILITY_RESULTS");
    rejects(
      { ...withMobility(), mobilityResults: undefined },
      "fehlt MOBILITY_RESULTS",
    );
  });

  it("rejects a result without a mobility workout", () => {
    rejects(
      withMobility({
        mobilityResults: [
          ...(withMobility().mobilityResults as unknown[]),
          mobilityResult("w-nowhere"),
        ],
      }),
      "Referenz auf ein Training der Art mobility fehlt",
    );
    // A strength workout is no home for a mobility result.
    rejects(
      withMobility({
        mobilityResults: [
          ...(withMobility().mobilityResults as unknown[]),
          mobilityResult("w-test-1"),
        ],
      }),
      "Referenz auf ein Training der Art mobility fehlt",
    );
  });

  it("allows one result per workout", () => {
    rejects(
      withMobility({
        mobilityResults: [
          ...(withMobility().mobilityResults as unknown[]),
          mobilityResult("w-mob-2", { kind: "session", minutes_planned: null }),
        ],
      }),
      "Doppelte ID",
    );
  });

  it("is never planned or in progress", () => {
    for (const status of ["planned", "in_progress"])
      rejects(
        withMobility({
          workouts: [
            ...(base().workouts as unknown[]),
            mobilityWorkout("w-mob-1", {
              status,
              plan_version_id: PLAN,
              session_id: "sess-mob-morning",
              started_at_utc: null,
              ended_at_utc: null,
            }),
            mobilityWorkout("w-mob-2", { workout_date_local: "2026-11-03" }),
          ],
        }),
        "nie planned oder in_progress",
      );
    for (const status of ["completed", "cancelled", "voided"])
      expect(
        parse(
          withMobility({
            workouts: [
              ...(base().workouts as unknown[]),
              mobilityWorkout("w-mob-1", {
                status,
                plan_version_id: PLAN,
                session_id: "sess-mob-morning",
              }),
              mobilityWorkout("w-mob-2", { workout_date_local: "2026-11-03" }),
            ],
          }),
        ).success,
        status,
      ).toBe(true);
  });

  it("must refer to a mobility session, not to a strength session", () => {
    rejects(
      withMobility({
        workouts: [
          ...(base().workouts as unknown[]),
          mobilityWorkout("w-mob-1", {
            plan_version_id: PLAN,
            session_id: STRENGTH,
          }),
          mobilityWorkout("w-mob-2", { workout_date_local: "2026-11-03" }),
        ],
        mobilityResults: [
          mobilityResult("w-mob-1", {
            plan_version_id: PLAN,
            session_id: STRENGTH,
          }),
          mobilityResult("w-mob-2", { kind: "session", minutes_planned: null }),
        ],
      }),
      "Session existiert nicht in der referenzierten Planversion",
    );
  });

  it("keeps a strength or run workout away from a mobility session", () => {
    const data = withMobility();
    const strength = workouts(data).find((w) => w.workout_id === "w-test-1")!;
    strength.plan_version_id = PLAN;
    strength.session_id = "sess-mob-morning";
    rejects(data, "Session existiert nicht in der referenzierten Planversion");
  });

  it("result must mirror the plan reference of its workout", () => {
    rejects(
      withMobility({
        mobilityResults: [
          mobilityResult("w-mob-1"), // workout is planned, result says free
          mobilityResult("w-mob-2", { kind: "session", minutes_planned: null }),
        ],
      }),
      "Planversion und Session passen nicht zum Training",
    );
    rejects(
      withMobility({
        mobilityResults: [
          mobilityResult("w-mob-1", {
            plan_version_id: PLAN,
            session_id: "sess-mob-morning",
          }),
          mobilityResult("w-mob-2", {
            kind: "session",
            minutes_planned: null,
            plan_version_id: PLAN,
            session_id: "sess-mob-morning",
          }),
        ],
      }),
      "Planversion und Session passen nicht zum Training",
    );
  });

  it("has no sets", () => {
    const data = withMobility();
    const set = {
      ...(data.sets as Record<string, unknown>[])[0]!,
      set_id: "s-mob",
      workout_id: "w-mob-2",
    };
    (data.sets as unknown[]).push(set);
    rejects(data, "Eine Mobility-Routine hat keine Sätze");
  });

  it("is not subject to the run checks", () => {
    // No RUNS row, no run segments, yet valid; the run rule only applies to runs.
    const data = withMobility();
    expect(parse(data).success).toBe(true);
    expect((data.runs as unknown[] | undefined) ?? []).toHaveLength(0);
    // And a run without RUNS still fails: the run rules are unchanged.
    const bad = base();
    workouts(bad).push({
      ...mobilityWorkout("w-run-x", { plan_version_id: null }),
      activity_type: "run",
    });
    rejects(bad, "Zum Lauf fehlt RUNS");
  });

  it("classifies workouts exactly once", () => {
    const kinds = [undefined, "strength", "run", "mobility"] as const;
    for (const activity_type of kinds) {
      const w = { activity_type };
      const flags = [
        isStrengthWorkout(w),
        isRunWorkout(w),
        isMobilityWorkout(w),
      ].filter(Boolean);
      expect(flags, String(activity_type)).toHaveLength(1);
    }
    expect(isStrengthWorkout({})).toBe(true);
  });
});

describe("result rows", () => {
  const ok = (v: unknown) => ArnoldMobilityResultSchema.safeParse(v).success;
  const row = (over: Record<string, unknown> = {}) =>
    mobilityResult("w-1", over);

  it("accepts a finished routine", () => {
    expect(ok(row())).toBe(true);
  });

  it("ended_early is required and a boolean", () => {
    const { ended_early: _drop, ...without } = row();
    expect(ok(without)).toBe(false);
    expect(ok(row({ ended_early: "no" }))).toBe(false);
    expect(ok(row({ ended_early: null }))).toBe(false);
  });

  it("not ended early: done + skipped must equal the total", () => {
    expect(ok(row({ exercises_done: 1, exercises_skipped: 1 }))).toBe(true);
    expect(ok(row({ exercises_done: 1, exercises_skipped: 0 }))).toBe(false);
    expect(ok(row({ exercises_done: 0, exercises_skipped: 0 }))).toBe(false);
  });

  it("ended early: the sum may fall short of the total, never exceed it", () => {
    const early = { ended_early: true };
    expect(ok(row({ ...early, exercises_done: 1, exercises_skipped: 0 }))).toBe(
      true,
    );
    expect(ok(row({ ...early, exercises_done: 0, exercises_skipped: 0 }))).toBe(
      true,
    );
    expect(ok(row({ ...early, exercises_done: 2, exercises_skipped: 0 }))).toBe(
      true,
    );
    expect(ok(row({ ...early, exercises_done: 2, exercises_skipped: 1 }))).toBe(
      false,
    );
  });

  it("never lets done + skipped exceed the total", () => {
    expect(ok(row({ exercises_done: 2, exercises_skipped: 1 }))).toBe(false);
  });

  it("plan_version_id and session_id only together", () => {
    expect(ok(row({ plan_version_id: PLAN }))).toBe(false);
    expect(ok(row({ session_id: "s" }))).toBe(false);
    expect(ok(row({ plan_version_id: PLAN, session_id: "s" }))).toBe(true);
  });

  it("keeps unknown durations unknown (null), not 0", () => {
    expect(
      ok(
        row({
          timer_s: null,
          elapsed_s: null,
          minutes_planned: null,
          result_source: "chat",
        }),
      ),
    ).toBe(true);
    expect(ok(row({ timer_s: 700 }))).toBe(false); // longer than elapsed_s 600
  });

  it("carries no heart rate and nothing unknown", () => {
    for (const field of ["hr_avg_bpm", "hr_max_bpm", "hr_status", "rpe"])
      expect(ok(row({ [field]: 1 })), field).toBe(false);
    expect(ARNOLD_TABLE_HEADERS.MOBILITY_RESULTS.join(",")).not.toMatch(
      /hr_|pulse/,
    );
  });

  it("limits the entries to 20 and the seconds to 3 hours", () => {
    const item = { c: "mob_neck_rolls", st: "done", t: 10 };
    expect(
      ok(
        row({
          items: Array(20).fill(item),
          exercises_total: 20,
          exercises_done: 20,
        }),
      ),
    ).toBe(true);
    expect(ok(row({ items: Array(21).fill(item) }))).toBe(false);
    expect(ok(row({ elapsed_s: 10_801 }))).toBe(false);
    expect(ok(row({ updated_at_utc: "2026-10-01T06:00:00Z" }))).toBe(false);
  });
});

describe("profile and session rows", () => {
  it("keeps the profile fields together", () => {
    const ok = (v: unknown) => ArnoldMobilityProfileSchema.safeParse(v).success;
    expect(ok(profile())).toBe(true);
    expect(
      ok(
        profile({
          wants: false,
          morning_weekdays: null,
          morning_minutes: null,
          sessions_placement: null,
          sessions_per_week: null,
          sessions_minutes: null,
          stiff_areas: [],
        }),
      ),
    ).toBe(true);
    expect(ok(profile({ morning_minutes: null }))).toBe(false);
    expect(ok(profile({ sessions_per_week: null }))).toBe(false);
    expect(ok(profile({ wants: false }))).toBe(false);
    expect(
      ok(
        profile({
          morning_weekdays: null,
          morning_minutes: null,
          sessions_placement: null,
          sessions_per_week: null,
          sessions_minutes: null,
        }),
      ),
    ).toBe(false);
    expect(ok(profile({ morning_weekdays: [1, 1] }))).toBe(false);
    expect(ok(profile({ stiff_areas: ["hips", "hips"] }))).toBe(false);
  });

  it("allows at most one profile", () => {
    rejects(
      withMobility({
        mobilityProfiles: [profile(), profile({ mobility_profile_id: "mp-2" })],
      }),
      "Höchstens ein Mobility-Profil",
    );
  });

  it("applies the shape rules of a mobility session", () => {
    const ok = (v: unknown) =>
      ArnoldPlanMobilitySessionSchema.safeParse(v).success;
    expect(ok(mobilitySession())).toBe(true);
    expect(ok(mobilitySession({ minutes: 20 }))).toBe(false);
    expect(ok(mobilitySession({ kind: "session", minutes: 20 }))).toBe(false); // 3 weekdays
    expect(
      ok(mobilitySession({ kind: "session", minutes: 20, weekdays: [2] })),
    ).toBe(true);
    expect(
      ok(
        mobilitySession({
          kind: "session",
          minutes: 20,
          placement: "after_strength",
          weekdays: [],
          after_session_id: null,
        }),
      ),
    ).toBe(false);
  });
});

describe("strengthTrainingView", () => {
  it("drops mobility rows and leaves every strength figure alone", () => {
    const plain = ArnoldDatasetSchema.parse(base());
    const mixed = ArnoldDatasetSchema.parse(withMobility());
    const view = strengthTrainingView(mixed);
    expect(view.workouts.some(isMobilityWorkout)).toBe(false);
    // Left out, not emptied: the view equals the plain strength dataset.
    expect(view.mobilityProfiles).toBeUndefined();
    expect(view.planMobilitySessions).toBeUndefined();
    expect(view.mobilityResults).toBeUndefined();
    expect(view).toEqual(strengthTrainingView(plain));
    expect(view.workouts).toEqual(strengthTrainingView(plain).workouts);
    expect(view.sets).toEqual(plain.sets);
  });

  it("returns a dataset without other kinds unchanged", () => {
    const plain: ArnoldDataset = ArnoldDatasetSchema.parse(base());
    expect(strengthTrainingView(plain)).toBe(plain);
  });
});
