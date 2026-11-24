import { describe, expect, test } from "vitest";
import {
  checkPlanQuality,
  type PlanQualityExercise,
  type PlanQualityInput,
  type PlanQualitySession,
} from "../src/analytics";

const catalog: PlanQualityExercise[] = [
  {
    exercise_id: "bench",
    primary_muscle: "chest",
    secondary_muscles: ["arms"],
  },
  { exercise_id: "incline", primary_muscle: "chest" },
  { exercise_id: "row", primary_muscle: "back", secondary_muscles: ["arms"] },
  { exercise_id: "pulldown", primary_muscle: "back" },
  { exercise_id: "ohp", primary_muscle: "shoulders" },
  { exercise_id: "lateral", primary_muscle: "shoulders", isolation: true },
  { exercise_id: "facepull", primary_muscle: "shoulders", isolation: true },
  { exercise_id: "squat", primary_muscle: "legs" },
  { exercise_id: "legpress", primary_muscle: "legs" },
  { exercise_id: "rdl", primary_muscle: "legs" },
  { exercise_id: "legcurl", primary_muscle: "legs", isolation: true },
  { exercise_id: "hipthrust", primary_muscle: "glutes" },
  { exercise_id: "crunch", primary_muscle: "core", isolation: true },
  { exercise_id: "plank", primary_muscle: "core", isolation: true },
  { exercise_id: "mystery", primary_muscle: null },
];

const session = (
  name: string,
  items: [string, number | null][],
  weekday?: number,
): PlanQualitySession => ({
  session_name: name,
  weekday,
  exercises: items.map(([exercise_id, target_sets]) => ({
    exercise_id,
    ...(target_sets === null ? { target_sets: null } : { target_sets }),
  })),
});

const input = (
  sessions: PlanQualitySession[],
  profile: Partial<PlanQualityInput["profile"]> = {},
  runs?: PlanQualityInput["runs"],
): PlanQualityInput => ({
  sessions,
  runs,
  catalog,
  profile: {
    days_per_week: 4,
    session_minutes: 60,
    focus_muscle_groups: ["back"],
    goal: "muscle_gain",
    ...profile,
  },
});

const codes = (r: ReturnType<typeof checkPlanQuality>, severity?: string) =>
  r.findings
    .filter((f) => !severity || f.severity === severity)
    .map((f) => f.code);

const cleanPlan = () => [
  session("Oberkörper A", [
    ["bench", 3],
    ["row", 4],
    ["ohp", 3],
    ["pulldown", 3],
  ]),
  session("Beine A", [
    ["squat", 4],
    ["rdl", 3],
    ["legpress", 3],
  ]),
  session("Oberkörper B", [
    ["incline", 3],
    ["pulldown", 4],
    ["row", 3],
    ["lateral", 3],
  ]),
  session("Beine B", [
    ["legpress", 4],
    ["legcurl", 3],
    ["hipthrust", 3],
  ]),
];

describe("checkPlanQuality", () => {
  test("clean 4-day plan with back focus has no block", () => {
    const r = checkPlanQuality(input(cleanPlan()));
    expect(r.blocked).toBe(false);
    expect(codes(r, "block")).toEqual([]);
    expect(r.weekly_sets.back).toBe(14);
  });

  test("live-test pattern: shoulders 21, back 13, core 12 with back focus blocks", () => {
    const plan = [
      session("Schultern", [
        ["ohp", 7],
        ["lateral", 7],
        ["facepull", 7],
      ]),
      session("Rücken", [
        ["row", 7],
        ["pulldown", 6],
      ]),
      session("Bauch", [
        ["crunch", 6],
        ["plank", 6],
      ]),
      session("Brust", [
        ["bench", 6],
        ["incline", 6],
      ]),
      session("Beine", [
        ["squat", 7],
        ["legpress", 7],
      ]),
    ];
    const r = checkPlanQuality(
      input(plan, { days_per_week: 5, session_minutes: 90 }),
    );
    const focus = r.findings.find((f) => f.code === "focus_not_emphasised");
    expect(focus?.severity).toBe("block");
    expect(focus?.muscle_group).toBe("back");
    expect(r.blocked).toBe(true);
  });

  test("six sessions on four days block", () => {
    const six = [...cleanPlan(), cleanPlan()[0]!, cleanPlan()[1]!];
    const r = checkPlanQuality(input(six));
    expect(codes(r, "block")).toContain("too_many_sessions");
  });

  test("crunches and face pulls on a leg day are hints", () => {
    const plan = [
      session("Beine", [
        ["squat", 4],
        ["legpress", 3],
        ["rdl", 3],
        ["crunch", 3],
        ["facepull", 3],
      ]),
    ];
    const r = checkPlanQuality(
      input(plan, { days_per_week: 3, session_minutes: 90 }),
    );
    const hints = r.findings.filter((f) => f.code === "leg_day_accessory");
    expect(hints.map((h) => h.muscle_group).sort()).toEqual([
      "core",
      "shoulders",
    ]);
    expect(hints.every((h) => h.severity === "hint")).toBe(true);
  });

  test("45-minute session with 22 sets exceeds the time budget", () => {
    const plan = [
      session("Ganzkörper", [
        ["bench", 4],
        ["row", 4],
        ["squat", 4],
        ["ohp", 4],
        ["lateral", 3],
        ["legcurl", 3],
      ]),
    ];
    const r = checkPlanQuality(
      input(plan, {
        session_minutes: 45,
        days_per_week: 3,
        focus_muscle_groups: [],
      }),
    );
    const f = r.findings.find((x) => x.code === "time_budget_exceeded");
    expect(f?.severity).toBe("block");
    expect(f?.session).toBe("Ganzkörper");
  });

  test("time within 10 % tolerance does not block", () => {
    // 8 + 19 sets × 3 min = 65 ≤ 66
    const plan = [
      session("A", [
        ["bench", 5],
        ["row", 5],
        ["squat", 5],
        ["ohp", 4],
      ]),
    ];
    const r = checkPlanQuality(
      input(plan, { days_per_week: 3, focus_muscle_groups: [] }),
    );
    expect(codes(r)).not.toContain("time_budget_exceeded");
  });

  test("secondary muscles count half", () => {
    const r = checkPlanQuality(
      input(
        [
          session("A", [
            ["bench", 4],
            ["row", 4],
          ]),
        ],
        { focus_muscle_groups: [] },
      ),
    );
    expect(r.weekly_sets.arms).toBe(4);
    expect(r.weekly_sets.chest).toBe(4);
  });

  test("weekly set range gives hints for muscle gain only", () => {
    const low = checkPlanQuality(
      input([session("A", [["bench", 3]])], { focus_muscle_groups: [] }),
    );
    expect(codes(low)).toContain("weekly_sets_low");
    const other = checkPlanQuality(
      input([session("A", [["bench", 3]])], {
        focus_muscle_groups: [],
        goal: "strength",
      }),
    );
    expect(codes(other)).not.toContain("weekly_sets_low");
    const high = checkPlanQuality(
      input([session("A", [["bench", 12]]), session("B", [["incline", 12]])], {
        focus_muscle_groups: [],
        session_minutes: 90,
      }),
    );
    expect(
      high.findings.find((f) => f.code === "weekly_sets_high")?.severity,
    ).toBe("hint");
  });

  test("unknown muscle is reported, not counted, and never blocks the focus rule", () => {
    const plan = [
      session("A", [
        ["mystery", 4],
        ["row", 3],
        ["bench", 3],
        ["squat", 3],
      ]),
    ];
    const r = checkPlanQuality(input(plan));
    expect(r.unknown.exercise_ids).toEqual(["mystery"]);
    expect(codes(r)).toContain("unknown_muscle");
    expect(codes(r)).not.toContain("focus_not_emphasised");
  });

  test("unknown set count is reported and skips the time check", () => {
    const r = checkPlanQuality(
      input(
        [
          session("A", [
            ["bench", null],
            ["row", 30],
          ]),
        ],
        { focus_muscle_groups: [] },
      ),
    );
    expect(codes(r)).toContain("unknown_sets");
    expect(codes(r)).not.toContain("time_budget_exceeded");
  });

  test("hard run the day after a heavy leg day is a hint; easy run is not", () => {
    const plan = [
      session(
        "Beine",
        [
          ["squat", 4],
          ["legpress", 3],
        ],
        1,
      ),
    ];
    const base = { days_per_week: 3, focus_muscle_groups: [] as string[] };
    const hard = checkPlanQuality(
      input(plan, base, [
        { session_name: "Tempo", run_type: "tempo", preferred_weekday: 2 },
      ]),
    );
    expect(
      hard.findings.find((f) => f.code === "hard_run_after_leg_day")?.severity,
    ).toBe("hint");
    const easy = checkPlanQuality(
      input(plan, base, [
        { session_name: "Locker", run_type: "recovery", preferred_weekday: 2 },
      ]),
    );
    expect(codes(easy)).not.toContain("hard_run_after_leg_day");
    const wrap = checkPlanQuality(
      input(
        [
          session(
            "Beine",
            [
              ["squat", 4],
              ["legpress", 3],
            ],
            7,
          ),
        ],
        base,
        [{ session_name: "Tempo", run_type: "tempo", preferred_weekday: 1 }],
      ),
    );
    expect(codes(wrap)).toContain("hard_run_after_leg_day");
  });
});
