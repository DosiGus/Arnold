/**
 * The records screen's model (src/views/model/records.ts): the newest record
 * of every exercise from Arnold's records engine, newest first, formatted;
 * no record means an empty list, never an invented one.
 */
import { describe, expect, it } from "vitest";
import type {
  ArnoldHome,
  HomeRecord,
  HomeRunRecord,
} from "../src/shared/arnold-view";
import { latestRecords } from "../src/views/model/dashboard";
import {
  recordsScreenModel,
  runRecordsScreenModel,
} from "../src/views/model/records";

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

const runRec = (
  key: HomeRunRecord["key"],
  value: number | null,
  achieved_on: string | null = value === null ? null : "2026-11-10",
): HomeRunRecord => ({
  key,
  unit: key === "longest_distance" ? "m" : "s",
  value,
  workout_id: value === null ? null : `run-${key}`,
  achieved_on,
  reason: value === null ? "distance_not_covered" : null,
});

describe("runRecordsScreenModel", () => {
  it("shows all five running records, unknown ones as –", () => {
    const rows = runRecordsScreenModel({
      run_records: [
        runRec("longest_distance", 12_340),
        runRec("longest_duration", 4210),
        runRec("fastest_1k", 281),
        runRec("best_5k", 1530),
        runRec("best_10k", null),
      ],
    } as unknown as ArnoldHome);
    expect(rows).toEqual([
      { exercise: "Längster Lauf", value: "12,34 km", when: "10. Nov." },
      { exercise: "Längste Laufdauer", value: "1:10:10", when: "10. Nov." },
      { exercise: "Schnellster Kilometer", value: "4:41", when: "10. Nov." },
      { exercise: "Beste 5 km", value: "25:30", when: "10. Nov." },
      { exercise: "Beste 10 km", value: "–", when: "" },
    ]);
  });

  it("shows nothing for someone without a measured run", () => {
    expect(
      runRecordsScreenModel({
        run_records: [
          runRec("longest_distance", null),
          runRec("longest_duration", null),
          runRec("fastest_1k", null),
          runRec("best_5k", null),
          runRec("best_10k", null),
        ],
      } as unknown as ArnoldHome),
    ).toEqual([]);
  });
});

describe("latestRecords (overview box)", () => {
  it("mixes strength and running records, newest first, at most four", () => {
    const rows = latestRecords({
      records: [
        rec({ exercise_name: "Bankdrücken", achieved_on: "2026-11-12" }),
        rec({ exercise_name: "Kniebeuge", achieved_on: "2026-11-01" }),
      ],
      run_records: [
        runRec("longest_distance", 10_000, "2026-11-14"),
        runRec("longest_duration", 3600, "2026-11-05"),
        runRec("fastest_1k", 290, "2026-11-03"),
        runRec("best_5k", null),
        runRec("best_10k", null),
      ],
    } as unknown as ArnoldHome);
    expect(rows.map((r) => r.exercise)).toEqual([
      "Längster Lauf",
      "Bankdrücken",
      "Längste Laufdauer",
      "Schnellster Kilometer",
    ]);
  });
});

describe("latestRecords keeps one running record", () => {
  it("gives the newest running record the fourth place when strength is newer", () => {
    const rows = latestRecords({
      records: [12, 11, 10, 9].map((d) =>
        rec({
          exercise_name: `Übung ${d}`,
          achieved_on: `2026-11-${String(d).padStart(2, "0")}`,
        }),
      ),
      run_records: [
        runRec("longest_distance", 8000, "2026-11-01"),
        runRec("longest_duration", 3000, "2026-11-03"),
        runRec("fastest_1k", null),
        runRec("best_5k", null),
        runRec("best_10k", null),
      ],
    } as unknown as ArnoldHome);
    expect(rows.map((r) => r.exercise)).toEqual([
      "Übung 12",
      "Übung 11",
      "Übung 10",
      "Längste Laufdauer",
    ]);
  });
});
