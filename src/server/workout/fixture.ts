import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import type { ArnoldDataSource } from "../arnold-source.js";
import { WorkoutLoggingService } from "./service.js";
import {
  FixtureAuthorizationGuard,
  InMemoryArnoldWriteRepository,
  InMemoryAuditLog,
  InMemoryOperationLedger,
  InProcessWriteCoordinator,
  WriteError,
  type OperationLedger,
  type AuditLogRepository,
} from "./infrastructure.js";

export function workoutFixtureDataset(): ArnoldDataset {
  const config = {
    schema_id: "arnold.training_raw",
    schema_version: "1.0.0",
    template_version: "1.0.0",
    file_role: "USER_TRACKER",
    tracker_id: "arnold-fixture-tracker",
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
  const technical = {
    created_at_utc: "2026-01-01T00:00:00Z",
    updated_at_utc: "2026-01-01T00:00:00Z",
    row_revision: 1,
  };
  const specs = [
    [
      "fixture-bench",
      "Demo Bankdrücken",
      "barbell",
      "total",
      "bilateral_simultaneous",
      1,
    ],
    [
      "fixture-incline",
      "Demo Schrägbankdrücken",
      "dumbbell",
      "per_implement",
      "bilateral_simultaneous",
      2,
    ],
    [
      "fixture-row",
      "Demo Rudern einarmig",
      "dumbbell",
      "per_implement",
      "unilateral",
      1,
    ],
    [
      "fixture-curl",
      "Demo Curls alternierend",
      "dumbbell",
      "per_implement",
      "alternating",
      2,
    ],
    [
      "fixture-pullup",
      "Demo Klimmzüge",
      "bodyweight",
      "bodyweight_only",
      "bilateral_simultaneous",
      1,
    ],
  ];
  return ArnoldDatasetSchema.parse({
    config,
    configEntries: Object.entries(config).map(([key, value]) => ({
      key,
      value,
      description: null,
    })),
    exercises: specs.map(
      ([
        exercise_id,
        name_de,
        equipment,
        default_load_basis,
        default_execution_mode,
        default_implement_count,
      ]) => ({
        ...technical,
        exercise_id,
        name_de,
        name_en: null,
        equipment,
        family_key: exercise_id,
        variant_key: "fixture",
        primary_muscle: "Demo",
        default_load_basis,
        default_execution_mode,
        default_implement_count,
        status: "active",
      }),
    ),
    plans: [
      {
        ...technical,
        plan_version_id: "fixture-plan-v1",
        plan_family_id: "fixture-plan",
        version_no: 1,
        name: "Synthetischer Demoplan",
        split_key: null,
        status: "active",
        goal_key: null,
        days_per_week: 3,
        activated_at_utc: technical.created_at_utc,
        retired_at_utc: null,
      },
    ],
    planItems: specs.slice(0, 2).map((spec, i) => ({
      plan_item_id: `fixture-item-${i + 1}`,
      plan_version_id: "fixture-plan-v1",
      session_id: "fixture-push",
      session_order: 1,
      session_name: "Demo Push",
      exercise_id: spec[0],
      exercise_order: i + 1,
      target_sets: 3,
      rep_min: 8,
      rep_max: 12,
      target_load_kg: null,
      target_load_basis: spec[3],
      target_execution_mode: spec[4],
      target_implement_count: spec[5],
      rest_seconds: 120,
      notes: null,
      status: "active",
      row_revision: 1,
    })),
    workouts: [],
    sets: [],
  });
}
export function createFixtureLogging(
  dataset = workoutFixtureDataset(),
  ledger: OperationLedger = new InMemoryOperationLedger(),
  audit: AuditLogRepository = new InMemoryAuditLog(),
) {
  const repository = new InMemoryArnoldWriteRepository(dataset);
  let generation = 0;
  const source: ArnoldDataSource = {
    mode: "arnold_sheets",
    synthetic: true,
    label: "Arnold · Schreib-Fixture",
    description:
      "Ausschließlich synthetische Trainingsdaten. Lokaler Testmodus; kein persönliches Nutzerkonto.",
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
  const service = new WorkoutLoggingService({
    mode: "fixture",
    trackerId: dataset.config.tracker_id,
    repository,
    ledger,
    audit,
    coordinator: new InProcessWriteCoordinator(),
    authorization: new FixtureAuthorizationGuard(dataset.config.tracker_id),
    invalidate: () => source.invalidate(),
  });
  return {
    source,
    service,
    repository,
    ledger,
    audit,
    get generation() {
      return generation;
    },
  };
}
export function writeModeFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.ARNOLD_WRITE_MODE ?? "disabled";
  if (!["disabled", "fixture", "test_sheet", "production"].includes(mode))
    throw new WriteError("VALIDATION_ERROR", "ARNOLD_WRITE_MODE ist ungültig.");
  if (mode === "production")
    throw new WriteError(
      "PERMISSION_DENIED",
      "Produktion ist bis Task 007 gesperrt.",
    );
  if (mode === "test_sheet")
    throw new WriteError(
      "AUTH_REQUIRED",
      "Test-Sheets erfordern eine programmatisch eingebundene geprüfte Autorisierung; Umgebungswerte reichen nicht.",
    );
  if (mode === "fixture" && env.STORAGE_MODE !== "arnold_fixture")
    throw new WriteError(
      "PERMISSION_DENIED",
      "Fixture-Writes erfordern STORAGE_MODE=arnold_fixture; echte Sheets bleiben ausgeschlossen.",
    );
  if (env.STORAGE_MODE === "arnold_fixture" && mode !== "fixture")
    throw new WriteError(
      "PERMISSION_DENIED",
      "Arnold-Fixture erfordert ausdrücklich ARNOLD_WRITE_MODE=fixture.",
    );
  return mode as "disabled" | "fixture";
}
