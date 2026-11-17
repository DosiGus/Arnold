/**
 * Rückblick after a run (UX-014): only a real, recent, completed run; distance,
 * duration and pace only when stored; once, through the same receipt as the
 * strength recap; the younger of a new workout and a new run wins.
 * Synthetic data, fixed dates, no clock.
 */
import { describe, expect, it } from "vitest";
import { newestRun, recapKind, computeRunRecap } from "../src/analytics/recap";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import { createFixtureLogging } from "../src/server/workout/fixture";
import { recapFor } from "../src/server/workout/recap";
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../src/shared/arnold-schema-v1";
import { ArnoldRecapSchema } from "../src/shared/recap-contract";

const TODAY = "2026-11-03";
const context = { generatedAt: "2026-11-03T18:00:00Z" };
const technical = (stamp: string) => ({
  created_at_utc: stamp,
  updated_at_utc: stamp,
  row_revision: 1,
});

function runRows(
  id: string,
  date: string,
  stamp: string,
  over: {
    status?: "completed" | "planned";
    timer_s?: number | null;
    distance_m?: number | null;
    watch?: boolean;
  } = {},
) {
  const status = over.status ?? "completed";
  const done = status === "completed";
  return {
    workout: {
      workout_id: id,
      workout_date_local: date,
      timezone: "Europe/Berlin",
      started_at_utc: done ? stamp : null,
      ended_at_utc: done ? stamp : null,
      plan_version_id: null,
      session_id: null,
      session_name_snapshot: null,
      status,
      source: "chat" as const,
      notes: null,
      activity_type: "run" as const,
      ...(over.watch ? { client_session_id: `watch-${id}` } : {}),
      ...technical(stamp),
    },
    run: {
      workout_id: id,
      run_type: "base" as const,
      environment: "outdoor" as const,
      prescription: null,
      rationale: null,
      rules_version: null,
      timer_s: done ? (over.timer_s === undefined ? 2700 : over.timer_s) : null,
      elapsed_s: done ? 2800 : null,
      distance_m: done
        ? over.distance_m === undefined
          ? 7000
          : over.distance_m
        : null,
      distance_source: done ? ("manual" as const) : null,
      ascent_m: null,
      descent_m: null,
      cadence_spm: null,
      calories_kcal: null,
      te_aerobic: null,
      te_anaerobic: null,
      rpe: null,
      splits_100m: null,
      pause_count: null,
      result_source: done ? ("chat" as const) : null,
      hr_status: done ? ("not_provided" as const) : null,
      hr_avg_bpm: null,
      hr_max_bpm: null,
      hr_zone_seconds: null,
      ...technical(stamp),
    },
  };
}

function withRuns(
  base: ArnoldDataset,
  runs: ReturnType<typeof runRows>[],
): ArnoldDataset {
  const merged = {
    ...base,
    workouts: [...base.workouts, ...runs.map((r) => r.workout)],
    runs: [...base.runs, ...runs.map((r) => r.run)],
  };
  // The schema rejects a completed run without times and distance, so a run
  // with unknown values is built unparsed: the reader must still cope.
  const complete = runs.every(
    (r) =>
      r.workout.status !== "completed" ||
      (r.run.timer_s !== null && r.run.distance_m !== null),
  );
  return complete
    ? ArnoldDatasetSchema.parse(merged)
    : (merged as ArnoldDataset);
}

const base = demoHistoryDataset(TODAY);
const newestStrength = [...base.workouts]
  .filter((w) => w.status === "completed")
  .sort((a, b) => (a.workout_date_local < b.workout_date_local ? -1 : 1))
  .at(-1)!;
const view = (d: ArnoldDataset) =>
  buildDashboardView(d, context, { reference_date: TODAY });

describe("run recap selection", () => {
  it("never without a real new, completed run", () => {
    expect(computeRunRecap(base, TODAY)).toBeNull();
    const planned = withRuns(base, [
      runRows("r-plan", TODAY, "2026-11-03T08:00:00Z", { status: "planned" }),
    ]);
    expect(computeRunRecap(planned, TODAY)).toBeNull();
    const old = withRuns(base, [
      runRows("r-old", "2026-10-01", "2026-10-01T08:00:00Z"),
    ]);
    expect(newestRun(old, TODAY)).toBeNull();
    expect(computeRunRecap(old, null)).toBeNull();
    // A run after the reference day is not new yet.
    const future = withRuns(base, [
      runRows("r-fut", "2026-11-05", "2026-11-05T08:00:00Z"),
    ]);
    expect(newestRun(future, TODAY)).toBeNull();
  });

  it("delivers distance, duration and pace; unknown values are left out", () => {
    const d = withRuns(base, [
      runRows("r-1", TODAY, "2026-11-03T08:00:00Z", { watch: true }),
    ]);
    expect(computeRunRecap(d, TODAY)).toMatchObject({
      workout_id: "r-1",
      title: "Grundlage",
      from_watch: true,
      distance_m: 7000,
      duration_s: 2700,
    });
    expect(computeRunRecap(d, TODAY)!.pace_s_per_km).toBeCloseTo(385.714, 2);
    const noDistance = withRuns(base, [
      runRows("r-2", TODAY, "2026-11-03T08:00:00Z", { distance_m: null }),
    ]);
    expect(computeRunRecap(noDistance, TODAY)).toMatchObject({
      distance_m: null,
      duration_s: 2700,
      pace_s_per_km: null,
    });
    const nothing = withRuns(base, [
      runRows("r-3", TODAY, "2026-11-03T08:00:00Z", {
        distance_m: null,
        timer_s: null,
      }),
    ]);
    expect(computeRunRecap(nothing, TODAY)).toMatchObject({
      distance_m: null,
      duration_s: null,
      pace_s_per_km: null,
    });
  });

  it("the younger of a new workout and a new run wins", () => {
    // Pin every strength workout to one known moment: 2026-11-01, 10:00 UTC.
    const pinned = ArnoldDatasetSchema.parse({
      ...base,
      workouts: base.workouts.map((w) => ({
        ...w,
        workout_date_local: "2026-11-01",
        created_at_utc: "2026-11-01T10:00:00Z",
        updated_at_utc: "2026-11-01T10:00:00Z",
      })),
    });
    expect(recapKind(pinned, TODAY)).toBe("strength");
    const newerDay = withRuns(pinned, [
      runRows("r-a", "2026-11-02", "2026-11-02T08:00:00Z"),
    ]);
    expect(recapKind(newerDay, TODAY)).toBe("run");
    const olderDay = withRuns(pinned, [
      runRows("r-b", "2026-10-30", "2026-10-30T08:00:00Z"),
    ]);
    expect(recapKind(olderDay, TODAY)).toBe("strength");
    // Same day: the one saved later wins.
    const sameLater = withRuns(pinned, [
      runRows("r-c", "2026-11-01", "2026-11-01T18:00:00Z"),
    ]);
    expect(recapKind(sameLater, TODAY)).toBe("run");
    const sameEarlier = withRuns(pinned, [
      runRows("r-d", "2026-11-01", "2026-11-01T06:00:00Z"),
    ]);
    expect(recapKind(sameEarlier, TODAY)).toBe("strength");
  });
});

describe("run recap, once", () => {
  const dataset = withRuns(
    // Drop strength so only the run is new.
    ArnoldDatasetSchema.parse({
      ...base,
      workouts: base.workouts.map((w) => ({
        ...w,
        workout_date_local: "2026-09-01",
      })),
    }),
    [runRows("r-once", TODAY, "2026-11-03T08:00:00Z", { watch: true })],
  );

  it("appears until marked, then never again; the strength one stays unseen", async () => {
    const runtime = createFixtureLogging(dataset);
    const v = view(dataset);
    const first = await recapFor(dataset, v, TODAY, runtime.service);
    expect(first).not.toBeNull();
    expect(() => ArnoldRecapSchema.parse(first)).not.toThrow();
    expect(first).toMatchObject({
      kind: "run",
      workout_id: "r-once",
      records: [],
      week_goal: null,
      suggestion: null,
      next_session_id: null,
      run: { distance_m: 7000, duration_s: 2700 },
    });
    // Reading writes nothing.
    expect(await recapFor(dataset, v, TODAY, runtime.service)).not.toBeNull();
    const marked = await runtime.service.markRecapSeen({
      workout_id: "r-once",
    });
    expect(marked).toMatchObject({ ok: true, replayed: false });
    expect(await recapFor(dataset, v, TODAY, runtime.service)).toBeNull();
    expect(
      await runtime.service.markRecapSeen({ workout_id: "r-once" }),
    ).toMatchObject({ ok: true, replayed: true });
    expect(runtime.store.operations.size).toBe(1);
    expect(await runtime.store.read()).toEqual(dataset);
  });

  it("refuses an unfinished run and shows nothing without a run", async () => {
    const planned = withRuns(base, [
      runRows("r-p", TODAY, "2026-11-03T08:00:00Z", { status: "planned" }),
    ]);
    const runtime = createFixtureLogging(planned);
    expect(
      await runtime.service.markRecapSeen({ workout_id: "r-p" }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATUS_TRANSITION" },
    });
    const noRun = await recapFor(
      planned,
      view(planned),
      TODAY,
      runtime.service,
    );
    // Whatever is shown is the strength recap, never the planned run.
    expect(noRun?.kind ?? "strength").toBe("strength");
    expect(noRun?.workout_id).not.toBe("r-p");
  });

  it("a failing receipt read shows nothing", async () => {
    const v = view(dataset);
    const failing = {
      isRecapSeen: async () => {
        throw new Error("down");
      },
    };
    expect(await recapFor(dataset, v, TODAY, failing)).toBeNull();
  });
});
