/**
 * B18: the progress comparison comes ready from the engine.
 *
 * The expected numbers are computed here from the raw rows with their own
 * arithmetic (per-day maximum, Epley, plain sums), independent of the engine,
 * and compared with what the engine and the presenter deliver.
 */
import { describe, expect, it } from "vitest";
import { buildExerciseProgressView } from "../src/server/arnold-presenter";
import { ProgressComparisonSchema } from "../src/analytics/types";
import { dataset, exercise, set, workout } from "./fixtures/arnold-analytics";

type RawSet = {
  date: string;
  load: number;
  reps: number;
  basis: "total" | "per_implement";
};

// Barbell on four days (two sessions on 2026-03-10), dumbbells on two days.
// The barbell has more working sets, so it is the class the load metrics use.
const ROWS: RawSet[] = [
  { date: "2026-03-02", load: 60, reps: 5, basis: "total" },
  { date: "2026-03-02", load: 62.5, reps: 5, basis: "total" },
  { date: "2026-03-05", load: 65, reps: 5, basis: "total" },
  { date: "2026-03-07", load: 24, reps: 10, basis: "per_implement" },
  { date: "2026-03-10", load: 67.5, reps: 4, basis: "total" },
  { date: "2026-03-10", load: 70, reps: 3, basis: "total" },
  { date: "2026-03-12", load: 26, reps: 8, basis: "per_implement" },
  { date: "2026-03-14", load: 72.5, reps: 5, basis: "total" },
];

function build(rows: RawSet[]) {
  // One workout per row, so the same day can hold two sessions.
  return dataset({
    exercises: [exercise()],
    workouts: rows.map((row, i) =>
      workout({ workout_id: `w-${i}`, workout_date_local: row.date }),
    ),
    sets: rows.map((row, i) =>
      set({
        set_id: `s-${i}`,
        workout_id: `w-${i}`,
        load_kg: row.load,
        reps: row.reps,
        load_basis: row.basis,
        implement_count: row.basis === "per_implement" ? 2 : 1,
      }),
    ),
  });
}

const CONTEXT = { generatedAt: "2026-03-15T09:00:00Z" };
const view = (rows: RawSet[], metric = "max_load" as const) =>
  buildExerciseProgressView(build(rows), CONTEXT, "ex-bar-press", metric);

/** Independent: per-day maximum of a value, then first against last day. */
function control(rows: RawSet[], value: (row: RawSet) => number | null) {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const v = value(row);
    if (v === null) continue;
    byDay.set(row.date, Math.max(byDay.get(row.date) ?? -Infinity, v));
  }
  const days = [...byDay.keys()].sort();
  const from = byDay.get(days[0])!;
  const to = byDay.get(days.at(-1)!)!;
  return {
    from_date: days[0],
    to_date: days.at(-1),
    from_value: from,
    to_value: to,
    delta: Math.round((to - from) * 100) / 100,
  };
}
const barbell = ROWS.filter((row) => row.basis === "total");
const round2 = (value: number) => Math.round(value * 100) / 100;

describe("progress comparison", () => {
  const result = view(ROWS);
  const byMetric = new Map(result.comparisons.map((c) => [c.metric, c]));

  it("compares max load within the barbell class only", () => {
    const expected = control(barbell, (row) => row.load);
    expect(expected).toEqual({
      from_date: "2026-03-02",
      to_date: "2026-03-14",
      from_value: 62.5,
      to_value: 72.5,
      delta: 10,
    });
    expect(byMetric.get("max_load")).toMatchObject({
      status: "valid",
      reason: null,
      unit: "kg",
      ...expected,
    });
    expect(byMetric.get("max_load")!.comparability_key).toContain("total");
  });

  it("compares the Epley estimate on the same days", () => {
    const epley = (row: RawSet) =>
      row.reps === 1 ? row.load : row.load * (1 + row.reps / 30);
    const expected = control(barbell, epley);
    const actual = byMetric.get("estimated_1rm")!;
    expect(actual.status).toBe("valid");
    expect(actual.from_date).toBe(expected.from_date);
    expect(actual.to_date).toBe(expected.to_date);
    expect(actual.from_value).toBeCloseTo(round2(expected.from_value), 2);
    expect(actual.to_value).toBeCloseTo(round2(expected.to_value), 2);
    expect(actual.delta).toBeCloseTo(expected.delta, 1);
  });

  it("refuses to compare volume across load bases", () => {
    expect(byMetric.get("nominal_volume")).toMatchObject({
      status: "not_available",
      reason: "comparison_mixed_load_basis",
      from_value: null,
      to_value: null,
      delta: null,
      comparability_key: null,
    });
  });

  it("compares repetitions per day across the whole exercise", () => {
    const sums = new Map<string, number>();
    for (const row of ROWS)
      sums.set(row.date, (sums.get(row.date) ?? 0) + row.reps);
    const days = [...sums.keys()].sort();
    expect(byMetric.get("total_reps")).toMatchObject({
      status: "valid",
      from_date: days[0],
      to_date: days.at(-1),
      from_value: sums.get(days[0]),
      to_value: sums.get(days.at(-1)!),
      delta: sums.get(days.at(-1)!)! - sums.get(days[0])!,
      unit: "reps",
    });
  });

  it("needs two days and says so", () => {
    const single = view([ROWS[0], ROWS[1]]);
    for (const comparison of single.comparisons)
      expect(comparison, comparison.metric).toMatchObject({
        status: "not_available",
        reason: "comparison_needs_two_dates",
        delta: null,
      });
  });

  it("passes the selected comparison through unchanged and well-formed", () => {
    expect(result.selected_comparison).toEqual(byMetric.get("max_load"));
    for (const comparison of result.comparisons)
      expect(ProgressComparisonSchema.safeParse(comparison).success).toBe(true);
    expect(result.comparisons.map((c) => c.metric)).toEqual(
      result.available_metrics.map((m) => m.key),
    );
  });
});
