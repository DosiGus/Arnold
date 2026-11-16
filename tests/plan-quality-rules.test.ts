import { describe, expect, it } from "vitest";
import { harness, session } from "./fixtures/arnold-plan";

/**
 * The plan rules the server enforces on its own, whatever drafted the plan.
 * Each is a warning with a sentence a user can read: none blocks a plan that
 * was valid before, so stored plans stay usable.
 */
async function check(exercise: Record<string, unknown>) {
  const h = harness("empty");
  const base = session("Training", ["plan-fx-bench"]);
  const created = await h.ok("create_training_plan", {
    request_id: "r1",
    name: "Regelplan",
    sessions: [
      {
        ...base,
        exercises: [{ ...base.exercises[0], rest_seconds: 90, ...exercise }],
      },
    ],
  });
  return created.validation!;
}

describe("plan-wide server hints", () => {
  it("accepts a complete exercise without a finding", async () => {
    const result = await check({});
    expect(result.warnings).toEqual([]);
    expect(result.activatable).toBe(true);
  });

  it("warns about more than 20 sets, but still allows the plan", async () => {
    const result = await check({ target_sets: 25 });
    expect(result.warnings.map((w) => w.code)).toContain("INVALID_SET_COUNT");
    expect(result.warnings[0].message).toContain("25 Sätze");
    expect(result.activatable).toBe(true);
  });

  it("warns about more than 100 repetitions, but still allows the plan", async () => {
    const result = await check({ rep_min: 100, rep_max: 150 });
    expect(result.warnings.map((w) => w.code)).toContain("INVALID_REP_RANGE");
    expect(result.activatable).toBe(true);
  });

  it("still blocks what is impossible: more than 50 sets", async () => {
    const h = harness("empty");
    const base = session("Training");
    const failure = await h.fails("create_training_plan", {
      request_id: "r2",
      name: "Zu viel",
      sessions: [
        {
          ...base,
          exercises: [{ ...base.exercises[0], target_sets: 51 }],
        },
      ],
    });
    expect(failure.code).toBe("VALIDATION_ERROR");
  });

  it("names a missing repetition range once, not per exercise", async () => {
    const h = harness("empty");
    const result = (
      await h.ok("create_training_plan", {
        request_id: "r3",
        name: "Ohne Bereich",
        sessions: [
          {
            session_name: "Training",
            exercises: [
              {
                exercise_id: "plan-fx-bench",
                target_sets: 3,
                rest_seconds: 90,
              },
              { exercise_id: "plan-fx-row", target_sets: 3, rest_seconds: 90 },
            ],
          },
        ],
      })
    ).validation!;
    const hits = result.warnings.filter(
      (w) => w.code === "INVALID_REP_RANGE" && w.field === "rep_min",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("2 Übungen");
    expect(result.activatable).toBe(true);
  });

  it("names a missing pause once and says what the watch does", async () => {
    const h = harness("empty");
    const base = session("Training", ["plan-fx-bench", "plan-fx-row"]);
    const result = (
      await h.ok("create_training_plan", {
        request_id: "r4",
        name: "Ohne Pause",
        sessions: [base],
      })
    ).validation!;
    const hits = result.warnings.filter((w) => w.code === "INVALID_REST");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("120 Sekunden");
    expect(result.activatable).toBe(true);
  });
});
