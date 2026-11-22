import { describe, expect, it } from "vitest";
import {
  MOBILITY_LENGTHS,
  MOBILITY_RULES_VERSION,
  MOBILITY_SIDE_SWITCH_S,
  MOBILITY_TIMING_ERROR_CODES,
  MOBILITY_TRANSITION_S,
  buildMobilityRoutine,
  mobilityTolerance,
  type MobilityRoutineKind,
  type MobilityRoutineResult,
} from "../src/analytics/mobility/timing.js";
import {
  MOBILITY_CATALOG,
  MOBILITY_CATALOG_VERSION,
  mobilityExercise,
} from "../src/shared/mobility-catalog.js";
import { MobilityTemplateSchema } from "../src/shared/mobility-contract.js";

type Ok = Extract<MobilityRoutineResult, { ok: true }>;
const ok = (result: MobilityRoutineResult): Ok => {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
};

const MORNING = [
  "mob_neck_rolls",
  "mob_shoulder_circles",
  "mob_standing_rotation",
  "mob_hip_circles",
  "mob_leg_swing_front",
  "mob_calf_wall",
  "mob_deep_squat_hold",
  "mob_wrist_circles",
  "mob_doorway_chest",
  "mob_split_stance_hip",
];
const SESSION = [
  "mob_cat_cow",
  "mob_childs_pose",
  "mob_thread_needle",
  "mob_open_book",
  "mob_worlds_greatest",
  "mob_kneeling_hip_flexor",
  "mob_pigeon",
  "mob_90_90",
  "mob_seated_forward_fold",
  "mob_supine_twist",
  "mob_cobra",
  "mob_downward_dog",
  "mob_figure_four",
  "mob_puppy_pose",
  "mob_ankle_rock",
];

/** Recomputes the total from the items, independent of the engine. */
const recomputed = (items: Ok["items"]) =>
  items.reduce((sum, i) => sum + i.sides * i.seconds_per_side, 0) +
  MOBILITY_TRANSITION_S * (items.length - 1) +
  MOBILITY_SIDE_SWITCH_S * items.filter((i) => i.sides === 2).length;

const expectWithinBudget = (result: Ok, minutes: number) => {
  const budget = minutes * 60;
  expect(result.total_s).toBe(recomputed(result.items));
  expect(Math.abs(result.total_s - budget)).toBeLessThanOrEqual(
    Math.max(30, budget * 0.1),
  );
  for (const item of result.items) {
    const e = mobilityExercise(item.exercise_id)!;
    expect(item.seconds_per_side % 5).toBe(0);
    expect(item.seconds_per_side).toBeGreaterThanOrEqual(e.min_s);
    expect(item.seconds_per_side).toBeLessThanOrEqual(e.max_s);
    expect(item.sides).toBe(e.per_side ? 2 : 1);
    expect(item.reps).toBe(e.reps);
  }
};

const typical: [MobilityRoutineKind, number, string[]][] = [
  ["morning", 5, MORNING.slice(0, 4)],
  ["morning", 10, MORNING.slice(0, 6)],
  ["morning", 15, MORNING.slice(0, 8)],
  ["session", 15, SESSION.slice(0, 7)],
  ["session", 20, SESSION.slice(0, 9)],
  ["session", 30, SESSION.slice(0, 12)],
];

describe("buildMobilityRoutine (D-MOB-05)", () => {
  it.each(typical)(
    "fits %s %i min with a typical selection into the budget",
    (kind, minutes, ids) => {
      const result = ok(
        buildMobilityRoutine({ kind, minutes, exercise_ids: ids }),
      );
      expect(result.rules_version).toBe(MOBILITY_RULES_VERSION);
      expect(result.items.map((i) => i.exercise_id)).toEqual(ids);
      expectWithinBudget(result, minutes);
      // The result is what a stored template holds.
      MobilityTemplateSchema.parse({
        catalog_version: MOBILITY_CATALOG_VERSION,
        rules_version: result.rules_version,
        exercise_ids: ids,
        items: result.items,
        total_s: result.total_s,
      });
    },
  );

  it("fits the smallest and largest counts of every length", () => {
    for (const kind of ["morning", "session"] as const)
      for (const [minutes, { min, max }] of Object.entries(
        MOBILITY_LENGTHS[kind],
      ))
        for (const n of [min, max]) {
          const pool = kind === "morning" ? MORNING : SESSION;
          const ids =
            n <= pool.length
              ? pool.slice(0, n)
              : [
                  ...pool,
                  ...MOBILITY_CATALOG.map((e) => e.id).filter(
                    (id) => !pool.includes(id),
                  ),
                ].slice(0, n);
          expectWithinBudget(
            ok(
              buildMobilityRoutine({
                kind,
                minutes: Number(minutes),
                exercise_ids: ids,
              }),
            ),
            Number(minutes),
          );
        }
  });

  it("returns every defined error code with a German message", () => {
    const codes = new Set<string>();
    const expectCode = (result: MobilityRoutineResult, code: string) => {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(code);
      expect(result.message.length).toBeGreaterThan(10);
      codes.add(result.code);
    };
    expectCode(
      buildMobilityRoutine({ kind: "morning", minutes: 20, exercise_ids: [] }),
      "MOBILITY_BAD_MINUTES",
    );
    expectCode(
      buildMobilityRoutine({
        kind: "session",
        minutes: 10,
        exercise_ids: SESSION.slice(0, 6),
      }),
      "MOBILITY_BAD_MINUTES",
    );
    expectCode(
      buildMobilityRoutine({
        kind: "morning",
        minutes: 7.5,
        exercise_ids: MORNING.slice(0, 3),
      }),
      "MOBILITY_BAD_MINUTES",
    );
    expectCode(
      buildMobilityRoutine({
        kind: "morning",
        minutes: 5,
        exercise_ids: MORNING.slice(0, 6),
      }),
      "MOBILITY_TOO_MANY_EXERCISES",
    );
    expectCode(
      buildMobilityRoutine({
        kind: "session",
        minutes: 30,
        exercise_ids: SESSION.slice(0, 8),
      }),
      "MOBILITY_TOO_FEW_EXERCISES",
    );
    expectCode(
      buildMobilityRoutine({
        kind: "morning",
        minutes: 5,
        exercise_ids: ["mob_neck_rolls", "mob_nope", "mob_hip_circles"],
      }),
      "MOBILITY_UNKNOWN_EXERCISE",
    );
    expectCode(
      buildMobilityRoutine({
        kind: "morning",
        minutes: 5,
        exercise_ids: ["mob_neck_rolls", "mob_hip_circles", "mob_neck_rolls"],
      }),
      "MOBILITY_DUPLICATE_EXERCISE",
    );
    expectCode(
      buildMobilityRoutine({
        kind: "morning",
        minutes: 5,
        exercise_ids: ["mob_neck_rolls", "mob_cat_cow", "mob_hip_circles"],
      }),
      "MOBILITY_NOT_MORNING_SUITABLE",
    );
    // Nine exercises that are short even at their maximum (2 × 120 s,
    // 5 × 2 × 90 s, 2 × 180 s plus transitions = 1555 s) cannot fill 30 min.
    expectCode(
      buildMobilityRoutine({
        kind: "session",
        minutes: 30,
        exercise_ids: [
          "mob_wrist_circles",
          "mob_cobra",
          "mob_leg_swing_side",
          "mob_ankle_circles",
          "mob_ankle_rock",
          "mob_quadruped_hip_circles",
          "mob_leg_swing_front",
          "mob_neck_rolls",
          "mob_hip_circles",
        ],
      }),
      "MOBILITY_BUDGET_UNREACHABLE",
    );
    expect([...codes].sort()).toEqual([...MOBILITY_TIMING_ERROR_CODES].sort());
  });

  it("rounds every duration to 5 s", () => {
    const result = ok(
      buildMobilityRoutine({
        kind: "session",
        minutes: 20,
        exercise_ids: SESSION.slice(0, 11),
      }),
    );
    result.items.forEach((i) => expect(i.seconds_per_side % 5).toBe(0));
  });

  it("is deterministic and leaves its input unchanged", () => {
    const ids = Object.freeze(SESSION.slice(2, 13));
    const a = buildMobilityRoutine({
      kind: "session",
      minutes: 30,
      exercise_ids: ids,
    });
    const b = buildMobilityRoutine({
      kind: "session",
      minutes: 30,
      exercise_ids: [...ids],
    });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("uses the tolerance max(30 s, 10 % of the budget)", () => {
    expect(mobilityTolerance(300)).toBe(30);
    expect(mobilityTolerance(600)).toBe(60);
    expect(mobilityTolerance(1800)).toBe(180);
  });

  it("keeps 200 random valid selections in budget or answers with a defined error", () => {
    // Mulberry32 with a fixed seed: the same 200 cases on every run.
    let seed = 0x5eed_2026;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(list: readonly T[]) =>
      list[Math.floor(random() * list.length)];
    let fitted = 0;
    for (let n = 0; n < 200; n++) {
      const kind = pick(["morning", "session"] as const);
      const minutes = Number(pick(Object.keys(MOBILITY_LENGTHS[kind])));
      const { min, max } = MOBILITY_LENGTHS[kind][minutes];
      const count = min + Math.floor(random() * (max - min + 1));
      const pool = MOBILITY_CATALOG.filter(
        (e) => kind === "session" || e.morning_ok,
      ).map((e) => e.id);
      const ids: string[] = [];
      while (ids.length < count) {
        const id = pick(pool);
        if (!ids.includes(id)) ids.push(id);
      }
      const result = buildMobilityRoutine({ kind, minutes, exercise_ids: ids });
      if (result.ok) {
        expectWithinBudget(result, minutes);
        fitted++;
      } else
        expect(MOBILITY_TIMING_ERROR_CODES).toContain(result.code as never);
    }
    // Valid selections almost always fit; errors stay the exception.
    expect(fitted).toBeGreaterThanOrEqual(180);
  });
});
