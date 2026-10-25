/**
 * Synthetic Arnold schema v1 datasets for the dashboard integration tests.
 *
 * Every identifier, exercise name, plan and training value here is invented for
 * tests. Nothing is read from, or written to, the real Arnold master file.
 */
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../src/shared/arnold-schema-v1";
import {
  CONFIG_VALUES,
  exercise,
  plan,
  planItem,
  set,
  workout,
  type DatasetParts,
} from "./arnold-analytics";

const STAMP = "2026-09-01T06:00:00Z";

export const EXERCISES = {
  bench: "ex-test-bench",
  row: "ex-test-row-single",
  press: "ex-test-machine-press",
  dip: "ex-test-dip-assisted",
  pullup: "ex-test-pullup",
  retired: "ex-test-retired-fly",
} as const;

function build(parts: DatasetParts): ArnoldDataset {
  const config = { ...CONFIG_VALUES, ...parts.config };
  return ArnoldDatasetSchema.parse({
    config,
    configEntries: Object.entries(config).map(([key, value]) => ({
      key,
      value,
      description: null,
    })),
    exercises: parts.exercises ?? [],
    plans: parts.plans ?? [],
    planItems: parts.planItems ?? [],
    workouts: parts.workouts ?? [],
    sets: parts.sets ?? [],
  });
}

const catalog = [
  exercise({
    exercise_id: EXERCISES.bench,
    name_de: "Testbankdrücken",
    family_key: "test_press",
    variant_key: "barbell",
    equipment: "Langhantel",
    primary_muscle: "Brust",
    default_load_basis: "total",
  }),
  exercise({
    exercise_id: EXERCISES.row,
    name_de: "Testrudern einarmig",
    family_key: "test_row",
    variant_key: "single_arm",
    equipment: "Kurzhantel",
    primary_muscle: "Rücken",
    default_load_basis: "per_implement",
    default_execution_mode: "unilateral",
    default_implement_count: 1,
  }),
  exercise({
    exercise_id: EXERCISES.press,
    name_de: "Testmaschinendrücken",
    family_key: "test_press",
    variant_key: "machine",
    equipment: "Maschine",
    primary_muscle: "Brust",
    default_load_basis: "machine_display",
  }),
  exercise({
    exercise_id: EXERCISES.dip,
    name_de: "Testdips unterstützt",
    family_key: "test_dip",
    variant_key: "assisted",
    equipment: "Maschine",
    primary_muscle: "Trizeps",
    default_load_basis: "assistance",
  }),
  exercise({
    exercise_id: EXERCISES.pullup,
    name_de: "Testklimmzüge",
    family_key: "test_pull",
    variant_key: "bodyweight",
    equipment: "Klimmzugstange",
    primary_muscle: "Rücken",
    default_load_basis: "bodyweight_only",
  }),
  exercise({
    exercise_id: EXERCISES.retired,
    name_de: "Testfliegende (beendet)",
    family_key: "test_fly",
    variant_key: "dumbbell",
    equipment: "Kurzhantel",
    primary_muscle: "Brust",
    default_load_basis: "per_implement",
    status: "retired",
  }),
];

const plans = [
  plan({
    plan_version_id: "pv-test-1",
    plan_family_id: "pf-test",
    version_no: 1,
    name: "Testplan Oberkörper v1",
    status: "archived",
    days_per_week: 3,
    activated_at_utc: "2026-08-01T06:00:00Z",
    retired_at_utc: "2026-09-28T06:00:00Z",
  }),
  plan({
    plan_version_id: "pv-test-2",
    plan_family_id: "pf-test",
    version_no: 2,
    name: "Testplan Oberkörper v2",
    status: "active",
    days_per_week: 3,
    activated_at_utc: "2026-09-28T06:00:00Z",
  }),
];

const planItems = [
  planItem({
    plan_item_id: "pi-test-1",
    plan_version_id: "pv-test-1",
    session_id: "sess-upper-a",
    session_name: "Oberkörper A",
    exercise_id: EXERCISES.bench,
    exercise_order: 1,
    target_sets: 3,
  }),
  planItem({
    plan_item_id: "pi-test-2",
    plan_version_id: "pv-test-1",
    session_id: "sess-upper-a",
    session_name: "Oberkörper A",
    exercise_id: EXERCISES.retired,
    exercise_order: 2,
    target_sets: 3,
    status: "removed",
  }),
  planItem({
    plan_item_id: "pi-test-3",
    plan_version_id: "pv-test-2",
    session_id: "sess-upper-a",
    session_name: "Oberkörper A",
    exercise_id: EXERCISES.bench,
    exercise_order: 1,
    target_sets: 3,
  }),
  planItem({
    plan_item_id: "pi-test-4",
    plan_version_id: "pv-test-2",
    session_id: "sess-upper-a",
    session_name: "Oberkörper A",
    exercise_id: EXERCISES.row,
    exercise_order: 2,
    target_sets: 2,
    target_load_basis: "per_implement",
    target_execution_mode: "unilateral",
    target_implement_count: 1,
  }),
  planItem({
    plan_item_id: "pi-test-5",
    plan_version_id: "pv-test-2",
    session_id: "sess-lower-b",
    session_name: "Unterkörper B",
    session_order: 2,
    exercise_id: EXERCISES.press,
    exercise_order: 1,
    target_sets: 3,
    target_load_basis: "machine_display",
  }),
];

const row = (
  id: string,
  workoutId: string,
  side: "left" | "right",
  number: number,
) =>
  set({
    set_id: id,
    workout_id: workoutId,
    exercise_id: EXERCISES.row,
    exercise_name_snapshot: "Testrudern einarmig",
    exercise_order: 2,
    set_number: number,
    load_kg: 20,
    reps: 10,
    load_basis: "per_implement",
    implement_count: 1,
    execution_mode: "unilateral",
    side,
  });

const bench = (
  id: string,
  workoutId: string,
  number: number,
  kg: number,
  reps: number,
  planItemId: string | null = null,
) =>
  set({
    set_id: id,
    workout_id: workoutId,
    exercise_id: EXERCISES.bench,
    exercise_name_snapshot: "Testbankdrücken",
    exercise_order: 1,
    set_number: number,
    load_kg: kg,
    reps,
    load_basis: "total",
    plan_item_id: planItemId,
  });

/**
 * A tracker with several weeks of history, two plan versions, unilateral work,
 * per-implement dumbbells, a machine load, an assisted and a bodyweight
 * exercise, a cancelled session and a voided set.
 */
export function fullDataset(): ArnoldDataset {
  return build({
    exercises: catalog,
    plans,
    planItems,
    workouts: [
      workout({
        workout_id: "w-test-1",
        workout_date_local: "2026-09-07",
        plan_version_id: "pv-test-1",
        session_id: "sess-upper-a",
        session_name_snapshot: "Oberkörper A",
        created_at_utc: STAMP,
        updated_at_utc: STAMP,
      }),
      workout({
        workout_id: "w-test-2",
        workout_date_local: "2026-09-14",
        plan_version_id: "pv-test-1",
        session_id: "sess-upper-a",
        session_name_snapshot: "Oberkörper A",
        created_at_utc: STAMP,
        updated_at_utc: STAMP,
      }),
      workout({
        workout_id: "w-test-3",
        workout_date_local: "2026-10-05",
        plan_version_id: "pv-test-2",
        session_id: "sess-upper-a",
        session_name_snapshot: "Oberkörper A",
      }),
      workout({
        workout_id: "w-test-4",
        workout_date_local: "2026-10-12",
        plan_version_id: "pv-test-2",
        session_id: "sess-lower-b",
        session_name_snapshot: "Unterkörper B",
      }),
      // A spontaneous session with no plan reference at all.
      workout({
        workout_id: "w-test-5",
        workout_date_local: "2026-10-19",
        plan_version_id: null,
        session_id: null,
        session_name_snapshot: "Freies Training",
      }),
      workout({
        workout_id: "w-test-6",
        workout_date_local: "2026-10-20",
        plan_version_id: null,
        session_id: null,
        session_name_snapshot: "Abgebrochene Einheit",
        status: "cancelled",
      }),
    ],
    sets: [
      bench("s-test-1", "w-test-1", 1, 60, 10, "pi-test-1"),
      bench("s-test-2", "w-test-1", 2, 70, 8, "pi-test-1"),
      bench("s-test-3", "w-test-1", 3, 70, 7, "pi-test-1"),
      // The retired exercise appears only in the oldest workout.
      set({
        set_id: "s-test-4",
        workout_id: "w-test-1",
        exercise_id: EXERCISES.retired,
        exercise_name_snapshot: "Testfliegende (beendet)",
        exercise_order: 3,
        set_number: 1,
        load_kg: 12,
        reps: 12,
        load_basis: "per_implement",
        implement_count: 2,
      }),
      bench("s-test-5", "w-test-2", 1, 70, 10, "pi-test-1"),
      bench("s-test-6", "w-test-3", 1, 75, 8, "pi-test-3"),
      bench("s-test-7", "w-test-3", 2, 75, 8, "pi-test-3"),
      row("s-test-8", "w-test-3", "right", 1),
      row("s-test-9", "w-test-3", "left", 2),
      set({
        set_id: "s-test-10",
        workout_id: "w-test-4",
        exercise_id: EXERCISES.press,
        exercise_name_snapshot: "Testmaschinendrücken",
        exercise_order: 1,
        set_number: 1,
        load_kg: 55,
        reps: 12,
        load_basis: "machine_display",
        plan_item_id: "pi-test-5",
      }),
      set({
        set_id: "s-test-11",
        workout_id: "w-test-4",
        exercise_id: EXERCISES.dip,
        exercise_name_snapshot: "Testdips unterstützt",
        exercise_order: 2,
        set_number: 1,
        load_kg: 25,
        reps: 10,
        load_basis: "assistance",
      }),
      set({
        set_id: "s-test-12",
        workout_id: "w-test-5",
        exercise_id: EXERCISES.pullup,
        exercise_name_snapshot: "Testklimmzüge",
        exercise_order: 1,
        set_number: 1,
        load_kg: null,
        reps: 8,
        load_basis: "bodyweight_only",
      }),
      // A warm-up set must not count as a working set.
      set({
        set_id: "s-test-13",
        workout_id: "w-test-5",
        exercise_id: EXERCISES.bench,
        exercise_name_snapshot: "Testbankdrücken",
        exercise_order: 2,
        set_number: 1,
        set_type: "warmup",
        load_kg: 40,
        reps: 12,
      }),
      // A voided set must disappear from every metric but stay traceable.
      set({
        set_id: "s-test-14",
        workout_id: "w-test-5",
        exercise_id: EXERCISES.bench,
        exercise_name_snapshot: "Testbankdrücken",
        exercise_order: 2,
        set_number: 2,
        load_kg: 999,
        reps: 1,
        status: "voided",
      }),
      set({
        set_id: "s-test-15",
        workout_id: "w-test-6",
        exercise_id: EXERCISES.bench,
        exercise_name_snapshot: "Testbankdrücken",
        exercise_order: 1,
        set_number: 1,
        load_kg: 60,
        reps: 5,
      }),
    ],
  });
}

/** The first-run case: catalog and tables present, no workouts at all. */
export function emptyTrackerDataset(): ArnoldDataset {
  return build({ exercises: catalog });
}

/** The shared master template; it must never look like a personal account. */
export function masterTemplateDataset(): ArnoldDataset {
  return build({
    exercises: catalog,
    config: {
      file_role: "MASTER_TEMPLATE",
      tracker_id: "TEMPLATE_UNASSIGNED",
    },
  });
}

/** One single logged set, for the single-measurement-point case. */
export function singleSetDataset(): ArnoldDataset {
  return build({
    exercises: catalog,
    workouts: [
      workout({
        workout_id: "w-single",
        workout_date_local: "2026-10-01",
        session_name_snapshot: "Einzeltraining",
      }),
    ],
    sets: [bench("s-single", "w-single", 1, 70, 8)],
  });
}
