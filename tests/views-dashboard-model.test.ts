/**
 * "Heute" of the overview (src/views/model/dashboard.ts): a runner without
 * strength sessions has a plan, a run does not tick off strength, and without
 * the user's time zone nothing counts as today's. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import type { ArnoldDashboardView } from "../src/shared/arnold-view";
import { dashboardModel } from "../src/views/model/dashboard";

const base = buildDashboardView(
  demoHistoryDataset("2026-11-03"),
  { generatedAt: "2026-11-03T18:00:00Z" },
  { reference_date: "2026-11-03" },
);

type Today = NonNullable<ArnoldDashboardView["home"]["today"]>;

const view = (
  today: Partial<Today>,
  home: Partial<ArnoldDashboardView["home"]> = {},
  source: "timezone" | "fallback" = "timezone",
): ArnoldDashboardView => ({
  ...base,
  reference: {
    date: "2026-11-03",
    timezone: source === "timezone" ? "Europe/Berlin" : null,
    source,
  },
  home: {
    ...base.home,
    ...home,
    today: {
      date: "2026-11-03",
      done: [],
      planned_runs: [],
      next_run: null,
      has_run_plan: false,
      ...today,
    },
  },
});

const planned = {
  workout_id: "r-1",
  date: "2026-11-03",
  name: "Grundlage",
  planned_seconds: 2400,
  planned_distance_m: null,
};
const doneRun = {
  kind: "run" as const,
  workout_id: "r-0",
  date: "2026-11-03",
  name: "Lockerer Lauf",
  working_sets: null,
  timer_s: null,
  distance_m: null,
};

describe("today on the overview", () => {
  it("shows a runner the planned run, never 'no plan'", () => {
    const d = dashboardModel(
      view(
        { has_run_plan: true, planned_runs: [planned] },
        { next_session: null },
      ),
    );
    expect(d.hasPlan).toBe(true);
    expect(d.today).toEqual([
      expect.objectContaining({
        kind: "run",
        title: "Grundlage",
        sub: "40 Min.",
        state: "next",
        ask: "Zeig mir meinen heutigen Lauf.",
      }),
    ]);
    expect(d.todayNote).toBeUndefined();
  });

  it("names the next run on a day without one", () => {
    const d = dashboardModel(
      view(
        {
          has_run_plan: true,
          next_run: { ...planned, date: "2026-11-06" },
        },
        { next_session: null },
      ),
    );
    expect(d.today).toEqual([]);
    expect(d.todayNote?.text).toBe(
      "Heute ist kein Lauf geplant. Nächster Lauf: Fr, 6. Nov. · Grundlage · 40 Min.",
    );
  });

  it("keeps strength open after a run and never marks the next unit done", () => {
    const d = dashboardModel(view({ done: [doneRun] }));
    expect(d.today.map((t) => [t.kind, t.state, t.sub])).toEqual([
      ["strength", "next", expect.stringContaining("Nächste Einheit")],
      ["run", "done", "erledigt"],
    ]);
  });

  it("shows the strength unit that was done, by its own name", () => {
    const d = dashboardModel(
      view({
        done: [
          { ...doneRun, kind: "strength", name: "Legs", working_sets: 12 },
        ],
      }),
    );
    expect(d.today.map((t) => [t.title, t.state, t.sub])).toEqual([
      ["Legs", "done", "12 Arbeitssätze"],
    ]);
  });

  it("counts nothing as today's without the user's time zone", () => {
    const d = dashboardModel(
      view({ done: [doneRun], planned_runs: [planned] }, {}, "fallback"),
    );
    expect(d.today.map((t) => [t.kind, t.state])).toEqual([
      ["strength", "next"],
    ]);
  });

  it("shows mobility adherence only when something is known", () => {
    const mobility = (ratio: number | null) => ({
      morning: null,
      sessions_open: 0,
      line: "x",
      adherence: {
        ratio,
        streak_days: 0,
        planned_count: ratio === null ? 0 : 10,
        done_count: ratio === null ? 0 : 8,
        days: 28,
      },
    });
    expect(
      dashboardModel(view({}, { mobility: mobility(0.8) })).mobilityNote,
    ).toBe(
      "Mobility-Dranbleiben: 8 von 10 geplanten Routinen (letzte 28 Tage)",
    );
    expect(
      dashboardModel(view({}, { mobility: mobility(null) })).mobilityNote,
    ).toBeUndefined();
  });
});
