import { describe, expect, it } from "vitest";
import { addDays } from "../src/analytics/period.js";
import { HARD_RUN_TYPES } from "../src/shared/run-contract.js";
import {
  COOLDOWN_S,
  TEMPO_MINUTES,
  WARMUP_S,
  checkRunWeek,
  longShareMax,
  scheduleRunWeek,
  weekPlanRun,
  type ScheduleRunWeekInput,
} from "../src/analytics/running/index.js";
import {
  TODAY,
  profile,
  scheduleInput,
  session,
  steadyHistory,
} from "./analytics-running-week-helpers.js";

const d = (offset: number) => addDays(TODAY, offset);
const sum = (s: ReturnType<typeof scheduleRunWeek>) =>
  s.runs.reduce((t, r) => t + r.minutes, 0);

/** Hybrid athlete: 10 km goal, three runs a week, 150 minutes, strength on the side. */
const hybrid = (over: Partial<ScheduleRunWeekInput> = {}) =>
  scheduleInput({
    profile: profile({
      goal: "10k",
      race_date: addDays(TODAY, 80),
      runs_per_week: 3,
      base_minutes_per_week: 150,
    }),
    history: steadyHistory(2, 50, 3),
    // two easy runs and the long run; the tempo variant is below
    sessions: [
      session(1, "base", [40, 45]),
      session(2, "base", [40, 45]),
      session(3, "long", [60, 75]),
    ],
    block_start: d(-20),
    ...over,
  });

describe("RUN-013: long run share by number of runs", () => {
  it("is 30 / 35 / 40 / 50 % at 5+ / 4 / 3 / 2 runs; one run has no real limit", () => {
    expect([6, 5, 4, 3, 2, 1].map(longShareMax)).toEqual([
      0.3, 0.3, 0.35, 0.4, 0.5, 1,
    ]);
  });
});

describe("RUN-013: hybrid athlete with three runs a week", () => {
  it("keeps the long run a long run in a build week without a pause", () => {
    const schedule = scheduleRunWeek(hybrid());
    expect(schedule.context.deload).toBe(false);
    expect(schedule.context.reentry).toBe("none");
    expect(schedule.check.violations).toEqual([]);
    expect(schedule.runs).toHaveLength(3);
    const long = schedule.runs.find((r) => r.session_id === "s-3")!;
    expect(long.run_type).toBe("long");
    expect(long.minutes).toBeGreaterThanOrEqual(60);
    expect(long.minutes).toBeLessThanOrEqual(0.4 * sum(schedule) + 1e-6);
    expect(
      schedule.notes.some(
        (n) => n.code === "session_converted" && n.session_id === "s-3",
      ),
    ).toBe(false);
  });

  it("keeps the long run next to a tempo run (level 1) as well", () => {
    const schedule = scheduleRunWeek(
      hybrid({
        sessions: [
          session(1, "base", [40, 45]),
          session(2, "tempo", [30, 50], { level: 1 }),
          session(3, "long", [60, 75]),
        ],
      }),
    );
    expect(schedule.check.violations).toEqual([]);
    expect(schedule.runs).toHaveLength(3);
    expect(schedule.runs.find((r) => r.session_id === "s-3")!.run_type).toBe(
      "long",
    );
  });

  it("keeps three runs in a deload week, each shorter", () => {
    const schedule = scheduleRunWeek(
      hybrid({ history: steadyHistory(3, 50, 3) }),
    );
    expect(schedule.context.deload).toBe(true);
    expect(schedule.check.violations).toEqual([]);
    expect(schedule.runs).toHaveLength(3);
    expect(schedule.dropped).toEqual([]);
    expect(sum(schedule)).toBeLessThanOrEqual(schedule.context.volume.minutes);
  });

  it("keeps three runs when re-entering after an 11-day pause", () => {
    const schedule = scheduleRunWeek(
      hybrid({ history: steadyHistory(3, 50, 3, d(-11)) }),
    );
    expect(schedule.context.reentry).toBe("short");
    expect(schedule.check.violations).toEqual([]);
    expect(schedule.runs).toHaveLength(3);
    expect(schedule.dropped).toEqual([]);
    expect(sum(schedule)).toBeLessThanOrEqual(schedule.context.volume.minutes);
    // shortened, not left out: every run is shorter than a normal week's run
    const normal = scheduleRunWeek(hybrid());
    expect(sum(schedule)).toBeLessThan(sum(normal));
  });
});

describe("RUN-013: two runs a week", () => {
  it("allows a long run of up to 50 % of the week", () => {
    const schedule = scheduleRunWeek(
      scheduleInput({
        profile: profile({
          runs_per_week: 2,
          base_minutes_per_week: 120,
          longest_run_4w_min: 60,
        }),
        history: steadyHistory(2, 60, 2),
        sessions: [session(1, "base", [60, 60]), session(2, "long", [60, 75])],
      }),
    );
    expect(schedule.check.violations).toEqual([]);
    const long = schedule.runs.find((r) => r.run_type === "long")!;
    expect(long).toBeDefined();
    expect(long.minutes / sum(schedule)).toBeGreaterThan(0.4);
    expect(long.minutes / sum(schedule)).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});

describe("RUN-013: volume cap shortens before it drops", () => {
  const capped = (
    history: ScheduleRunWeekInput["history"],
    sessions = [
      session(1, "base", [40, 45]),
      session(2, "tempo", [45, 50]),
      session(3, "base", [40, 45]),
    ],
  ) => scheduleRunWeek(hybrid({ history, sessions }));
  const minTempo =
    (WARMUP_S.intermediate + COOLDOWN_S) / 60 + TEMPO_MINUTES.intermediate.min;

  it("cuts the hard session first: the easy runs keep their length", () => {
    // cap 128 against 135 planned minutes: the tempo run alone can take the cut
    const schedule = capped(steadyHistory(3, 57, 3));
    expect(schedule.context.deload).toBe(true);
    expect(schedule.context.volume.minutes).toBe(128);
    expect(schedule.dropped).toEqual([]);
    expect(schedule.runs).toHaveLength(3);
    expect(schedule.runs.find((r) => r.run_type === "tempo")!.minutes).toBe(
      minTempo,
    );
    for (const r of schedule.runs.filter((x) => x.run_type === "base"))
      expect(r.minutes).toBe(45);
    expect(schedule.check.violations).toEqual([]);
  });

  it("shortens the easy runs to their minimum too before anything is dropped", () => {
    const schedule = capped(steadyHistory(3, 45, 3));
    expect(schedule.context.volume.minutes).toBe(101);
    expect(schedule.dropped).toEqual([]);
    expect(schedule.runs).toHaveLength(3);
    expect(schedule.runs.find((r) => r.run_type === "tempo")!.minutes).toBe(
      minTempo,
    );
    expect(sum(schedule)).toBeLessThanOrEqual(101);
    expect(schedule.check.violations).toEqual([]);
  });

  it("drops the hard session, not an easy run, when even the minimum lengths do not fit", () => {
    // cap 67 against 30 + 37 + 30 minutes at minimum
    const schedule = capped(steadyHistory(3, 30, 3));
    expect(schedule.context.volume.minutes).toBe(67);
    expect(schedule.dropped.map((x) => x.session_id)).toEqual(["s-2"]);
    expect(schedule.runs.map((r) => [r.run_type, r.minutes])).toEqual([
      ["base", 30],
      ["base", 30],
    ]);
    expect(schedule.check.violations).toEqual([]);
  });

  it("converts the long run to an easy run before it drops a session", () => {
    const schedule = capped(steadyHistory(3, 50, 3), [
      session(1, "base", [40, 45]),
      session(2, "base", [40, 45]),
      session(3, "long", [60, 75]),
    ]);
    expect(schedule.dropped).toEqual([]);
    expect(schedule.runs).toHaveLength(3);
    expect(schedule.runs.every((r) => r.run_type === "base")).toBe(true);
    expect(sum(schedule)).toBeLessThanOrEqual(schedule.context.volume.minutes);
  });

  it("lowers the level of a structured hard session before it drops it", () => {
    const schedule = scheduleRunWeek(
      hybrid({
        history: steadyHistory(3, 40, 3),
        sessions: [
          session(1, "base", [30, 30]),
          session(2, "intervals", null, { level: 3 }),
          session(3, "base", [30, 30]),
        ],
      }),
    );
    const hard = schedule.runs.find((r) => r.run_type === "intervals");
    expect(schedule.check.violations).toEqual([]);
    if (hard === undefined)
      // dropped only when level 0 does not fit either
      expect(schedule.dropped.map((x) => x.session_id)).toEqual(["s-2"]);
    else expect(hard.level).toBeLessThan(3);
    expect(schedule.runs.filter((r) => r.run_type === "base")).toHaveLength(2);
  });

  it("is consistent with the checker", () => {
    const history = steadyHistory(3, 45, 3);
    const schedule = capped(history);
    const again = checkRunWeek({
      today: TODAY,
      profile: hybrid().profile,
      history,
      block_start: d(-20),
      runs: schedule.runs.map((r) =>
        weekPlanRun(r.date, {
          run_type: r.run_type,
          total_s: r.minutes * 60,
          work_s: r.intense_minutes === null ? null : r.intense_minutes * 60,
        }),
      ),
    });
    expect(again.violations).toEqual([]);
    expect(HARD_RUN_TYPES).toContain("tempo");
  });
});
