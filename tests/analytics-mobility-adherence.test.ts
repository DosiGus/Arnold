import { describe, expect, it } from "vitest";
import {
  MOBILITY_ADHERENCE_DEFAULT_DAYS,
  MOBILITY_ADHERENCE_MAX_DAYS,
  mobilityAdherence,
  type MobilityDoneEntry,
  type MobilityPlannedEntry,
} from "../src/analytics/mobility/adherence.js";
import { MobilityAdherenceViewSchema } from "../src/shared/mobility-contract.js";

const TODAY = "2026-11-22";
const plan = (date_local: string, session_id = "m1"): MobilityPlannedEntry => ({
  date_local,
  session_id,
});
const done = (
  date_local: string,
  session_id: string | null = "m1",
): MobilityDoneEntry => ({ date_local, session_id });

describe("mobilityAdherence (D-MOB-07)", () => {
  it("has a 28-day default window", () => {
    expect(MOBILITY_ADHERENCE_DEFAULT_DAYS).toBe(28);
    expect(
      mobilityAdherence({ planned: [], done: [], today: TODAY }).days,
    ).toBe(28);
  });

  describe("ratio", () => {
    it("is null, never 0, without a plan", () => {
      const r = mobilityAdherence({ planned: [], done: [], today: TODAY });
      expect(r.ratio).toBeNull();
      expect(r.planned_count).toBe(0);
      expect(r.done_count).toBe(0);
      expect(r.streak_days).toBe(0);
    });

    it("stays null when only free routines exist", () => {
      const r = mobilityAdherence({
        planned: [],
        done: [done(TODAY, null), done("2026-11-20", null)],
        today: TODAY,
      });
      expect(r.ratio).toBeNull();
      expect(r.done_count).toBe(2);
    });

    it("is 0 (not null) when something was planned and nothing done", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-20")],
        done: [],
        today: TODAY,
      });
      expect(r.ratio).toBe(0);
      expect(r.planned_count).toBe(1);
    });

    it("is done planned routines over planned routines", () => {
      const r = mobilityAdherence({
        planned: [
          plan("2026-11-18"),
          plan("2026-11-19"),
          plan("2026-11-20"),
          plan("2026-11-21"),
        ],
        done: [done("2026-11-18"), done("2026-11-20"), done("2026-11-21")],
        today: TODAY,
      });
      expect(r.planned_count).toBe(4);
      expect(r.done_count).toBe(3);
      expect(r.ratio).toBe(0.75);
    });

    it("counts a planned routine once per day, however often it is logged", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-20"), plan("2026-11-20")],
        done: [done("2026-11-20"), done("2026-11-20")],
        today: TODAY,
      });
      expect(r.planned_count).toBe(1);
      expect(r.done_count).toBe(1);
      expect(r.ratio).toBe(1);
    });

    it("counts two different sessions of one day separately", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-20", "m1"), plan("2026-11-20", "m2")],
        done: [done("2026-11-20", "m1")],
        today: TODAY,
      });
      expect(r.planned_count).toBe(2);
      expect(r.ratio).toBe(0.5);
    });

    it("lets a free routine fill one open planned routine of the same day", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-20", "m1"), plan("2026-11-20", "m2")],
        done: [done("2026-11-20", null)],
        today: TODAY,
      });
      expect(r.ratio).toBe(0.5);
      // One free routine fills only one of the two.
      const both = mobilityAdherence({
        planned: [plan("2026-11-20", "m1"), plan("2026-11-20", "m2")],
        done: [done("2026-11-20", null), done("2026-11-20", null)],
        today: TODAY,
      });
      expect(both.ratio).toBe(1);
    });

    it("does not let a free routine of another day fill a planned one", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-20")],
        done: [done("2026-11-21", null)],
        today: TODAY,
      });
      expect(r.ratio).toBe(0);
    });

    it("never exceeds 1 when more is done than planned", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-20")],
        done: [done("2026-11-20"), done("2026-11-20", null)],
        today: TODAY,
      });
      expect(r.ratio).toBe(1);
      expect(r.done_count).toBe(2);
    });

    it("always parses against the view schema", () => {
      for (const input of [
        { planned: [], done: [] },
        { planned: [plan("2026-11-20")], done: [] },
        { planned: [plan("2026-11-20")], done: [done("2026-11-20")] },
      ])
        expect(() =>
          MobilityAdherenceViewSchema.parse(
            mobilityAdherence({ ...input, today: TODAY }),
          ),
        ).not.toThrow();
    });
  });

  describe("28-day window", () => {
    // Today 2026-11-22, 28 days including today: first day 2026-10-26.
    it("includes the first and the last day, excludes the day before", () => {
      const r = mobilityAdherence({
        planned: [
          plan("2026-10-25"), // outside
          plan("2026-10-26"), // first day
          plan(TODAY), // last day
          plan("2026-11-23"), // tomorrow: outside
        ],
        done: [done("2026-10-26")],
        today: TODAY,
      });
      expect(r.planned_count).toBe(2);
      expect(r.done_count).toBe(1);
      expect(r.ratio).toBe(0.5);
    });

    it("ignores done routines outside the window", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-20")],
        done: [done("2026-10-25"), done("2026-11-23", null)],
        today: TODAY,
      });
      expect(r.done_count).toBe(0);
      expect(r.ratio).toBe(0);
    });

    it("honours a custom window", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-15"), plan("2026-11-16")],
        done: [done("2026-11-16")],
        today: TODAY,
        days: 7,
      });
      // 7 days back from the 22nd: first day is the 16th.
      expect(r.days).toBe(7);
      expect(r.planned_count).toBe(1);
      expect(r.ratio).toBe(1);
    });

    it("steps whole calendar days across month, year and leap boundaries", () => {
      const year = mobilityAdherence({
        planned: [plan("2025-12-31"), plan("2025-12-30")],
        done: [done("2025-12-31")],
        today: "2026-01-02",
        days: 3,
      });
      expect(year.planned_count).toBe(1); // 12-31 .. 01-02
      const leap = mobilityAdherence({
        planned: [plan("2028-02-29"), plan("2028-02-28")],
        done: [],
        today: "2028-03-01",
        days: 2,
      });
      expect(leap.planned_count).toBe(1); // 02-29 .. 03-01
    });

    it("rejects an invalid window or today", () => {
      const base = { planned: [], done: [], today: TODAY };
      for (const days of [0, -1, 1.5, MOBILITY_ADHERENCE_MAX_DAYS + 1])
        expect(() => mobilityAdherence({ ...base, days })).toThrow(RangeError);
      expect(() => mobilityAdherence({ ...base, days: 366 })).not.toThrow();
      expect(() => mobilityAdherence({ ...base, days: 1 })).not.toThrow();
      for (const today of ["", "2026-11-31", "22.11.2026", "2026-13-01"])
        expect(() => mobilityAdherence({ ...base, today })).toThrow(RangeError);
    });
  });

  describe("local calendar date, never UTC", () => {
    it("counts a routine just after local midnight on its own date_local", () => {
      // 00:20 on the 21st in Berlin is the 20th in UTC. The row carries the
      // local date; the figure must follow it, with no time stamp involved.
      const r = mobilityAdherence({
        planned: [plan("2026-11-21")],
        done: [done("2026-11-21")],
        today: TODAY,
      });
      expect(r.ratio).toBe(1);
    });

    it("does not move a routine to the UTC date of another day", () => {
      // Planned on the 21st, logged on the 20th: no match for the 21st.
      const r = mobilityAdherence({
        planned: [plan("2026-11-21")],
        done: [done("2026-11-20")],
        today: TODAY,
      });
      expect(r.ratio).toBe(0);
      expect(r.done_count).toBe(1);
    });

    it("takes today from the caller (local) and never from the clock", () => {
      const a = mobilityAdherence({
        planned: [plan("2026-11-22")],
        done: [done("2026-11-22")],
        today: "2026-11-22",
      });
      const b = mobilityAdherence({
        planned: [plan("2026-11-22")],
        done: [done("2026-11-22")],
        today: "2026-11-23",
      });
      expect(a.streak_days).toBe(1);
      expect(b.streak_days).toBe(1); // yesterday done, today still running
    });

    it("ignores malformed dates instead of guessing", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-2x"), plan("2026-11-20")],
        done: [done("garbage"), done("2026-11-20")],
        today: TODAY,
      });
      expect(r.planned_count).toBe(1);
      expect(r.done_count).toBe(1);
    });
  });

  describe("streak", () => {
    const days = (...ds: string[]) => ds.map((d) => done(d, null));

    it("is 0 with nothing done", () => {
      expect(
        mobilityAdherence({ planned: [], done: [], today: TODAY }).streak_days,
      ).toBe(0);
    });

    it("counts consecutive days back from today", () => {
      const r = mobilityAdherence({
        planned: [],
        done: days(TODAY, "2026-11-21", "2026-11-20"),
        today: TODAY,
      });
      expect(r.streak_days).toBe(3);
    });

    it("does not break while today is still running", () => {
      const r = mobilityAdherence({
        planned: [plan(TODAY)],
        done: days("2026-11-21", "2026-11-20"),
        today: TODAY,
      });
      expect(r.streak_days).toBe(2);
    });

    it("skips days with neither plan nor routine", () => {
      const r = mobilityAdherence({
        planned: [],
        done: days(TODAY, "2026-11-20", "2026-11-18"),
        today: TODAY,
      });
      expect(r.streak_days).toBe(3);
    });

    it("breaks on a planned routine that was left out", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-20")],
        done: days(TODAY, "2026-11-21", "2026-11-19", "2026-11-18"),
        today: TODAY,
      });
      expect(r.streak_days).toBe(2);
    });

    it("keeps going when a planned routine was done by its session", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-20"), plan("2026-11-19")],
        done: [
          done(TODAY, null),
          done("2026-11-21", null),
          done("2026-11-20"),
          done("2026-11-19"),
        ],
        today: TODAY,
      });
      expect(r.streak_days).toBe(4);
    });

    it("keeps going when a free routine covers the planned one", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-21")],
        done: days("2026-11-21", "2026-11-20"),
        today: TODAY,
      });
      expect(r.streak_days).toBe(2);
    });

    it("breaks when a day has two planned routines and only one was done", () => {
      const r = mobilityAdherence({
        planned: [plan("2026-11-21", "m1"), plan("2026-11-21", "m2")],
        done: [done("2026-11-21", "m1"), done("2026-11-20", null)],
        today: TODAY,
      });
      expect(r.streak_days).toBe(0);
    });

    it("never reaches back beyond the window", () => {
      const all = Array.from({ length: 40 }, (_, i) => {
        const ms = Date.parse(`${TODAY}T00:00:00Z`) - i * 86_400_000;
        return done(new Date(ms).toISOString().slice(0, 10), null);
      });
      expect(
        mobilityAdherence({ planned: [], done: all, today: TODAY }).streak_days,
      ).toBe(28);
      expect(
        mobilityAdherence({ planned: [], done: all, today: TODAY, days: 7 })
          .streak_days,
      ).toBe(7);
    });

    it("counts a day once however many routines were done", () => {
      const r = mobilityAdherence({
        planned: [],
        done: days(TODAY, TODAY, TODAY),
        today: TODAY,
      });
      expect(r.streak_days).toBe(1);
      expect(r.done_count).toBe(3);
    });
  });

  it("is pure: the same input gives the same output and is not mutated", () => {
    const input = {
      planned: [plan("2026-11-20"), plan("2026-11-21")],
      done: [done("2026-11-21"), done("2026-11-19", null)],
      today: TODAY,
    };
    const copy = JSON.parse(JSON.stringify(input));
    expect(mobilityAdherence(input)).toEqual(mobilityAdherence(input));
    expect(input).toEqual(copy);
  });
});
