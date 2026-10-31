/**
 * B5: the weekly goal counts training days (D5), from every workout of the
 * week, not only from the few in `recent_workouts`.
 *
 * The expected values are computed here independently from the raw rows,
 * with their own Monday arithmetic, and compared with what the engine and the
 * presenter deliver.
 */
import { describe, expect, it } from "vitest";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { dataset, exercise, set, workout } from "./fixtures/arnold-analytics";

type Row = { id: string; date: string; status: string };

// Three weeks. Two sessions on Tuesday 2026-10-13, a cancelled and an
// in-progress session that must not count, and enough sessions that most of
// them fall outside `recent_workouts`.
const rows: Row[] = [
  { id: "w-01", date: "2026-10-05", status: "completed" },
  { id: "w-02", date: "2026-10-07", status: "completed" },
  { id: "w-03", date: "2026-10-09", status: "completed" },
  { id: "w-04", date: "2026-10-11", status: "cancelled" },
  { id: "w-05", date: "2026-10-12", status: "completed" },
  { id: "w-06", date: "2026-10-13", status: "completed" },
  { id: "w-07", date: "2026-10-13", status: "completed" },
  { id: "w-08", date: "2026-10-15", status: "completed" },
  { id: "w-09", date: "2026-10-18", status: "completed" },
  { id: "w-10", date: "2026-10-20", status: "completed" },
  { id: "w-11", date: "2026-10-22", status: "in_progress" },
  { id: "w-12", date: "2026-10-25", status: "completed" },
];

const data = dataset({
  exercises: [exercise()],
  workouts: rows.map((row) =>
    workout({
      workout_id: row.id,
      workout_date_local: row.date,
      status: row.status,
    }),
  ),
  sets: rows.map((row) => set({ set_id: `s-${row.id}`, workout_id: row.id })),
});

/** Monday of the ISO week, by plain calendar arithmetic on the date string. */
function monday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

function expectedByWeek(): Map<string, string[]> {
  const byWeek = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.status !== "completed") continue;
    const key = monday(row.date);
    byWeek.set(key, (byWeek.get(key) ?? new Set()).add(row.date));
  }
  return new Map([...byWeek].map(([week, dates]) => [week, [...dates].sort()]));
}

describe("weekly trained_dates", () => {
  const view = buildDashboardView(
    data,
    { generatedAt: "2026-10-26T09:00:00Z" },
    { reference_date: "2026-10-25" },
  );

  it("matches an independent count from all workouts", () => {
    const expected = expectedByWeek();
    expect(expected.get("2026-10-12")).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-15",
      "2026-10-18",
    ]);
    for (const week of view.weeks) {
      const dates = expected.get(week.week_start) ?? [];
      expect(week.trained_dates, week.week_start).toEqual(dates);
      expect(week.training_days, week.week_start).toBe(dates.length);
    }
    expect(view.weeks.map((week) => week.week_start)).toEqual([
      ...expected.keys(),
    ]);
  });

  it("counts two sessions on one day as one training day", () => {
    const week = view.weeks.find((w) => w.week_start === "2026-10-12")!;
    expect(week.workouts).toBe(5);
    expect(week.training_days).toBe(4);
    expect(
      week.trained_dates.filter((date) => date === "2026-10-13"),
    ).toHaveLength(1);
  });

  it("does not depend on the short recent_workouts list", () => {
    expect(view.recent_workouts.length).toBeLessThan(
      rows.filter((row) => row.status === "completed").length,
    );
    const all = view.weeks.flatMap((week) => week.trained_dates);
    expect(all).toContain("2026-10-05");
    expect(view.recent_workouts.some((w) => w.date === "2026-10-05")).toBe(
      false,
    );
  });

  it("is passed through by the presenter unchanged", () => {
    const week = view.weeks.at(-1)!;
    expect(week.trained_dates).toEqual(["2026-10-20", "2026-10-25"]);
  });
});
