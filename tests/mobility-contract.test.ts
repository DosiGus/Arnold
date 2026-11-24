/**
 * MOB-001: the mobility contracts. Strict shapes, old data still parses, the
 * plan operations, the watch payloads and their wire budgets.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import {
  MOBILITY_AREAS,
  MOBILITY_CATALOG,
} from "../src/shared/mobility-catalog.js";
import {
  MOBILITY_DEFAULTS,
  MOBILITY_WATCH_BUDGET_BYTES,
  LogMobilityResponseSchema,
  MobilityAdherenceViewSchema,
  MobilityCardViewSchema,
  MobilityOverviewSchema,
  MobilityPreferenceSchema,
  MobilityProfileViewSchema,
  MobilityTemplateSchema,
  MobilityToolInputs,
  ShowMobilityCardInputSchema,
  UpdateMobilityProfileResponseSchema,
  WatchMobilityRequestSchema,
  WatchMobilityResponseSchema,
  WatchMobilityRoutineSchema,
  WatchMobilityTodaySchema,
} from "../src/shared/mobility-contract.js";
import {
  OnboardingBriefSchema,
  OnboardingProfilePatchSchema,
  OnboardingStateSchema,
  OpenQuestionSchema,
  TrainingPatchSchema,
  TrainingSchema,
} from "../src/shared/onboarding-contract.js";
import {
  PLAN_VALIDATION_CODES,
  PlanEditSchema,
  PlanMobilitySessionSchema,
  TrainingPlanVersionSchema,
} from "../src/shared/plan-contract.js";
import {
  WatchPlanAckRequestSchema,
  WatchPlanAckResponseSchema,
} from "../src/shared/watch-contract.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/watch/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const uuid = "00000000-0000-4000-8000-000000000001";
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
const AT = "2026-11-23T07:00:00Z";

/** A valid template of two exercises (the seconds are the engine's; here fixed). */
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

const wanted = {
  wants: true,
  morning: { weekdays: ["mon", "tue", "wed", "thu", "fri"], minutes: 10 },
  sessions: { placement: "own_days", per_week: 2, minutes: 20 },
  stiff_areas: ["hips", "upper_back"],
};

describe("preferences", () => {
  it("accepts yes with details and a plain no", () => {
    expect(MobilityPreferenceSchema.safeParse(wanted).success).toBe(true);
    expect(MobilityPreferenceSchema.safeParse({ wants: false }).success).toBe(
      true,
    );
  });

  it("uses areas that exist in the catalog for the stiff areas", () => {
    for (const area of wanted.stiff_areas)
      expect(MOBILITY_AREAS).toContain(area);
  });

  it("is strict: unknown fields are rejected everywhere", () => {
    const cases: unknown[] = [
      { ...wanted, extra: 1 },
      { wants: false, morning: null },
      { ...wanted, morning: { ...wanted.morning, extra: true } },
      { ...wanted, sessions: { ...wanted.sessions, extra: true } },
    ];
    for (const c of cases)
      expect(MobilityPreferenceSchema.safeParse(c).success).toBe(false);
  });

  it("needs a morning routine or sessions when the answer is yes", () => {
    expect(
      MobilityPreferenceSchema.safeParse({
        wants: true,
        morning: null,
        sessions: null,
        stiff_areas: [],
      }).success,
    ).toBe(false);
  });

  it("allows only the offered minutes, weekdays once and 1-3 sessions", () => {
    const bad = [
      { ...wanted, morning: { weekdays: [1], minutes: 10 } },
      { ...wanted, morning: { weekdays: ["monday"], minutes: 10 } },
      { ...wanted, morning: { weekdays: ["mon"], minutes: 7 } },
      { ...wanted, morning: { weekdays: ["mon", "mon"], minutes: 10 } },
      { ...wanted, morning: { weekdays: [], minutes: 10 } },
      { ...wanted, sessions: { ...wanted.sessions, minutes: 10 } },
      { ...wanted, sessions: { ...wanted.sessions, per_week: 4 } },
      { ...wanted, sessions: { ...wanted.sessions, per_week: 0 } },
      { ...wanted, sessions: { ...wanted.sessions, placement: "anywhere" } },
      { ...wanted, stiff_areas: ["hips", "hips"] },
      { ...wanted, stiff_areas: ["elbows"] },
    ];
    for (const c of bad)
      expect(
        MobilityPreferenceSchema.safeParse(c).success,
        JSON.stringify(c),
      ).toBe(false);
  });

  it("keeps the defaults inside what the contract accepts", () => {
    expect(
      MobilityPreferenceSchema.safeParse({
        wants: true,
        morning: {
          weekdays: [...MOBILITY_DEFAULTS.morning.weekdays],
          minutes: MOBILITY_DEFAULTS.morning.minutes,
        },
        sessions: {
          placement: "arnold_decides",
          ...MOBILITY_DEFAULTS.sessions,
        },
        stiff_areas: [],
      }).success,
    ).toBe(true);
  });

  it("ties the profile state to the preference", () => {
    const ok = (v: unknown) => MobilityProfileViewSchema.safeParse(v).success;
    expect(ok({ state: "not_asked", preference: null })).toBe(true);
    expect(ok({ state: "no", preference: { wants: false } })).toBe(true);
    expect(ok({ state: "yes", preference: wanted })).toBe(true);
    expect(ok({ state: "yes", preference: { wants: false } })).toBe(false);
    expect(ok({ state: "not_asked", preference: wanted })).toBe(false);
    expect(ok({ state: "no", preference: null })).toBe(false);
  });
});

describe("old data still parses (additions only)", () => {
  const training = {
    primary_goal: null,
    experience: null,
    days_per_week: null,
    session_minutes: null,
    environment: null,
  };

  it("parses a training answer without mobility; mobility is optional", () => {
    const parsed = TrainingSchema.parse(training);
    expect(parsed.mobility).toBeUndefined();
    expect(
      TrainingSchema.safeParse({ ...training, mobility: wanted }).success,
    ).toBe(true);
    expect(
      TrainingSchema.safeParse({ ...training, mobility: { wants: "maybe" } })
        .success,
    ).toBe(false);
  });

  it("lets a patch set and clear the mobility answer, and stays strict", () => {
    expect(TrainingPatchSchema.safeParse({ mobility: wanted }).success).toBe(
      true,
    );
    expect(TrainingPatchSchema.safeParse({ mobility: null }).success).toBe(
      true,
    );
    expect(TrainingPatchSchema.safeParse({ mobility: { x: 1 } }).success).toBe(
      false,
    );
    expect(
      OnboardingProfilePatchSchema.safeParse({
        training: { mobility: { wants: false } },
      }).success,
    ).toBe(true);
  });

  it("gives an old onboarding state without open_questions an empty list", async () => {
    const service = createFixtureOnboarding().onboarding;
    const started = await service.startOnboarding({ request_id: randomUUID() });
    const claim = {};
    const state = await service.getOnboardingState(claim);
    const { open_questions: _drop, ...old } = JSON.parse(JSON.stringify(state));
    expect(OnboardingStateSchema.parse(old).open_questions).toEqual([]);
    expect(OnboardingStateSchema.parse(state).open_questions).toBeInstanceOf(
      Array,
    );
  });

  it("accepts an open question and rejects an unknown id or extra field", () => {
    const q = {
      id: "mobility",
      kind: "ask_once",
      ask: "Magst du Mobility in deine Woche aufnehmen?",
      fields: ["training.mobility"],
    };
    expect(OpenQuestionSchema.safeParse(q).success).toBe(true);
    expect(
      OpenQuestionSchema.safeParse({ ...q, id: "shoe_size" }).success,
    ).toBe(false);
    expect(OpenQuestionSchema.safeParse({ ...q, extra: 1 }).success).toBe(
      false,
    );
    expect(OpenQuestionSchema.safeParse({ ...q, ask: "" }).success).toBe(false);
  });

  it("keeps the new brief fields optional", () => {
    const { mobility, mobility_catalog } = OnboardingBriefSchema.shape;
    expect(mobility.safeParse(undefined).success).toBe(true);
    expect(mobility_catalog.safeParse(undefined).success).toBe(true);
    expect(mobility.safeParse({ wants: false }).success).toBe(false);
    expect(mobility.safeParse(wanted).success).toBe(true);
    const entry = MOBILITY_CATALOG[0]!;
    expect(
      mobility_catalog.safeParse([
        {
          id: entry.id,
          name_de: entry.name_de,
          areas: entry.areas,
          mode: entry.mode,
          per_side: entry.per_side,
          position: entry.position,
          needs_mat: entry.needs_mat,
          default_s: entry.default_s,
          min_s: entry.min_s,
          max_s: entry.max_s,
        },
      ]).success,
    ).toBe(true);
  });

  it("parses a plan version without mobility_sessions", () => {
    const shape = TrainingPlanVersionSchema.shape.mobility_sessions;
    expect(shape.safeParse(undefined).success).toBe(true);
    expect(shape.safeParse([]).success).toBe(true);
  });

  it("only appends plan validation codes (existing order is untouched)", () => {
    const codes = PLAN_VALIDATION_CODES as readonly string[];
    const at = codes.indexOf("MOBILITY_STIFF_AREA_UNCOVERED");
    expect(at).toBeGreaterThan(0);
    expect(codes.slice(at)).toEqual([
      "MOBILITY_STIFF_AREA_UNCOVERED",
      "MOBILITY_PROTECTED_AREA",
      "MOBILITY_PROFILE_MISSING",
    ]);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("template", () => {
  it("accepts matching ids and items", () => {
    expect(MobilityTemplateSchema.safeParse(template).success).toBe(true);
  });

  it("rejects duplicates, a mismatch of ids and items, and unknown ids", () => {
    const dup = {
      ...template,
      exercise_ids: ["mob_neck_rolls", "mob_neck_rolls"],
    };
    expect(MobilityTemplateSchema.safeParse(dup).success).toBe(false);
    expect(
      MobilityTemplateSchema.safeParse({
        ...template,
        exercise_ids: [...template.exercise_ids].reverse(),
      }).success,
    ).toBe(false);
    expect(
      MobilityTemplateSchema.safeParse({
        ...template,
        exercise_ids: ["mob_neck_rolls"],
      }).success,
    ).toBe(false);
    expect(
      MobilityTemplateSchema.safeParse({
        ...template,
        exercise_ids: ["mob_neck_rolls", "mob_levitation"],
        items: [
          template.items[0],
          { ...template.items[1], exercise_id: "mob_levitation" },
        ],
      }).success,
    ).toBe(false);
  });

  it("allows at most 15 exercises and needs at least one", () => {
    const ids = MOBILITY_CATALOG.slice(0, 16).map((e) => e.id);
    const items = ids.map((exercise_id) => ({
      exercise_id,
      sides: 1,
      seconds_per_side: 30,
      reps: null,
    }));
    expect(
      MobilityTemplateSchema.safeParse({
        ...template,
        exercise_ids: ids,
        items,
      }).success,
    ).toBe(false);
    expect(
      MobilityTemplateSchema.safeParse({
        ...template,
        exercise_ids: ids.slice(0, 15),
        items: items.slice(0, 15),
      }).success,
    ).toBe(true);
    expect(
      MobilityTemplateSchema.safeParse({
        ...template,
        exercise_ids: [],
        items: [],
      }).success,
    ).toBe(false);
  });

  it("is strict", () => {
    expect(
      MobilityTemplateSchema.safeParse({ ...template, heart_rate: 120 })
        .success,
    ).toBe(false);
    expect(
      MobilityTemplateSchema.safeParse({
        ...template,
        items: [{ ...template.items[0], hr: 100 }, template.items[1]],
      }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------ plan session */

const sessionRow = {
  plan_mobility_session_id: `pms_${uuid}`,
  session_id: `s_${uuid}`,
  session_name: "Morgenroutine",
  session_order: 1,
  kind: "morning",
  placement: "own_day",
  weekdays: [1, 2, 3],
  after_session_id: null,
  minutes: 10,
  template,
  status: "active",
  row_revision: 1,
};

describe("PlanMobilitySession rules", () => {
  const ok = (v: unknown) => PlanMobilitySessionSchema.safeParse(v).success;

  it("accepts the three shapes", () => {
    expect(ok(sessionRow)).toBe(true);
    expect(
      ok({
        ...sessionRow,
        kind: "session",
        minutes: 20,
        weekdays: [3],
      }),
    ).toBe(true);
    expect(
      ok({
        ...sessionRow,
        kind: "session",
        minutes: 15,
        placement: "after_strength",
        weekdays: [],
        after_session_id: `s_${uuid.replace(/1$/, "2")}`,
      }),
    ).toBe(true);
  });

  it("morning: 5/10/15 minutes, at least one weekday, own day, no anchor", () => {
    expect(ok({ ...sessionRow, minutes: 20 })).toBe(false);
    expect(ok({ ...sessionRow, weekdays: [] })).toBe(false);
    expect(ok({ ...sessionRow, weekdays: [1, 1] })).toBe(false);
    expect(ok({ ...sessionRow, placement: "after_strength" })).toBe(false);
    expect(ok({ ...sessionRow, after_session_id: "s_x" })).toBe(false);
    for (const minutes of [5, 10, 15])
      expect(ok({ ...sessionRow, minutes })).toBe(true);
  });

  it("session: 15/20/30 minutes", () => {
    const own = { ...sessionRow, kind: "session", weekdays: [2] };
    for (const minutes of [15, 20, 30])
      expect(ok({ ...own, minutes })).toBe(true);
    for (const minutes of [5, 10, 25, 45])
      expect(ok({ ...own, minutes })).toBe(false);
  });

  it("own day: exactly one weekday and no anchor", () => {
    const own = { ...sessionRow, kind: "session", minutes: 20 };
    expect(ok({ ...own, weekdays: [] })).toBe(false);
    expect(ok({ ...own, weekdays: [2, 4] })).toBe(false);
    expect(ok({ ...own, weekdays: [2], after_session_id: "s_x" })).toBe(false);
  });

  it("after strength: no weekday and an anchor session", () => {
    const after = {
      ...sessionRow,
      kind: "session",
      minutes: 20,
      placement: "after_strength",
      weekdays: [],
      after_session_id: "s_anchor",
    };
    expect(ok(after)).toBe(true);
    expect(ok({ ...after, weekdays: [2] })).toBe(false);
    expect(ok({ ...after, after_session_id: null })).toBe(false);
  });

  it("rejects weekdays outside 1-7, a bad status and extra fields", () => {
    expect(ok({ ...sessionRow, weekdays: [0] })).toBe(false);
    expect(ok({ ...sessionRow, weekdays: [8] })).toBe(false);
    expect(ok({ ...sessionRow, status: "paused" })).toBe(false);
    expect(ok({ ...sessionRow, pulse: 1 })).toBe(false);
  });
});

/* ------------------------------------------------------------- ops union */

describe("plan operations for mobility", () => {
  const add = {
    type: "add_mobility_session",
    kind: "morning",
    session_name: "Morgenroutine",
    minutes: 10,
    exercise_ids: ["mob_neck_rolls", "mob_shoulder_circles"],
  };
  const ok = (v: unknown) => PlanEditSchema.safeParse(v).success;

  it("accepts the three new operations", () => {
    expect(ok(add)).toBe(true);
    expect(
      ok({
        ...add,
        kind: "session",
        minutes: 20,
        placement: "after_strength",
        after_session_id: "s_anchor",
        weekdays: [],
      }),
    ).toBe(true);
    expect(
      ok({ type: "update_mobility_session", session_id: "s1", minutes: 15 }),
    ).toBe(true);
    expect(ok({ type: "remove_mobility_session", session_id: "s1" })).toBe(
      true,
    );
  });

  it("rejects any seconds field: Arnold computes the timing", () => {
    for (const field of [
      "seconds",
      "seconds_per_side",
      "duration_s",
      "total_s",
      "items",
      "template",
    ]) {
      expect(ok({ ...add, [field]: 30 }), `add ${field}`).toBe(false);
      expect(
        ok({
          type: "update_mobility_session",
          session_id: "s1",
          [field]: 30,
        }),
        `update ${field}`,
      ).toBe(false);
    }
  });

  it("only takes catalog exercises, 1 to 15 of them", () => {
    expect(ok({ ...add, exercise_ids: ["bench_press"] })).toBe(false);
    expect(ok({ ...add, exercise_ids: [] })).toBe(false);
    expect(
      ok({
        ...add,
        exercise_ids: MOBILITY_CATALOG.slice(0, 16).map((e) => e.id),
      }),
    ).toBe(false);
    expect(
      ok({
        ...add,
        exercise_ids: MOBILITY_CATALOG.slice(0, 15).map((e) => e.id),
      }),
    ).toBe(true);
  });

  it("needs a session_id to update or remove, and nothing else", () => {
    expect(ok({ type: "update_mobility_session", minutes: 15 })).toBe(false);
    expect(ok({ type: "remove_mobility_session" })).toBe(false);
    expect(
      ok({ type: "remove_mobility_session", session_id: "s1", extra: 1 }),
    ).toBe(false);
  });

  it("rejects a bad kind, placement or weekday", () => {
    expect(ok({ ...add, kind: "evening" })).toBe(false);
    expect(ok({ ...add, placement: "own_days" })).toBe(false);
    expect(ok({ ...add, weekdays: [0] })).toBe(false);
    expect(ok({ ...add, weekdays: [8] })).toBe(false);
    expect(ok({ ...add, minutes: 0 })).toBe(false);
  });

  it("leaves the existing operations in place", () => {
    for (const type of ["add_run_session", "remove_run_session"])
      expect(
        PlanEditSchema.options.some((o) => o.shape.type.value === type),
      ).toBe(true);
  });
});

/* ------------------------------------------------------------ tool inputs */

describe("tool inputs", () => {
  const log = MobilityToolInputs.log_mobility;

  it("is strict and carries no user or tracker id", () => {
    expect(MobilityToolInputs.get_mobility_overview.safeParse({}).success).toBe(
      true,
    );
    expect(
      MobilityToolInputs.get_mobility_overview.safeParse({ user_id: "u" })
        .success,
    ).toBe(false);
    expect(
      log.safeParse({ request_id: "r1", kind: "morning", user_id: "u" })
        .success,
    ).toBe(false);
    expect(
      log.safeParse({ request_id: "r1", kind: "morning", tracker_id: "t" })
        .success,
    ).toBe(false);
  });

  it("log_mobility: only what the user said; unknown minutes stay absent", () => {
    const parsed = log.parse({ request_id: "r1", kind: "session" });
    expect(parsed.minutes).toBeUndefined();
    expect(
      log.safeParse({ request_id: "r1", kind: "morning", minutes: 0 }).success,
    ).toBe(false);
    expect(
      log.safeParse({ request_id: "r1", kind: "morning", minutes: 121 })
        .success,
    ).toBe(false);
    expect(
      log.safeParse({
        request_id: "r1",
        kind: "morning",
        minutes: 120,
        workout_date_local: "2026-11-23",
        confirm_duplicate: true,
      }).success,
    ).toBe(true);
    expect(
      log.safeParse({
        request_id: "r1",
        kind: "morning",
        workout_date_local: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(log.safeParse({ kind: "morning" }).success).toBe(false);
  });

  it("update_mobility_profile needs a request_id and a preference", () => {
    const input = MobilityToolInputs.update_mobility_profile;
    expect(
      input.safeParse({ request_id: "r1", preference: { wants: false } })
        .success,
    ).toBe(true);
    expect(input.safeParse({ preference: { wants: false } }).success).toBe(
      false,
    );
    expect(input.safeParse({ request_id: "r1" }).success).toBe(false);
  });

  it("answers consistently: ok needs the result, an error needs none", () => {
    const err = {
      code: "VALIDATION_ERROR",
      message: "Falsche Eingabe.",
      retryable: false,
    };
    const okLog = LogMobilityResponseSchema.safeParse({
      ok: true,
      replayed: false,
      workout_id: "w1",
      error: null,
    });
    expect(okLog.success).toBe(true);
    expect(
      LogMobilityResponseSchema.safeParse({
        ok: true,
        replayed: false,
        error: null,
      }).success,
    ).toBe(false);
    expect(
      LogMobilityResponseSchema.safeParse({
        ok: false,
        replayed: false,
        workout_id: "w1",
        error: err,
      }).success,
    ).toBe(false);
    expect(
      UpdateMobilityProfileResponseSchema.safeParse({
        ok: true,
        replayed: true,
        profile: { state: "no", preference: { wants: false } },
        error: null,
      }).success,
    ).toBe(true);
  });
});

describe("overview and cards", () => {
  it("rejects a ratio that contradicts the planned count", () => {
    const view = {
      planned_count: 0,
      done_count: 2,
      ratio: null,
      streak_days: 2,
      days: 28,
    };
    expect(MobilityAdherenceViewSchema.safeParse(view).success).toBe(true);
    expect(
      MobilityAdherenceViewSchema.safeParse({ ...view, ratio: 0 }).success,
    ).toBe(false);
    expect(
      MobilityAdherenceViewSchema.safeParse({
        ...view,
        planned_count: 2,
        ratio: null,
      }).success,
    ).toBe(false);
    expect(
      MobilityAdherenceViewSchema.safeParse({
        ...view,
        planned_count: 2,
        ratio: 1.2,
      }).success,
    ).toBe(false);
  });

  it("parses an overview and rejects more than five routines for today", () => {
    const item = {
      session_id: "s1",
      kind: "morning",
      session_name: "Morgenroutine",
      minutes: 10,
      done: false,
      template,
    };
    const overview = {
      profile: { state: "yes", preference: wanted },
      today: { date_local: "2026-11-23", items: [item] },
      adherence: {
        planned_count: 4,
        done_count: 3,
        ratio: 0.75,
        streak_days: 2,
        days: 28,
      },
      recent: [],
    };
    expect(MobilityOverviewSchema.safeParse(overview).success).toBe(true);
    expect(
      MobilityOverviewSchema.safeParse({
        ...overview,
        today: { ...overview.today, items: Array(6).fill(item) },
      }).success,
    ).toBe(false);
    expect(
      MobilityOverviewSchema.safeParse({ ...overview, extra: 1 }).success,
    ).toBe(false);
  });

  it("knows exactly three cards", () => {
    for (const card of ["mobility_today", "mobility_result", "mobility_setup"])
      expect(ShowMobilityCardInputSchema.safeParse({ card }).success).toBe(
        true,
      );
    expect(
      ShowMobilityCardInputSchema.safeParse({ card: "mobility_x" }).success,
    ).toBe(false);
    expect(
      MobilityCardViewSchema.safeParse({
        mobility_card_contract: "arnold.mobility_card/1",
        card: "mobility_today",
        workout_id: null,
      }).success,
    ).toBe(true);
    expect(
      MobilityCardViewSchema.safeParse({
        mobility_card_contract: "arnold.mobility_card/2",
        card: "mobility_today",
        workout_id: null,
      }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------- watch wire */

describe("watch: plan acknowledgement", () => {
  it("accepts the mobility mark and still accepts the old shape", () => {
    expect(
      WatchPlanAckRequestSchema.safeParse({ v: "0123456789abcdef" }).success,
    ).toBe(true);
    expect(
      WatchPlanAckRequestSchema.safeParse({
        v: "0123456789abcdef",
        mv: "fedcba9876543210",
      }).success,
    ).toBe(true);
    expect(
      WatchPlanAckRequestSchema.parse({ v: "0123456789abcdef" }).mv,
    ).toBeUndefined();
  });

  it("rejects a malformed mark and unknown fields", () => {
    for (const bad of [
      { v: "0123456789abcdef", mv: "ZZ" },
      { v: "0123456789abcdef", mv: "FEDCBA9876543210" },
      { v: "0123456789abcdef", mx: "fedcba9876543210" },
      { mv: "fedcba9876543210" },
    ])
      expect(WatchPlanAckRequestSchema.safeParse(bad).success).toBe(false);
  });

  it("leaves the response unchanged", () => {
    expect(
      WatchPlanAckResponseSchema.safeParse({
        api_version: 1,
        min_app_version: "1.0.0",
        v: "0123456789abcdef",
      }).success,
    ).toBe(true);
  });
});

describe("watch: today and routine fixtures", () => {
  it.each([
    ["mobility-today", WatchMobilityTodaySchema, "today"],
    ["mobility-routine", WatchMobilityRoutineSchema, "routine"],
  ] as const)(
    "%s roundtrips within its UTF-8 budget with UUIDs and umlauts",
    (name, schema, key) => {
      const data = fixture(name);
      const parsed = schema.parse(data);
      expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(data);
      expect(bytes(data)).toBeLessThanOrEqual(MOBILITY_WATCH_BUDGET_BYTES[key]);
      expect(JSON.stringify(data)).toMatch(/[ÄÖÜäöü]/);
    },
  );

  it("has the budgets the watch plans for", () => {
    expect(MOBILITY_WATCH_BUDGET_BYTES).toEqual({ today: 1200, routine: 2500 });
  });

  it("today: five entries with UUID ids", () => {
    const data = fixture("mobility-today");
    expect(data.items).toHaveLength(5);
    for (const item of data.items) expect(item.id).toMatch(/_[0-9a-f-]{36}$/);
    expect(data.items.some((i: { a: string | null }) => i.a !== null)).toBe(
      true,
    );
  });

  it("routine: 15 exercises, each a catalog exercise, with a UUID id", () => {
    const data = fixture("mobility-routine");
    expect(data.ex).toHaveLength(15);
    expect(data.id).toMatch(/_[0-9a-f-]{36}$/);
    const ids = data.ex.map((e: { c: string }) => e.c);
    expect(new Set(ids).size).toBe(15);
    for (const e of data.ex)
      expect(MOBILITY_CATALOG.some((c) => c.id === e.c)).toBe(true);
  });

  it("rejects one entry too many, one exercise too many and unknown fields", () => {
    const today = fixture("mobility-today");
    expect(
      WatchMobilityTodaySchema.safeParse({
        ...today,
        items: [...today.items, today.items[0]],
      }).success,
    ).toBe(false);
    expect(
      WatchMobilityTodaySchema.safeParse({ ...today, hr: 60 }).success,
    ).toBe(false);
    const routine = fixture("mobility-routine");
    // The routine names its plan version (p): without it the watch could not send the result as a planned one.
    expect(WatchMobilityRoutineSchema.safeParse(routine).success).toBe(true);
    expect(
      WatchMobilityRoutineSchema.safeParse({ ...routine, p: undefined })
        .success,
    ).toBe(false);
    expect(
      WatchMobilityRoutineSchema.safeParse({ ...routine, p: "" }).success,
    ).toBe(false);
    expect(
      WatchMobilityRoutineSchema.safeParse({
        ...routine,
        ex: [...routine.ex, routine.ex[0]],
      }).success,
    ).toBe(false);
    expect(
      WatchMobilityRoutineSchema.safeParse({ ...routine, ex: [] }).success,
    ).toBe(false);
    expect(
      WatchMobilityRoutineSchema.safeParse({
        ...routine,
        ex: [{ ...routine.ex[0], c: "mob_levitation" }],
      }).success,
    ).toBe(false);
  });

  it("today: the morning routine follows no strength session", () => {
    const today = fixture("mobility-today");
    const morning = today.items.find((i: { k: string }) => i.k === "m");
    expect(
      WatchMobilityTodaySchema.safeParse({
        ...today,
        items: [{ ...morning, a: "s_anchor" }],
      }).success,
    ).toBe(false);
    expect(
      WatchMobilityTodaySchema.safeParse({
        ...today,
        items: [{ ...morning, w: 0 }],
      }).success,
    ).toBe(false);
    expect(
      WatchMobilityTodaySchema.safeParse({
        ...today,
        items: [{ ...morning, w: 128 }],
      }).success,
    ).toBe(false);
  });
});

describe("watch: finished routine", () => {
  const request = {
    request_id: `gm_${uuid}`,
    session_uuid: uuid,
    kind: "morning",
    workout_date_local: "2026-11-23",
    utc_offset_min: 60,
    started_at_utc: AT,
    ended_at_utc: "2026-11-23T07:09:00Z",
    timer_s: 480,
    elapsed_s: 540,
    ended_early: false,
    ex: [
      { c: "mob_neck_rolls", st: "done", t: 45 },
      { c: "mob_shoulder_circles", st: "skipped", t: 0 },
    ],
  };
  const ok = (v: unknown) => WatchMobilityRequestSchema.safeParse(v).success;

  it("accepts a free routine and a planned one", () => {
    expect(ok(request)).toBe(true);
    expect(
      ok({
        ...request,
        plan_version_id: `plv_${uuid}`,
        session_id: `s_${uuid}`,
      }),
    ).toBe(true);
  });

  it("carries plan_version_id and session_id only together", () => {
    expect(ok({ ...request, plan_version_id: `plv_${uuid}` })).toBe(false);
    expect(ok({ ...request, session_id: `s_${uuid}` })).toBe(false);
  });

  it("never carries heart rate and rejects unknown fields", () => {
    for (const field of ["hr_avg_bpm", "hr", "heart_rate", "user_id"])
      expect(ok({ ...request, [field]: 1 })).toBe(false);
    expect(
      ok({
        ...request,
        ex: [{ c: "mob_neck_rolls", st: "done", t: 45, hr: 90 }],
      }),
    ).toBe(false);
  });

  it("needs ended_early, valid times and consistent seconds", () => {
    const { ended_early: _drop, ...without } = request;
    expect(ok(without)).toBe(false);
    expect(ok({ ...request, ended_early: true })).toBe(true);
    expect(ok({ ...request, timer_s: 600 })).toBe(false);
    expect(ok({ ...request, ended_at_utc: "2026-11-23T06:00:00Z" })).toBe(
      false,
    );
    expect(
      ok({ ...request, started_at_utc: "2026-11-23T08:00:00+01:00" }),
    ).toBe(false);
    expect(ok({ ...request, request_id: "x" })).toBe(false);
    expect(ok({ ...request, workout_date_local: "2026-11-31" })).toBe(false);
    expect(ok({ ...request, utc_offset_min: 841 })).toBe(false);
  });

  it("limits the exercises reported to 20 and checks their status", () => {
    const item = { c: "mob_neck_rolls", st: "done", t: 10 };
    expect(ok({ ...request, ex: Array(20).fill(item) })).toBe(true);
    expect(ok({ ...request, ex: Array(21).fill(item) })).toBe(false);
    expect(ok({ ...request, ex: [{ ...item, st: "finished" }] })).toBe(false);
    expect(ok({ ...request, ex: [{ ...item, c: "mob_levitation" }] })).toBe(
      false,
    );
  });

  it("answers with the workout id and whether it was a replay", () => {
    expect(
      WatchMobilityResponseSchema.safeParse({
        api_version: 1,
        min_app_version: "1.0.0",
        workout_id: "w_1",
        replayed: false,
      }).success,
    ).toBe(true);
    expect(
      WatchMobilityResponseSchema.safeParse({
        api_version: 2,
        min_app_version: "1.0.0",
        workout_id: "w_1",
        replayed: false,
      }).success,
    ).toBe(false);
  });
});
