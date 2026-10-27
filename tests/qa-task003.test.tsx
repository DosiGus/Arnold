import { afterEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildDashboardView,
  buildExerciseProgressView,
  buildWorkoutHistoryView,
} from "../src/server/arnold-presenter";
import { createArnoldSource } from "../src/server/storage-config";
import { ArnoldSheetsDataSource } from "../src/server/arnold-source";
import { ArnoldSheetsReadAdapter } from "../src/server/arnold-sheets-read-adapter";
import { MetricCard } from "../src/ui/components";
import { OverviewView } from "../src/ui/views/OverviewView";
import { dataset, oneWorkout } from "./fixtures/arnold-analytics";
import { fullDataset } from "./fixtures/arnold-dashboard";

const context = { generatedAt: "2026-10-25T09:00:00Z" };
afterEach(() => vi.restoreAllMocks());

describe("independent Task 003 integration requirements", () => {
  test("T3-01 the real environment factory accepts its documented configuration", () => {
    expect(() =>
      createArnoldSource(process.cwd(), {
        STORAGE_MODE: "arnold_sheets",
        MCP_ACCESS: "private",
        ARNOLD_SPREADSHEET_ID: "synthetic-arnold-v1-workbook",
      }),
    ).not.toThrow();
  });

  test("T3-01 source cache options do not leak into the strict adapter options", () => {
    expect(
      () =>
        new ArnoldSheetsDataSource({
          spreadsheetId: "synthetic-arnold-v1-workbook",
          cacheTtlMs: 0,
        }),
    ).not.toThrow();
  });

  test("T3-03 a valid bodyweight working set remains one working set", () => {
    const data = oneWorkout([
      { load_basis: "bodyweight_only", load_kg: null, reps: 10 },
    ]);
    const overview = buildDashboardView(data, context);
    const history = buildWorkoutHistoryView(data, context);
    expect(history.workouts[0].working_set_count).toBe(1);
    expect(overview.kpis.find((k) => k.key === "working_sets")?.value).toBe(1);
  });

  test("T3-03 uncomputable volume cannot reduce a known working-set count", () => {
    const data = oneWorkout([
      { load_kg: 70, reps: 10 },
      { load_basis: "bodyweight_only", load_kg: null, reps: 10 },
    ]);
    expect(
      buildDashboardView(data, context).kpis.find(
        (k) => k.key === "working_sets",
      )?.value,
    ).toBe(2);
  });

  test("T3-04 a max-load KPI states that its value is per dumbbell", () => {
    const data = oneWorkout([
      {
        load_basis: "per_implement",
        load_kg: 20,
        implement_count: 2,
        reps: 10,
      },
    ]);
    const view = buildExerciseProgressView(data, context, "ex-bar-press");
    const kpi = view.kpis.find((k) => k.key === "max_comparable_load")!;
    expect(renderToStaticMarkup(<MetricCard metric={kpi} />)).toContain(
      "pro Hantel",
    );
  });

  test("T3-04 a valid 1RM still displays its essential per-dumbbell caveat", () => {
    const data = oneWorkout([
      {
        load_basis: "per_implement",
        load_kg: 20,
        implement_count: 2,
        reps: 10,
      },
    ]);
    const view = buildExerciseProgressView(
      data,
      context,
      "ex-bar-press",
      "estimated_1rm",
    );
    const kpi = view.kpis.find((k) => k.key === "best_estimated_1rm")!;
    expect(kpi.note).toContain("pro Hantel");
    expect(renderToStaticMarkup(<MetricCard metric={kpi} />)).toContain(
      "pro Hantel",
    );
  });

  test("T3-06 a dashboard date filter also restricts its recent sessions", () => {
    const view = buildDashboardView(fullDataset(), context, {
      filter: { from: "2030-01-01", to: "2030-01-31" },
    });
    expect(view.totals.workouts_in_period).toBe(0);
    expect(view.recent_workouts).toEqual([]);
  });

  test("T3-06 the overview offers the required period selection", () => {
    const view = buildDashboardView(fullDataset(), context);
    const html = renderToStaticMarkup(
      <OverviewView
        view={view}
        onOpenWorkout={() => {}}
        onOpenProgress={() => {}}
      />,
    );
    expect(html).toContain('type="date"');
  });

  test("T3-07 invalidating a pending read cannot repopulate the cache with that old read", async () => {
    const oldData = dataset();
    const freshData = fullDataset();
    let finish!: (value: typeof oldData) => void;
    const read = vi
      .spyOn(ArnoldSheetsReadAdapter.prototype, "getDataset")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(freshData);
    const source = new ArnoldSheetsDataSource({
      spreadsheetId: "synthetic-arnold-v1-workbook",
    });
    const pending = source.load();
    source.invalidate();
    finish(oldData);
    await pending;
    const next = await source.load();
    expect(read).toHaveBeenCalledTimes(2);
    expect(next.dataset).toBe(freshData);
  });
});
