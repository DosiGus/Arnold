/**
 * The current interface (src/ui) shows running goals in their own units, never
 * as kg: km, minutes and a clock for a time goal.
 */
import { describe, expect, it } from "vitest";
import { clockText, goalValue, isRunGoal } from "../src/ui/components/home";

describe("goalValue in src/ui", () => {
  it("formats every goal unit", () => {
    const g = (unit: "kg" | "reps" | "km" | "min" | "s") => ({
      unit,
      load_basis: null,
    });
    expect(goalValue(g("kg"), 82.5)).toBe("82,5 kg");
    expect(goalValue(g("reps"), 8)).toBe("8 Wdh.");
    expect(goalValue(g("km"), 10.25)).toBe("10,25 km");
    expect(goalValue(g("min"), 45)).toBe("45 Min.");
    expect(goalValue(g("s"), 1470)).toBe("24:30");
    expect(goalValue(g("s"), null)).toBe("–");
    expect(clockText(3725)).toBe("1:02:05");
    expect(isRunGoal(g("s"))).toBe(true);
    expect(isRunGoal(g("kg"))).toBe(false);
  });
});
