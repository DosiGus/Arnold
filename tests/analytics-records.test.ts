import { describe, expect, test } from "vitest";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import {
  dataset,
  exercise,
  plan,
  planItem,
  set,
  workout,
  STAMP,
} from "./fixtures/arnold-analytics";

type Entry = { date: string; sets: Record<string, unknown>[] };

/** Builds one completed workout per entry, with stable ids in date order. */
function history(entries: Entry[], parts: Record<string, unknown> = {}) {
  const workouts = entries.map((entry, index) =>
    workout({
      workout_id: `w-${index + 1}`,
      workout_date_local: entry.date,
    }),
  );
  const sets = entries.flatMap((entry, index) =>
    entry.sets.map((raw, position) =>
      set({
        set_id: `s-${index + 1}-${position + 1}`,
        workout_id: `w-${index + 1}`,
        set_number: position + 1,
        ...raw,
      }),
    ),
  );
  return dataset({ workouts, sets, ...parts });
}

const recordsOf = (entries: Entry[]) =>
  buildArnoldDashboardAnalytics(history(entries)).records;

describe("personal records", () => {
  test("the first valid value establishes the record", () => {
    const records = recordsOf([
      { date: "2026-01-05", sets: [{ load_kg: 70, reps: 8 }] },
    ]);
    expect(records.max_load).toHaveLength(1);
    expect(records.max_load[0].value).toBe(70);
    expect(records.max_load[0].kind).toBe("initial");
    expect(records.max_load[0].previous_value).toBeNull();
    expect(records.max_load[0].improvement).toBeNull();
    expect(records.max_load[0].achieved_on).toBe("2026-01-05");
  });

  test("a higher load is reported as an improvement over the previous value", () => {
    const records = recordsOf([
      { date: "2026-01-05", sets: [{ load_kg: 70, reps: 8 }] },
      { date: "2026-01-12", sets: [{ load_kg: 75, reps: 8 }] },
    ]);
    expect(records.max_load[0].value).toBe(75);
    expect(records.max_load[0].previous_value).toBe(70);
    expect(records.max_load[0].improvement).toBe(5);
    expect(records.max_load[0].kind).toBe("improvement");
    expect(
      records.events_in_period.filter((event) => event.metric === "max_load"),
    ).toHaveLength(2);
  });

  test("repeating a record is not a new record", () => {
    const records = recordsOf([
      { date: "2026-01-05", sets: [{ load_kg: 70, reps: 8 }] },
      { date: "2026-01-12", sets: [{ load_kg: 70, reps: 8 }] },
      { date: "2026-01-19", sets: [{ load_kg: 70, reps: 8 }] },
    ]);
    expect(records.max_load[0].value).toBe(70);
    expect(records.max_load[0].achieved_on).toBe("2026-01-05");
    expect(records.max_load[0].occurrences).toBe(3);
    expect(records.max_load[0].kind).toBe("initial");
    expect(
      records.events_in_period.filter((event) => event.metric === "max_load"),
    ).toHaveLength(1);
  });

  test("a lower load afterwards leaves the record untouched", () => {
    const records = recordsOf([
      { date: "2026-01-05", sets: [{ load_kg: 80, reps: 5 }] },
      { date: "2026-01-12", sets: [{ load_kg: 60, reps: 5 }] },
    ]);
    expect(records.max_load[0].value).toBe(80);
    expect(records.max_load[0].achieved_on).toBe("2026-01-05");
  });

  test("execution variants of one exercise keep separate records", () => {
    const records = recordsOf([
      {
        date: "2026-01-05",
        sets: [
          {
            load_kg: 30,
            load_basis: "per_implement",
            implement_count: 2,
            reps: 8,
          },
          {
            load_kg: 34,
            load_basis: "per_implement",
            implement_count: 1,
            execution_mode: "unilateral",
            side: "right",
            reps: 8,
          },
          {
            load_kg: 32,
            load_basis: "per_implement",
            implement_count: 1,
            execution_mode: "unilateral",
            side: "left",
            reps: 8,
          },
        ],
      },
    ]);
    expect(records.max_load).toHaveLength(3);
    expect(
      records.max_load.map((record) => [
        record.comparability?.execution_mode,
        record.comparability?.side,
        record.value,
      ]),
    ).toEqual([
      ["bilateral_simultaneous", null, 30],
      ["unilateral", "left", 32],
      ["unilateral", "right", 34],
    ]);
  });

  test("a bilateral and a unilateral curl are never compared", () => {
    const records = recordsOf([
      { date: "2026-01-05", sets: [{ load_kg: 40, reps: 8 }] },
      {
        date: "2026-01-12",
        sets: [
          {
            load_kg: 20,
            execution_mode: "unilateral",
            side: "right",
            reps: 8,
          },
        ],
      },
    ]);
    expect(records.max_load).toHaveLength(2);
    expect(records.max_load.every((record) => record.kind === "initial")).toBe(
      true,
    );
  });

  test("repetition records are tied to one comparable load", () => {
    const records = recordsOf([
      { date: "2026-01-05", sets: [{ load_kg: 70, reps: 8 }] },
      { date: "2026-01-12", sets: [{ load_kg: 70, reps: 10 }] },
      { date: "2026-01-19", sets: [{ load_kg: 80, reps: 6 }] },
    ]);
    expect(
      records.max_reps_at_load.map((record) => [
        record.at_load_kg,
        record.value,
      ]),
    ).toEqual([
      [70, 10],
      [80, 6],
    ]);
  });

  test("an estimated one-rep maximum is tracked as its own record", () => {
    const records = recordsOf([
      { date: "2026-01-05", sets: [{ load_kg: 90, reps: 8 }] },
      { date: "2026-01-12", sets: [{ load_kg: 100, reps: 3 }] },
    ]);
    expect(records.estimated_1rm[0].value).toBe(114);
    expect(records.estimated_1rm[0].achieved_on).toBe("2026-01-05");
    expect(records.estimated_1rm[0].reps).toBe(8);
  });

  test("warm-up and drop sets never set a record", () => {
    const records = recordsOf([
      {
        date: "2026-01-05",
        sets: [
          { set_type: "warmup", load_kg: 200, reps: 1 },
          { set_type: "drop", load_kg: 150, reps: 5 },
          { set_type: "working", load_kg: 70, reps: 5 },
        ],
      },
    ]);
    expect(records.max_load).toHaveLength(1);
    expect(records.max_load[0].value).toBe(70);
  });

  test("bodyweight and assistance work produce no load record", () => {
    const records = recordsOf([
      {
        date: "2026-01-05",
        sets: [
          { load_kg: null, load_basis: "bodyweight_only", reps: 12 },
          { load_kg: 25, load_basis: "assistance", reps: 8 },
        ],
      },
    ]);
    expect(records.max_load).toEqual([]);
    expect(records.estimated_1rm).toEqual([]);
  });

  test("volume records are per exercise, session and channel, without warm-ups", () => {
    const records = recordsOf([
      {
        date: "2026-01-05",
        sets: [
          { set_type: "warmup", load_kg: 40, reps: 10 },
          { load_kg: 70, reps: 10 },
          { load_kg: 70, reps: 10, set_number: 3 },
        ],
      },
      { date: "2026-01-12", sets: [{ load_kg: 80, reps: 10 }] },
    ]);
    expect(records.exercise_workout_volume).toHaveLength(1);
    expect(records.exercise_workout_volume[0].value).toBe(1400);
    expect(records.exercise_workout_volume[0].channel).toBe("free_weight");
    expect(records.exercise_workout_volume[0].achieved_on).toBe("2026-01-05");
  });

  test("an exercise keeps one record history across plan versions", () => {
    const analytics = buildArnoldDashboardAnalytics(
      dataset({
        exercises: [exercise()],
        plans: [
          plan({
            plan_version_id: "plan-v1",
            version_no: 1,
            status: "archived",
            activated_at_utc: STAMP,
            retired_at_utc: "2026-03-01T00:00:00Z",
          }),
          plan({
            plan_version_id: "plan-v2",
            version_no: 2,
            status: "active",
            activated_at_utc: "2026-03-01T00:00:00Z",
          }),
        ],
        planItems: [
          planItem({ plan_item_id: "item-v1", plan_version_id: "plan-v1" }),
          planItem({
            plan_item_id: "item-v2",
            plan_version_id: "plan-v2",
            session_id: "session-b",
            session_name: "Testeinheit B",
          }),
        ],
        workouts: [
          workout({
            workout_id: "w-jan",
            workout_date_local: "2026-01-05",
            plan_version_id: "plan-v1",
            session_id: "session-a",
          }),
          workout({
            workout_id: "w-apr",
            workout_date_local: "2026-04-06",
            plan_version_id: "plan-v2",
            session_id: "session-b",
          }),
        ],
        sets: [
          set({
            set_id: "s-jan",
            workout_id: "w-jan",
            plan_item_id: "item-v1",
            load_kg: 70,
            reps: 8,
          }),
          set({
            set_id: "s-apr",
            workout_id: "w-apr",
            plan_item_id: "item-v2",
            load_kg: 85,
            reps: 8,
          }),
        ],
      }),
    );
    expect(analytics.records.max_load).toHaveLength(1);
    expect(analytics.records.max_load[0].value).toBe(85);
    expect(analytics.records.max_load[0].previous_value).toBe(70);
    expect(analytics.exercise_progress[0].workouts.value).toBe(2);
  });

  test("records are unavailable without eligible working sets", () => {
    const records = recordsOf([]);
    expect(records.status).toBe("not_available");
    expect(records.reasons).toContain("no_eligible_workouts");
    expect(records.max_load).toEqual([]);
  });
});
