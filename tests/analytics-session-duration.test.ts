/** GAR-B2-10: estimated duration of a training day (07 D-27). */
import { describe, expect, it } from "vitest";
import { estimateSessionMinutes } from "../src/analytics/session-duration";

describe("estimateSessionMinutes", () => {
  it("adds sets, rests between sets and one changeover per exercise", () => {
    // 6 exercises × 4 sets, 90 s rest: 6 × (160 + 270) + 5 × 90 = 3030 s.
    expect(
      estimateSessionMinutes(
        Array.from({ length: 6 }, () => ({ sets: 4, rest_seconds: 90 })),
      ),
    ).toBe(Math.ceil(3030 / 60));
  });

  it("uses 120 s when the plan names no rest", () => {
    // 3 × 40 + 2 × 120 = 360 s, then 120 s changeover, then 2 × 40 + 120.
    expect(
      estimateSessionMinutes([
        { sets: 3, rest_seconds: null },
        { sets: 2, rest_seconds: null },
      ]),
    ).toBe(Math.ceil((360 + 120 + 200) / 60));
  });

  it("counts no changeover after a single exercise", () => {
    expect(estimateSessionMinutes([{ sets: 3, rest_seconds: 60 }])).toBe(
      Math.ceil((120 + 120) / 60),
    );
  });

  it("stays unknown when a set count is unknown, never 0", () => {
    expect(
      estimateSessionMinutes([
        { sets: 3, rest_seconds: 60 },
        { sets: null, rest_seconds: 60 },
      ]),
    ).toBeNull();
    expect(estimateSessionMinutes([])).toBeNull();
  });

  it("rounds up to whole minutes", () => {
    // One set of 40 s is one minute, not zero.
    expect(estimateSessionMinutes([{ sets: 1, rest_seconds: 0 }])).toBe(1);
    expect(estimateSessionMinutes([{ sets: 2, rest_seconds: 0 }])).toBe(2);
    expect(estimateSessionMinutes([{ sets: 3, rest_seconds: 0 }])).toBe(2);
  });
});
