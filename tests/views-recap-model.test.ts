/** The recap and the adjustment hint: only what the server delivered. */
import { describe, expect, it } from "vitest";
import type { ArnoldDashboardView } from "../src/shared/arnold-view";
import type { ArnoldRecap } from "../src/shared/recap-contract";
import { adjustmentHint, recapModel } from "../src/views/model/recap";

const run = (values: NonNullable<ArnoldRecap["run"]>): ArnoldRecap => ({
  kind: "run",
  workout_id: "r-1",
  date: "2026-11-03",
  title: "Grundlage",
  from_watch: false,
  exercise_count: 0,
  working_set_count: 0,
  records: [],
  week_goal: null,
  suggestion: null,
  next_session_id: null,
  run: values,
});
const view = (recap: ArnoldRecap | null) =>
  ({ recap }) as unknown as ArnoldDashboardView;

describe("run recap", () => {
  it("shows distance, time and pace, and no suggestion", () => {
    expect(
      recapModel(
        view(run({ distance_m: 7000, duration_s: 2700, pace_s_per_km: 385.7 })),
      ),
    ).toMatchObject({
      title: "Geschafft: Grundlage",
      detail: "7 km · 45:00 · 6:26 /km",
      lines: [],
      suggestion: null,
    });
  });

  it("leaves out what the server did not deliver", () => {
    expect(
      recapModel(
        view(run({ distance_m: null, duration_s: 2700, pace_s_per_km: null })),
      )!.detail,
    ).toBe("45:00");
    expect(recapModel(view(null))).toBeNull();
  });
});

describe("strength recap", () => {
  it("names records, the week goal and the next weight", () => {
    const model = recapModel(
      view({
        ...run({ distance_m: null, duration_s: null, pace_s_per_km: null }),
        kind: "strength",
        run: undefined,
        from_watch: true,
        exercise_count: 1,
        working_set_count: 3,
        records: [
          {
            exercise_id: "e",
            exercise_name: "Bankdrücken",
            metric: "max_load",
            value: 62.5,
            previous_value: 60,
            load_kg: 62.5,
            reps: 8,
            load_basis: "total",
          },
        ],
        week_goal: { goal: 3, training_days: 3 },
        suggestion: {
          exercise_id: "e",
          exercise_name: "Bankdrücken",
          decision: "increase",
          load_basis: "total",
          next_load_kg: 65,
          last_load_kg: 62.5,
          next_reps: 6,
          last_reps: 8,
        },
      }),
    )!;
    expect(model.detail).toBe("1 Übung · 3 Arbeitssätze · Von der Uhr");
    expect(model.lines).toEqual([
      "Neuer Rekord: Bankdrücken 62,5 kg × 8",
      "Wochenziel erreicht: 3 von 3 Trainingstagen",
    ]);
    expect(model.suggestion).toBe(
      "Nächstes Mal: Bankdrücken 65 kg statt 62,5 kg",
    );
  });
});

describe("adjustment hint", () => {
  it("says until when it applies, and nothing without one", () => {
    expect(
      adjustmentHint({
        adjustment: {
          plan_adjustment_id: "a",
          kind: "week",
          start_date_local: "2026-11-23",
          end_date_local: "2026-11-29",
          normal_from: "2026-11-30",
          reason: null,
        },
      } as unknown as ArnoldDashboardView),
    ).toMatch(/^Anpassung auf Zeit bis .*29\..* wieder dein normaler Plan\.$/);
    expect(adjustmentHint({} as ArnoldDashboardView)).toBeNull();
  });
});
