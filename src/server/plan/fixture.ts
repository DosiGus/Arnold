/**
 * Synthetic plan runtime.
 *
 * Writable plan management runs only against an in-memory dataset. Nothing here
 * touches Google, the Arnold master file or any real tracker, and the tracker id
 * is a fixture id that the authorization guard accepts only for itself.
 *
 * The plan service and the workout logging service are deliberately wired to
 * the *same* repository, ledger, coordinator and audit log. That is what makes
 * the two domains safe together: a plan activation and a set write on the same
 * tracker serialise against each other, a repeated `request_id` is recognised
 * across both, and one audit trail describes the whole tracker.
 */
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import type { ArnoldDataSource } from "../arnold-source.js";
import {
  FixtureAuthorizationGuard,
  InMemoryArnoldWriteRepository,
  InMemoryAuditLog,
  InMemoryOperationLedger,
  InProcessWriteCoordinator,
  type AuditLogRepository,
  type OperationLedger,
} from "../workout/infrastructure.js";
import { WorkoutLoggingService } from "../workout/service.js";
import { TrainingPlanService } from "./service.js";

export const PLAN_FIXTURE_TRACKER = "arnold-plan-fixture-tracker";

const STAMP = "2026-01-01T00:00:00Z";
const technical = {
  created_at_utc: STAMP,
  updated_at_utc: STAMP,
  row_revision: 1,
};

/** Catalog entries covering every load convention and execution mode. */
const CATALOG = [
  [
    "plan-fx-bench",
    "Demo Bankdrücken",
    "Langhantel",
    "Brust",
    "press",
    "barbell",
    "total",
    "bilateral_simultaneous",
    1,
  ],
  [
    "plan-fx-db-bench",
    "Demo Kurzhantel-Bankdrücken",
    "Kurzhantel",
    "Brust",
    "press",
    "dumbbell",
    "per_implement",
    "bilateral_simultaneous",
    2,
  ],
  [
    "plan-fx-incline",
    "Demo Schrägbankdrücken",
    "Kurzhantel",
    "Brust",
    "press",
    "incline_dumbbell",
    "per_implement",
    "bilateral_simultaneous",
    2,
  ],
  [
    "plan-fx-lateral",
    "Demo Seitheben",
    "Kurzhantel",
    "Schultern",
    "raise",
    "lateral",
    "per_implement",
    "bilateral_simultaneous",
    2,
  ],
  [
    "plan-fx-pullup",
    "Demo Klimmzüge",
    "Körpergewicht",
    "Rücken",
    "pull",
    "bodyweight",
    "bodyweight_only",
    "bilateral_simultaneous",
    1,
  ],
  [
    "plan-fx-row",
    "Demo Rudern einarmig",
    "Kurzhantel",
    "Rücken",
    "row",
    "single_arm",
    "per_implement",
    "unilateral",
    1,
  ],
  [
    "plan-fx-pulldown",
    "Demo Latzug",
    "Maschine",
    "Rücken",
    "pulldown",
    "machine",
    "machine_display",
    "bilateral_simultaneous",
    1,
  ],
  [
    "plan-fx-curl",
    "Demo Bizepscurls",
    "Kurzhantel",
    "Bizeps",
    "curl",
    "alternating",
    "per_implement",
    "alternating",
    2,
  ],
  [
    "plan-fx-squat",
    "Demo Kniebeugen",
    "Langhantel",
    "Beine",
    "squat",
    "barbell",
    "total",
    "bilateral_simultaneous",
    1,
  ],
  [
    "plan-fx-legpress",
    "Demo Beinpresse",
    "Maschine",
    "Beine",
    "leg_press",
    "machine",
    "machine_display",
    "bilateral_simultaneous",
    1,
  ],
  [
    "plan-fx-legcurl",
    "Demo Beinbeuger",
    "Maschine",
    "Beine",
    "leg_curl",
    "machine",
    "machine_display",
    "bilateral_simultaneous",
    1,
  ],
  [
    "plan-fx-split-squat",
    "Demo Bulgarian Split Squats",
    "Kurzhantel",
    "Beine",
    "squat",
    "split",
    "per_implement",
    "unilateral",
    1,
  ],
  [
    "plan-fx-dip",
    "Demo Dips unterstützt",
    "Maschine",
    "Brust",
    "dip",
    "assisted",
    "assistance",
    "bilateral_simultaneous",
    1,
  ],
  [
    "plan-fx-retired",
    "Demo Fliegende (ausgemustert)",
    "Kurzhantel",
    "Brust",
    "fly",
    "legacy",
    "per_implement",
    "bilateral_simultaneous",
    2,
  ],
] as const;

export type PlanFixtureShape = "active_ppl" | "empty" | "draft_only";

/**
 * A synthetic tracker.
 *
 * `active_ppl` is the realistic case the editor is built against: an active
 * Push/Pull/Legs version, an archived predecessor, and completed workouts bound
 * to both — so that a plan change can be proven not to disturb history. The
 * split is a fixture choice, never a product assumption.
 */
export function planFixtureDataset(
  shape: PlanFixtureShape = "active_ppl",
): ArnoldDataset {
  const config = {
    schema_id: "arnold.training_raw",
    schema_version: "1.0.0",
    template_version: "1.0.0",
    file_role: "USER_TRACKER",
    tracker_id: PLAN_FIXTURE_TRACKER,
    unit_mass: "kg",
    date_storage: "ISO-8601",
    raw_data_policy: "NO_CALCULATED_COLUMNS",
    onboarding_storage: "BACKEND_ONLY",
    plan_history: "IMMUTABLE_VERSION_IDS",
    write_policy: "MCP_BACKEND_ONLY",
    master_data_policy: "NO_REAL_USER_DATA",
    deleted_record_policy: "TOMBSTONE",
    schema_fingerprint: "CONFIG|EXERCISES|PLANS|PLAN_ITEMS|WORKOUTS|SETS",
  };
  const exercises = CATALOG.map(
    ([
      exercise_id,
      name_de,
      equipment,
      primary_muscle,
      family_key,
      variant_key,
      default_load_basis,
      default_execution_mode,
      default_implement_count,
    ]) => ({
      ...technical,
      exercise_id,
      name_de,
      name_en: null,
      family_key,
      variant_key,
      equipment,
      primary_muscle,
      default_load_basis,
      default_execution_mode,
      default_implement_count,
      status: exercise_id === "plan-fx-retired" ? "retired" : "active",
    }),
  );

  const base = {
    config,
    configEntries: Object.entries(config).map(([key, value]) => ({
      key,
      value,
      description: null,
    })),
    exercises,
  };
  if (shape === "empty")
    return ArnoldDatasetSchema.parse({
      ...base,
      plans: [],
      planItems: [],
      workouts: [],
      sets: [],
    });

  // Version 1, archived: the predecessor whose history must stay intact.
  const v1Items = [
    [
      "pfx-i-101",
      "pfx-s-push",
      1,
      "Push",
      "plan-fx-bench",
      1,
      3,
      8,
      10,
      70,
      "total",
      "bilateral_simultaneous",
      1,
      120,
    ],
    [
      "pfx-i-102",
      "pfx-s-push",
      1,
      "Push",
      "plan-fx-lateral",
      2,
      3,
      12,
      15,
      10,
      "per_implement",
      "bilateral_simultaneous",
      2,
      60,
    ],
    [
      "pfx-i-103",
      "pfx-s-pull",
      2,
      "Pull",
      "plan-fx-pullup",
      1,
      3,
      5,
      8,
      null,
      "bodyweight_only",
      "bilateral_simultaneous",
      1,
      120,
    ],
    [
      "pfx-i-104",
      "pfx-s-legs",
      3,
      "Legs",
      "plan-fx-squat",
      1,
      3,
      6,
      8,
      90,
      "total",
      "bilateral_simultaneous",
      1,
      180,
    ],
  ] as const;
  // Version 2, active: lateral raises moved last, dumbbell bench added.
  const v2Items = [
    [
      "pfx-i-201",
      "pfx-s-push",
      1,
      "Push",
      "plan-fx-bench",
      1,
      4,
      6,
      8,
      75,
      "total",
      "bilateral_simultaneous",
      1,
      150,
    ],
    [
      "pfx-i-202",
      "pfx-s-push",
      1,
      "Push",
      "plan-fx-incline",
      2,
      3,
      10,
      12,
      20,
      "per_implement",
      "bilateral_simultaneous",
      2,
      90,
    ],
    [
      "pfx-i-203",
      "pfx-s-push",
      1,
      "Push",
      "plan-fx-lateral",
      3,
      3,
      12,
      15,
      10,
      "per_implement",
      "bilateral_simultaneous",
      2,
      60,
    ],
    [
      "pfx-i-204",
      "pfx-s-pull",
      2,
      "Pull",
      "plan-fx-pullup",
      1,
      4,
      5,
      8,
      null,
      "bodyweight_only",
      "bilateral_simultaneous",
      1,
      120,
    ],
    [
      "pfx-i-205",
      "pfx-s-pull",
      2,
      "Pull",
      "plan-fx-row",
      2,
      3,
      10,
      12,
      24,
      "per_implement",
      "unilateral",
      1,
      90,
    ],
    [
      "pfx-i-206",
      "pfx-s-pull",
      2,
      "Pull",
      "plan-fx-curl",
      3,
      3,
      10,
      12,
      12,
      "per_implement",
      "alternating",
      2,
      60,
    ],
    [
      "pfx-i-207",
      "pfx-s-legs",
      3,
      "Legs",
      "plan-fx-squat",
      1,
      4,
      5,
      6,
      95,
      "total",
      "bilateral_simultaneous",
      1,
      180,
    ],
    [
      "pfx-i-208",
      "pfx-s-legs",
      3,
      "Legs",
      "plan-fx-legpress",
      2,
      3,
      10,
      12,
      120,
      "machine_display",
      "bilateral_simultaneous",
      1,
      120,
    ],
    [
      "pfx-i-209",
      "pfx-s-legs",
      3,
      "Legs",
      "plan-fx-legcurl",
      3,
      3,
      12,
      15,
      45,
      "machine_display",
      "bilateral_simultaneous",
      1,
      90,
    ],
  ] as const;

  const item = (
    row: (typeof v1Items)[number] | (typeof v2Items)[number],
    plan_version_id: string,
  ) => ({
    plan_item_id: row[0],
    plan_version_id,
    session_id: row[1],
    session_order: row[2],
    session_name: row[3],
    exercise_id: row[4],
    exercise_order: row[5],
    target_sets: row[6],
    rep_min: row[7],
    rep_max: row[8],
    target_load_kg: row[9],
    target_load_basis: row[10],
    target_execution_mode: row[11],
    target_implement_count: row[12],
    rest_seconds: row[13],
    notes: null,
    status: "active",
    row_revision: 1,
  });

  const plans = [
    {
      ...technical,
      plan_version_id: "pfx-v1",
      plan_family_id: "pfx-family-ppl",
      version_no: 1,
      name: "Push Pull Legs",
      split_key: "ppl",
      status: "archived",
      goal_key: "hypertrophy",
      days_per_week: 3,
      activated_at_utc: "2026-02-01T06:00:00Z",
      retired_at_utc: "2026-04-01T06:00:00Z",
      created_at_utc: "2026-01-20T06:00:00Z",
      updated_at_utc: "2026-04-01T06:00:00Z",
    },
    {
      ...technical,
      plan_version_id: "pfx-v2",
      plan_family_id: "pfx-family-ppl",
      version_no: 2,
      name: "Push Pull Legs angepasst",
      split_key: "ppl",
      status: shape === "draft_only" ? "draft" : "active",
      goal_key: "hypertrophy",
      days_per_week: 3,
      activated_at_utc: shape === "draft_only" ? null : "2026-04-01T06:00:00Z",
      retired_at_utc: null,
      created_at_utc: "2026-03-25T06:00:00Z",
      updated_at_utc: "2026-04-01T06:00:00Z",
    },
  ];

  // One completed workout per version, so "history stays intact" is testable.
  const workouts =
    shape === "draft_only"
      ? []
      : [
          {
            ...technical,
            workout_id: "pfx-w1",
            workout_date_local: "2026-02-10",
            timezone: "Europe/Berlin",
            started_at_utc: "2026-02-10T17:00:00Z",
            ended_at_utc: "2026-02-10T18:10:00Z",
            plan_version_id: "pfx-v1",
            session_id: "pfx-s-push",
            session_name_snapshot: "Push",
            status: "completed",
            source: "ui",
            notes: null,
            created_at_utc: "2026-02-10T17:00:00Z",
            updated_at_utc: "2026-02-10T18:10:00Z",
          },
          {
            ...technical,
            workout_id: "pfx-w2",
            workout_date_local: "2026-04-07",
            timezone: "Europe/Berlin",
            started_at_utc: "2026-04-07T17:00:00Z",
            ended_at_utc: "2026-04-07T18:20:00Z",
            plan_version_id: "pfx-v2",
            session_id: "pfx-s-push",
            session_name_snapshot: "Push",
            status: "completed",
            source: "ui",
            notes: null,
            created_at_utc: "2026-04-07T17:00:00Z",
            updated_at_utc: "2026-04-07T18:20:00Z",
          },
        ];

  const setRow = (
    set_id: string,
    workout_id: string,
    exercise_id: string,
    plan_item_id: string,
    name: string,
    set_number: number,
    reps: number,
    load_kg: number | null,
    load_basis: string,
    implement_count: number,
    stamp: string,
  ) => ({
    set_id,
    workout_id,
    exercise_id,
    plan_item_id,
    exercise_name_snapshot: name,
    exercise_order: 1,
    set_number,
    set_type: "working",
    reps,
    reps_basis: "total",
    load_kg,
    load_basis,
    implement_count,
    execution_mode: "bilateral_simultaneous",
    side: "both",
    rpe: null,
    rir: null,
    notes: null,
    status: "active",
    source: "ui",
    created_at_utc: stamp,
    updated_at_utc: stamp,
    row_revision: 1,
  });

  const sets =
    shape === "draft_only"
      ? []
      : [
          setRow(
            "pfx-set-1",
            "pfx-w1",
            "plan-fx-bench",
            "pfx-i-101",
            "Demo Bankdrücken",
            1,
            10,
            70,
            "total",
            1,
            "2026-02-10T17:10:00Z",
          ),
          setRow(
            "pfx-set-2",
            "pfx-w1",
            "plan-fx-bench",
            "pfx-i-101",
            "Demo Bankdrücken",
            2,
            9,
            70,
            "total",
            1,
            "2026-02-10T17:20:00Z",
          ),
          setRow(
            "pfx-set-3",
            "pfx-w2",
            "plan-fx-bench",
            "pfx-i-201",
            "Demo Bankdrücken",
            1,
            8,
            75,
            "total",
            1,
            "2026-04-07T17:10:00Z",
          ),
          setRow(
            "pfx-set-4",
            "pfx-w2",
            "plan-fx-bench",
            "pfx-i-201",
            "Demo Bankdrücken",
            2,
            7,
            75,
            "total",
            1,
            "2026-04-07T17:20:00Z",
          ),
        ];

  return ArnoldDatasetSchema.parse({
    ...base,
    plans,
    planItems: [
      ...v1Items.map((row) => item(row, "pfx-v1")),
      ...v2Items.map((row) => item(row, "pfx-v2")),
    ],
    workouts,
    sets,
  });
}

export type PlanFixtureRuntime = {
  source: ArnoldDataSource;
  plans: TrainingPlanService;
  service: WorkoutLoggingService;
  repository: InMemoryArnoldWriteRepository;
  ledger: OperationLedger;
  audit: InMemoryAuditLog | AuditLogRepository;
  readonly generation: number;
};

/**
 * One synthetic tracker served by both services.
 *
 * `clock` and `id` are injectable so tests are deterministic; production code
 * never passes them.
 */
export function createFixturePlanning(
  dataset: ArnoldDataset = planFixtureDataset(),
  options: {
    ledger?: OperationLedger;
    audit?: AuditLogRepository;
    clock?: () => Date;
    id?: () => string;
  } = {},
): PlanFixtureRuntime {
  const repository = new InMemoryArnoldWriteRepository(dataset);
  const ledger = options.ledger ?? new InMemoryOperationLedger();
  const audit = options.audit ?? new InMemoryAuditLog();
  const coordinator = new InProcessWriteCoordinator();
  const authorization = new FixtureAuthorizationGuard(
    dataset.config.tracker_id,
  );
  let generation = 0;
  const source: ArnoldDataSource = {
    mode: "arnold_sheets",
    label: "Arnold · Plan-Fixture",
    description:
      "Ausschließlich synthetische Trainingspläne. Lokaler Testmodus; kein persönliches Nutzerkonto und keine Google-Datei.",
    async load() {
      return {
        dataset: await repository.read(),
        fetchedAt: new Date().toISOString(),
        ageMs: 0,
      };
    },
    invalidate() {
      generation++;
    },
  };
  const shared = {
    trackerId: dataset.config.tracker_id,
    repository,
    ledger,
    coordinator,
    audit,
    authorization,
    invalidate: () => source.invalidate(),
    clock: options.clock,
    id: options.id,
  };
  return {
    source,
    repository,
    ledger,
    audit,
    plans: new TrainingPlanService({
      mode: "fixture",
      read: async () => repository.read(),
      ...shared,
    }),
    service: new WorkoutLoggingService({ mode: "fixture", ...shared }),
    get generation() {
      return generation;
    },
  };
}
