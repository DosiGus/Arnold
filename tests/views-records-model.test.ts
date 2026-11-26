/**
 * The records screen's model (src/views/model/records.ts): the newest record
 * of every exercise from Arnold's records engine, newest first, formatted;
 * no record means an empty list, never an invented one.
 */
import { describe, expect, it } from "vitest";
import type { ArnoldHome, HomeRecord } from "../src/shared/arnold-view";
import { recordsScreenModel } from "../src/views/model/records";

const rec = (over: Partial<HomeRecord>): HomeRecord => ({
  key: "k",
  exercise_id: "ex",
  exercise_name: "Übung",
  muscle_group: "Brust",
  metric: "max_load",
  value: 60,
  previous_value: 55,
  load_kg: 60,
  reps: 5,
  load_basis: "total",
  achieved_on: "2026-11-01",
  workout_id: "w",
  ...over,
});

const home = (latest: HomeRecord[]) =>
  ({
    records_by_exercise: latest.map((r) => ({
      exercise_id: r.exercise_id,
      exercise_name: r.exercise_name,
      muscle_group: r.muscle_group,
      count: 2,
      latest: r,
      history: [r],
    })),
  }) as unknown as ArnoldHome;

describe("recordsScreenModel", () => {
  it("lists the newest record per exercise, newest first", () => {
    const rows = recordsScreenModel(
      home([
        rec({
          exercise_id: "a",
          exercise_name: "Kniebeuge",
          value: 70,
          reps: 5,
          achieved_on: "2026-11-02",
        }),
        rec({
          exercise_id: "b",
          exercise_name: "Bankdrücken",
          value: 62.5,
          reps: 8,
          achieved_on: "2026-11-12",
        }),
        rec({
          exercise_id: "c",
          exercise_name: "Klimmzug",
          metric: "max_reps_bodyweight",
          value: 9,
          load_kg: null,
          reps: null,
          achieved_on: "2026-11-12",
        }),
      ]),
    );
    expect(rows).toEqual([
      { exercise: "Bankdrücken", value: "62,5 kg × 8", when: "12. Nov." },
      { exercise: "Klimmzug", value: "9 Wdh.", when: "12. Nov." },
      { exercise: "Kniebeuge", value: "70 kg × 5", when: "2. Nov." },
    ]);
  });

  it("shows reps at a load as load × reps", () => {
    const [row] = recordsScreenModel(
      home([rec({ metric: "max_reps_at_load", value: 12, load_kg: 20 })]),
    );
    expect(row!.value).toBe("20 kg × 12");
  });

  it("returns nothing when there is no record yet", () => {
    expect(recordsScreenModel(home([]))).toEqual([]);
  });
});
