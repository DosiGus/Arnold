import { describe, expect, it } from "vitest";
import { addDays } from "../src/analytics/period.js";
import {
  RUN_RULES_VERSION,
  WEEK_RULE_CODES,
  blockPhase,
  checkRunWeek,
  intenseMinutes,
  weekContext,
  weekPlanRun,
  type StrengthDay,
  type WeekRuleCode,
} from "../src/analytics/running/index.js";
import {
  TODAY,
  planned,
  profile,
  run,
  steadyHistory,
} from "./analytics-running-week-helpers.js";

/** Two steady weeks of 160 minutes: cap 176, no deload yet. */
const HISTORY = steadyHistory(2, 40);
const d = (offset: number, today = TODAY) => addDays(today, offset);

function check(
  runs: Parameters<typeof checkRunWeek>[0]["runs"],
  overrides: Partial<Parameters<typeof checkRunWeek>[0]> = {},
) {
  return checkRunWeek({
    today: TODAY,
    profile: profile(),
    history: HISTORY,
    runs,
    ...overrides,
  });
}
const rule = (c: ReturnType<typeof check>, code: WeekRuleCode) =>
  c.results.find((r) => r.rule === code)!;

describe("checkRunWeek: one result per rule", () => {
  it("reports every rule, with the version, and no violation for an empty week", () => {
    const c = check([]);
    expect(c.rules_version).toBe(RUN_RULES_VERSION);
    expect(c.results.map((r) => r.rule)).toEqual([...WEEK_RULE_CODES]);
    expect(c.violations).toEqual([]);
  });

  it("rejects a run outside the seven days of the window", () => {
    expect(() => check([planned(d(7), "base", 30)])).toThrow(RangeError);
    expect(() => check([planned(d(-1), "base", 30)])).toThrow(RangeError);
  });
});

describe("volume (+10 %)", () => {
  it("allows up to 10 % more than the seven days before", () => {
    const ctx = weekContext({
      today: TODAY,
      profile: profile(),
      history: HISTORY,
    });
    expect(ctx.volume.basis).toBe("previous_week");
    expect(ctx.volume.reference_minutes).toBe(160);
    expect(ctx.volume.minutes).toBe(176);
    const ok = check([planned(d(0), "base", 88), planned(d(2), "base", 88)]);
    expect(rule(ok, "volume").status).toBe("ok");
    const over = check([planned(d(0), "base", 89), planned(d(2), "base", 88)]);
    expect(rule(over, "volume").status).toBe("violated");
    expect(rule(over, "volume").limit).toBe(176);
  });

  it("uses the block before when the last seven days had no run", () => {
    const history = HISTORY.filter(
      (r) => r.workout_date_local < addDays(TODAY, -7),
    );
    const ctx = weekContext({ today: TODAY, profile: profile(), history });
    expect(ctx.volume.basis).toBe("previous_week");
    expect(ctx.volume.reference_minutes).toBe(160);
  });

  it("calls the volume unknown when a planned run has no duration (never 0)", () => {
    const c = check([planned(d(0), "base", null)]);
    expect(rule(c, "volume").status).toBe("unknown");
    expect(rule(c, "volume").value).toBeNull();
  });

  it("counts only the known minutes of the history and says so", () => {
    const history = [run(2, null), run(4, 60), run(6, 60)];
    const ctx = weekContext({ today: TODAY, profile: profile(), history });
    expect(ctx.volume.partly_unknown).toBe(true);
    expect(ctx.volume.reference_minutes).toBe(120);
    expect(ctx.notes.map((n) => n.code)).toContain("partly_unknown_volume");
  });
});

describe("3:1 deload", () => {
  it("plans 75 % of the last week after three build weeks", () => {
    const ctx = weekContext({
      today: TODAY,
      profile: profile(),
      history: steadyHistory(3, 40),
    });
    expect(ctx.deload).toBe(true);
    expect(ctx.volume.minutes).toBe(120);
    expect(ctx.notes.map((n) => n.code)).toContain("deload");
    expect(
      rule(
        check([planned(d(0), "base", 121)], {
          history: steadyHistory(3, 40),
        }),
        "volume",
      ).status,
    ).toBe("violated");
  });

  it("does not deload after only two build weeks", () => {
    const ctx = weekContext({
      today: TODAY,
      profile: profile(),
      history: steadyHistory(2, 40),
    });
    expect(ctx.deload).toBe(false);
  });

  it("goes back to the volume before an easier week without raising it", () => {
    // 160, 160, 120 (the deload week): next week at most 160, not 176 or 132.
    const history = [
      ...steadyHistory(3, 40).filter(
        (r) => r.workout_date_local < addDays(TODAY, -7),
      ),
      ...[1, 3, 5, 7].map((n) => run(n, 30)),
    ];
    const ctx = weekContext({ today: TODAY, profile: profile(), history });
    expect(ctx.deload).toBe(false);
    expect(ctx.volume.basis).toBe("before_deload");
    expect(ctx.volume.minutes).toBe(160);
    expect(ctx.notes.map((n) => n.code)).toContain("return_after_deload");
  });
});

describe("80/20", () => {
  it("accepts exactly 20 % intense minutes and rejects more", () => {
    const ok = check([
      planned(d(0), "base", 60),
      planned(d(2), "tempo", 60, 24),
    ]);
    expect(rule(ok, "easy_share").status).toBe("ok");
    const bad = check([
      planned(d(0), "base", 60),
      planned(d(2), "tempo", 60, 25),
    ]);
    expect(rule(bad, "easy_share").status).toBe("violated");
  });

  it("leaves free runs out of the share and keeps unknown unknown", () => {
    const free = check([planned(d(0), "free", 60, null)]);
    expect(rule(free, "easy_share").status).toBe("ok");
    const unknown = check([planned(d(0), "tempo", 60, null)]);
    expect(rule(unknown, "easy_share").status).toBe("unknown");
  });

  it("computes intense minutes from a prescription summary", () => {
    const sum = (
      run_type: Parameters<typeof intenseMinutes>[0]["run_type"],
      total_s: number | null,
      work_s: number | null,
    ) => intenseMinutes({ run_type, total_s, work_s });
    expect(sum("base", 3600, null)).toBe(0);
    expect(sum("strides", 2400, null)).toBe(0);
    expect(sum("tempo", 3000, 1200)).toBe(20);
    expect(sum("progression", 3600, null)).toBeCloseTo(40);
    expect(sum("tempo", 3000, null)).toBeNull();
    expect(sum("free", 3000, null)).toBeNull();
    expect(
      weekPlanRun(d(0), { run_type: "tempo", total_s: 3000, work_s: 1200 })
        .minutes,
    ).toBe(50);
  });
});

describe("hard runs: count", () => {
  const three = [
    planned(d(0), "tempo", 40, 10),
    planned(d(2), "intervals", 40, 10),
    planned(d(4), "hills", 40, 10),
  ];
  it("allows at most two for experienced runners", () => {
    expect(rule(check(three.slice(0, 2)), "hard_count").status).toBe("ok");
    expect(rule(check(three), "hard_count").status).toBe("violated");
  });

  it("allows one for beginners (beginner rule)", () => {
    const beginner = profile({
      running_experience_months: 2,
      base_minutes_per_week: 60,
    });
    const ctx = weekContext({
      today: TODAY,
      profile: beginner,
      history: HISTORY,
    });
    expect(ctx.experience).toBe("beginner");
    expect(ctx.max_hard).toBe(1);
    const c = check(three.slice(0, 2), { profile: beginner });
    expect(rule(c, "hard_count").status).toBe("violated");
    expect(rule(c, "hard_count").limit).toBe(1);
  });

  it("allows one with the main goal strength and says why", () => {
    const ctx = weekContext({
      today: TODAY,
      profile: profile(),
      history: HISTORY,
      focus: "strength",
    });
    expect(ctx.max_hard).toBe(1);
    expect(ctx.notes.map((n) => n.code)).toContain("strength_focus");
    // without a race goal and with strength days the default focus is strength
    expect(
      weekContext({
        today: TODAY,
        profile: profile(),
        history: HISTORY,
        has_strength: true,
      }).focus,
    ).toBe("strength");
    expect(
      weekContext({
        today: TODAY,
        profile: profile({ goal: "10k", race_date: d(200) }),
        history: HISTORY,
        has_strength: true,
      }).focus,
    ).toBe("running");
  });

  it("allows only strides in the first four weeks of a beginner", () => {
    const fresh = profile({
      running_experience_months: 0,
      base_minutes_per_week: null,
    });
    const ctx = weekContext({ today: TODAY, profile: fresh, history: [] });
    expect(ctx.beginner_first_weeks).toBe(true);
    expect(ctx.max_hard).toBe(0);
    const c = check([planned(d(0), "tempo", 20, 5)], {
      profile: fresh,
      history: [],
    });
    expect(rule(c, "hard_count").status).toBe("violated");
  });

  it("counts the hard runs already done in the same calendar week", () => {
    const thursday = "2026-03-05";
    const history = [run(2, 40, "tempo", thursday)];
    const c = checkRunWeek({
      today: thursday,
      profile: profile(),
      history,
      runs: [
        planned(d(2, thursday), "intervals", 40, 10), // Saturday
        planned(d(4, thursday), "hills", 40, 10), // Monday of the next week
      ],
    });
    // two planned (ok for the window) but with Tuesday already three in the week? Saturday only:
    expect(rule(c, "hard_count").status).toBe("ok");
    const c2 = checkRunWeek({
      today: thursday,
      profile: profile(),
      history: [run(2, 40, "tempo", thursday), run(3, 40, "hills", thursday)],
      runs: [planned(d(2, thursday), "intervals", 40, 10)],
    });
    expect(rule(c2, "hard_count").status).toBe("violated");
  });

  it("allows no hard run in the base phase beyond one", () => {
    const base = profile({ goal: "10k", race_date: d(120) });
    const ctx = weekContext({ today: TODAY, profile: base, history: HISTORY });
    expect(ctx.phase).toBe("base");
    expect(ctx.max_hard).toBe(1);
  });
});

describe("hard runs: 48 h, after the long run, after heavy legs", () => {
  it("needs two days between hard runs", () => {
    const close = check([
      planned(d(1), "tempo", 40, 10),
      planned(d(2), "intervals", 40, 10),
    ]);
    expect(rule(close, "hard_spacing").status).toBe("violated");
    const apart = check([
      planned(d(0), "tempo", 40, 10),
      planned(d(2), "intervals", 40, 10),
    ]);
    expect(rule(apart, "hard_spacing").status).toBe("ok");
  });

  it("counts a hard run of the history for the 48 h", () => {
    const history = [...HISTORY, run(1, 40, "tempo")].filter(
      (r) => !(r.workout_date_local === d(-1) && r.run_type === "base"),
    );
    const c = check([planned(d(0), "intervals", 40, 10)], { history });
    expect(rule(c, "hard_spacing").status).toBe("violated");
    expect(rule(c, "hard_spacing").dates).toEqual([d(0)]);
  });

  it("allows no hard run the day after the long run", () => {
    const bad = check([
      planned(d(1), "long", 60, 0),
      planned(d(2), "tempo", 30, 8),
    ]);
    expect(rule(bad, "hard_after_long").status).toBe("violated");
    const fine = check([
      planned(d(1), "long", 60, 0),
      planned(d(3), "tempo", 30, 8),
    ]);
    expect(rule(fine, "hard_after_long").status).toBe("ok");
    const afterHistory = check([planned(d(0), "tempo", 30, 8)], {
      history: [...HISTORY, run(1, 60, "long")],
    });
    expect(rule(afterHistory, "hard_after_long").status).toBe("violated");
  });

  it("allows no hard run the day after a heavy leg day; unknown stays unknown", () => {
    const strength = (heavy: boolean | null): StrengthDay[] => [
      {
        date: d(0),
        leg_sets: heavy === null ? null : heavy ? 8 : 3,
        heavy_legs: heavy,
        planned: false,
      },
    ];
    const hard = [planned(d(1), "tempo", 30, 8)];
    expect(
      rule(
        check(hard, { strength_days: strength(true) }),
        "hard_after_heavy_legs",
      ).status,
    ).toBe("violated");
    expect(
      rule(
        check(hard, { strength_days: strength(false) }),
        "hard_after_heavy_legs",
      ).status,
    ).toBe("ok");
    const unknown = check(hard, { strength_days: strength(null) });
    expect(rule(unknown, "hard_after_heavy_legs").status).toBe("unknown");
    expect(unknown.violations.map((v) => v.rule)).not.toContain(
      "hard_after_heavy_legs",
    );
    // an easy run the day after is no violation
    expect(
      rule(
        check([planned(d(1), "base", 30, 0)], {
          strength_days: strength(true),
        }),
        "hard_after_heavy_legs",
      ).status,
    ).toBe("ok");
  });
});

describe("long run", () => {
  it("is at most 30 / 35 / 40 / 50 % of the week at 5+ / 4 / 3 / 2 runs", () => {
    /** A week of `count` runs: a long run of `long` minutes, the rest 100 minutes in total. */
    const week = (count: number, long: number) => {
      const others = count - 1;
      return check([
        planned(d(0), "long", long, 0),
        ...Array.from({ length: others }, (_, i) =>
          planned(d(1 + i), "base", 100 / others, 0),
        ),
      ]);
    };
    // limit L of the total: long <= L * (long + 100)  <=>  long <= 100 * L / (1 - L)
    const cases: [number, number][] = [
      [6, 42.857],
      [5, 42.857],
      [4, 53.846],
      [3, 66.667],
      [2, 100],
    ];
    for (const [count, edge] of cases) {
      expect(
        rule(week(count, edge - 0.01), "long_share").status,
        `${count}`,
      ).toBe("ok");
      expect(
        rule(week(count, edge + 0.1), "long_share").status,
        `${count}`,
      ).toBe("violated");
    }
    // the limit in the result follows the number of runs
    expect(rule(week(3, 60), "long_share").limit).toBe(0.4);
    expect(rule(week(2, 60), "long_share").limit).toBe(0.5);
  });

  it("has no share limit for a single run, and reports unknown minutes", () => {
    expect(
      rule(check([planned(d(0), "long", 60, 0)]), "long_share").status,
    ).toBe("ok");
    const unknown = check([
      planned(d(0), "long", 30, 0),
      planned(d(2), "base", null, 0),
    ]);
    expect(rule(unknown, "long_share").status).toBe("unknown");
  });

  it("is at most 15 minutes longer than the longest run of four weeks", () => {
    const history = [run(2, 60, "long"), run(4, 30), run(6, 30), run(9, 30)];
    const ctx = weekContext({ today: TODAY, profile: profile(), history });
    expect(ctx.longest_4w_min).toBe(60);
    expect(ctx.long_cap_min).toBe(75);
    const base = [planned(d(1), "base", 200, 0)];
    expect(
      rule(
        check([...base, planned(d(4), "long", 75, 0)], { history }),
        "long_growth",
      ).status,
    ).toBe("ok");
    expect(
      rule(
        check([...base, planned(d(4), "long", 76, 0)], { history }),
        "long_growth",
      ).status,
    ).toBe("violated");
  });

  it("starts with the experience default when the longest run is unknown", () => {
    const history = [run(2, null), run(4, null)];
    const ctx = weekContext({ today: TODAY, profile: profile(), history });
    expect(ctx.longest_4w_min).toBeNull();
    expect(ctx.notes.map((n) => n.code)).toContain("unknown_longest_run");
    expect(ctx.long_cap_min).toBeGreaterThan(0);
  });

  it("takes the longest run from the profile for a new user", () => {
    const ctx = weekContext({
      today: TODAY,
      profile: profile({ longest_run_4w_min: 40 }),
      history: [],
    });
    expect(ctx.longest_4w_min).toBe(40);
    expect(ctx.long_cap_min).toBe(55);
  });
});

describe("phases, tapering, race day", () => {
  const phaseAt = (
    goal: "5k" | "10k" | "half_marathon",
    daysToRace: number,
    block: number | null = null,
  ) =>
    blockPhase(
      { goal, race_date: d(daysToRace) },
      TODAY,
      block === null ? null : d(block),
    );

  it("counts back from the race: taper, peak 2 weeks, build 4 (5 for the half), base", () => {
    expect(phaseAt("10k", 9).phase).toBe("taper");
    expect(phaseAt("10k", 10).phase).toBe("taper");
    expect(phaseAt("10k", 11, -100).phase).toBe("peak");
    expect(phaseAt("10k", 24, -100).phase).toBe("peak");
    expect(phaseAt("10k", 25, -100).phase).toBe("build");
    expect(phaseAt("10k", 52, -100).phase).toBe("build");
    expect(phaseAt("10k", 53, -100).phase).toBe("base");
    expect(phaseAt("half_marathon", 14).phase).toBe("taper");
    expect(phaseAt("half_marathon", 15, -100).phase).toBe("peak");
    expect(phaseAt("half_marathon", 63, -100).phase).toBe("build");
    expect(phaseAt("half_marathon", 64, -100).phase).toBe("base");
    expect(phaseAt("5k", 7).phase).toBe("taper");
    expect(phaseAt("5k", 8, -100).phase).toBe("peak");
    expect(blockPhase({ goal: "10k", race_date: d(-1) }, TODAY).phase).toBe(
      "race_over",
    );
    expect(blockPhase({ goal: "fitness", race_date: null }, TODAY).phase).toBe(
      "none",
    );
  });

  it("has only build and taper in a block under six weeks, with a hint", () => {
    const info = phaseAt("10k", 30, 0);
    expect(info.phase).toBe("build");
    expect(info.short_block).toBe(true);
    const ctx = weekContext({
      today: TODAY,
      profile: profile({ goal: "10k", race_date: d(30) }),
      history: HISTORY,
      block_start: TODAY,
    });
    expect(ctx.notes.map((n) => n.code)).toContain("short_block");
  });

  it.each([
    ["5k", 5, 0.7],
    ["10k", 8, 0.65],
    ["half_marathon", 12, 0.6],
  ] as const)(
    "tapers %s: volume factor %s of the week before the taper",
    (goal, race, factor) => {
      const history = steadyHistory(6, 40);
      const ctx = weekContext({
        today: TODAY,
        profile: profile({ goal, race_date: d(race) }),
        history,
      });
      expect(ctx.phase).toBe("taper");
      expect(ctx.notes.map((n) => n.code)).toContain("taper");
      expect(ctx.volume.basis).toBe("before_taper");
      expect(ctx.volume.minutes).toBe(Math.floor(160 * factor));
      // taper keeps the intensity: hard runs stay allowed
      expect(ctx.max_hard).toBeGreaterThan(0);
    },
  );

  it("allows no other run on race day and no hard run the day before", () => {
    const race = profile({ goal: "10k", race_date: d(5) });
    const onRace = check([planned(d(5), "base", 30, 0)], { profile: race });
    expect(rule(onRace, "race_day").status).toBe("violated");
    const before = check([planned(d(4), "tempo", 20, 5)], { profile: race });
    expect(rule(before, "hard_spacing").status).toBe("violated");
    const fine = check(
      [planned(d(4), "base", 20, 0), planned(d(2), "base", 20, 0)],
      { profile: race },
    );
    expect(rule(fine, "race_day").status).toBe("ok");
    expect(rule(fine, "hard_spacing").status).toBe("ok");
  });
});

describe("re-entry after a pause", () => {
  const pauseCtx = (pause: number) =>
    // last run `pause + 1` days ago, 160 minutes a week before it
    weekContext({
      today: TODAY,
      profile: profile(),
      history: steadyHistory(2, 40, 4, addDays(TODAY, -pause)),
    });

  it("does nothing special up to 7 days without a run", () => {
    expect(pauseCtx(7).reentry).toBe("none");
  });

  it("takes 20 % off after more than 7 days", () => {
    const ctx = pauseCtx(8);
    expect(ctx.reentry).toBe("short");
    expect(ctx.pause_days).toBe(8);
    expect(ctx.volume.basis).toBe("before_pause");
    expect(ctx.volume.minutes).toBe(
      Math.floor(ctx.volume.reference_minutes * 0.8),
    );
    expect(ctx.max_hard).toBe(2);
    expect(ctx.notes.map((n) => n.code)).toContain("reentry");
  });

  it("takes 35 % off and no hard run after more than 14 days", () => {
    const ctx = pauseCtx(15);
    expect(ctx.reentry).toBe("long");
    expect(ctx.volume.minutes).toBe(
      Math.floor(ctx.volume.reference_minutes * 0.65),
    );
    expect(ctx.max_hard).toBe(0);
  });

  it("restarts from the profile volume after more than 28 days", () => {
    const ctx = pauseCtx(29);
    expect(ctx.reentry).toBe("restart");
    expect(ctx.volume.basis).toBe("profile");
    expect(ctx.volume.minutes).toBe(240);
    expect(ctx.max_hard).toBe(0);
  });

  it("starts a new user from the profile and assumes 60 minutes without one (beginner)", () => {
    const fromProfile = weekContext({
      today: TODAY,
      profile: profile(),
      history: [],
    });
    expect(fromProfile.reentry).toBe("new");
    expect(fromProfile.volume.basis).toBe("profile");
    const unknown = weekContext({
      today: TODAY,
      profile: profile({
        base_minutes_per_week: null,
        running_experience_months: null,
      }),
      history: [],
    });
    expect(unknown.volume.basis).toBe("default");
    expect(unknown.volume.minutes).toBe(60);
    expect(unknown.notes.map((n) => n.code)).toContain("assumed_volume");
  });
});

describe("calendar days only from workout_date_local", () => {
  it("ignores runs of today and later, cancelled runs and runs without a valid day", () => {
    const history = [
      ...HISTORY,
      { ...run(0, 500), workout_date_local: TODAY },
      { ...run(2, 500), status: "cancelled" as const },
    ];
    const ctx = weekContext({ today: TODAY, profile: profile(), history });
    expect(ctx.volume.reference_minutes).toBe(160);
    expect(() =>
      weekContext({
        today: TODAY,
        profile: profile(),
        history: [{ ...run(2, 30), workout_date_local: "2026-02-30" }],
      }),
    ).toThrow();
  });

  it("does not shift a run by its UTC time", () => {
    // A run at 23:30 local on the 1st is stored as the 1st, whatever its UTC time says.
    const history = [
      { ...run(1, 60), started_at_utc: "2026-03-02T22:30:00Z" } as never,
    ];
    const ctx = weekContext({ today: TODAY, profile: profile(), history });
    expect(ctx.pause_days).toBe(0);
  });
});
