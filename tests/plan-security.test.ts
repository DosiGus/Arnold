import { describe, expect, it } from "vitest";
import { draft, harness, itemOf, session } from "./fixtures/arnold-plan";
import {
  PLAN_FIXTURE_TRACKER,
  createFixturePlanning,
  planFixtureDataset,
} from "../src/server/plan/fixture";
import { TrainingPlanService } from "../src/server/plan/service";
import {
  DenyAuthorizationGuard,
  FixtureAuthorizationGuard,
  InMemoryArnoldStore,
  InMemoryAuditLog,
  canonical,
} from "../src/server/workout/infrastructure";
import { ArnoldDatasetSchema } from "../src/shared/arnold-schema-v1";

/** Service over a given dataset and guard, for the negative cases. */
function serviceWith(
  options: {
    dataset?: ReturnType<typeof planFixtureDataset>;
    guard?: { authorize: (...args: never[]) => Promise<never> };
    trackerId?: string;
    mode?: "disabled" | "fixture";
  } = {},
) {
  const dataset = options.dataset ?? planFixtureDataset();
  return new TrainingPlanService({
    mode: options.mode ?? "fixture",
    trackerId: options.trackerId ?? dataset.config.tracker_id,
    store: new InMemoryArnoldStore(dataset),
    authorization:
      (options.guard as never) ??
      new FixtureAuthorizationGuard(
        options.trackerId ?? dataset.config.tracker_id,
      ),
  });
}

const minimalPlan = {
  request_id: "r1",
  name: "Test",
  sessions: [session("A")],
};

describe("write protection", () => {
  it("refuses any plan write against the master template", async () => {
    const template = ArnoldDatasetSchema.parse({
      ...planFixtureDataset("empty"),
      config: {
        ...planFixtureDataset("empty").config,
        file_role: "MASTER_TEMPLATE",
        tracker_id: "TEMPLATE_UNASSIGNED",
      },
      configEntries: Object.entries({
        ...planFixtureDataset("empty").config,
        file_role: "MASTER_TEMPLATE",
        tracker_id: "TEMPLATE_UNASSIGNED",
      }).map(([key, value]) => ({ key, value, description: null })),
    });
    const service = serviceWith({
      dataset: template,
      trackerId: "TEMPLATE_UNASSIGNED",
    });
    const response = await service.createTrainingPlan(minimalPlan);
    expect(response.ok).toBe(false);
    expect(response.error!.code).toBe("TEMPLATE_WRITE_FORBIDDEN");
  });

  it("refuses a database write mode over an in-memory store", () => {
    const dataset = planFixtureDataset();
    expect(
      () =>
        new TrainingPlanService({
          mode: "database",
          trackerId: dataset.config.tracker_id,
          store: new InMemoryArnoldStore(dataset),
          authorization: new FixtureAuthorizationGuard(
            dataset.config.tracker_id,
          ),
        }),
    ).toThrow();
  });

  it("refuses every write when the mode is disabled", async () => {
    const service = serviceWith({ mode: "disabled" });
    const response = await service.createTrainingPlan(minimalPlan);
    expect(response.ok).toBe(false);
    expect(response.error!.code).toBe("PERMISSION_DENIED");
  });

  it("reports no write capability when the mode is disabled", async () => {
    const service = serviceWith({ mode: "disabled" });
    const context = await service.context();
    expect(context.can_write).toBe(false);
    expect(context.write_mode).toBe("disabled");
    // Reads keep working, so the editor can still show the active plan.
    expect(context.plan).not.toBeNull();
  });

  it("refuses an unverified identity", async () => {
    const service = serviceWith({
      guard: new DenyAuthorizationGuard() as never,
    });
    const response = await service.createTrainingPlan(minimalPlan);
    expect(response.ok).toBe(false);
    expect(response.error!.code).toBe("AUTH_REQUIRED");
  });

  it("refuses a foreign tracker", async () => {
    const service = serviceWith({
      guard: new FixtureAuthorizationGuard("someone-elses-tracker") as never,
    });
    const response = await service.createTrainingPlan(minimalPlan);
    expect(response.ok).toBe(false);
    expect(["PERMISSION_DENIED", "AUTH_REQUIRED"]).toContain(
      response.error!.code,
    );
  });

  it("refuses a guard that claims an unverified actor", async () => {
    const service = serviceWith({
      guard: {
        authorize: async () =>
          ({
            subject: "spoof",
            trackerId: PLAN_FIXTURE_TRACKER,
            permissions: ["write"],
            verified: false,
            kind: "fixture",
          }) as never,
      },
    });
    const response = await service.createTrainingPlan(minimalPlan);
    expect(response.ok).toBe(false);
    expect(response.error!.code).toBe("AUTH_REQUIRED");
  });

  it("refuses an actor without the write permission", async () => {
    const service = serviceWith({
      guard: {
        authorize: async () =>
          ({
            subject: "reader",
            trackerId: PLAN_FIXTURE_TRACKER,
            permissions: [],
            verified: true,
            kind: "fixture",
          }) as never,
      },
    });
    const response = await service.createTrainingPlan(minimalPlan);
    expect(response.error!.code).toBe("PERMISSION_DENIED");
  });

  it("leaves no partial write behind when an operation is refused", async () => {
    const h = harness();
    const before = canonical(await h.dataset());
    await h.fails("create_training_plan", {
      request_id: "r1",
      name: "Teilweise",
      sessions: [session("Gut"), session("Kaputt", ["ghost-exercise"])],
    });
    expect(canonical(await h.dataset())).toBe(before);
  });
});

describe("concurrency and idempotency", () => {
  it("detects a stale draft revision", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("A")]);
    await h.ok("update_plan_draft", {
      request_id: "first",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [{ type: "update_plan_metadata", name: "Erste Änderung" }],
    });
    // A second client still holds the old revision.
    const error = await h.fails("update_plan_draft", {
      request_id: "second",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [{ type: "update_plan_metadata", name: "Zweite Änderung" }],
    });
    expect(error.code).toBe("REVISION_CONFLICT");
    expect(error.details.join(" ")).toMatch(/current_row_revision=/);
    // The first change survived; the second did not overwrite it.
    const plan = (await h.dataset()).plans.find(
      (p) => p.plan_version_id === version.plan_version_id,
    )!;
    expect(plan.name).toBe("Erste Änderung");
  });

  it("replays an identical repeated request instead of applying it twice", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("Push", ["plan-fx-bench"])]);
    const input = {
      request_id: "same-id",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "add_plan_exercise",
          session_id: version.sessions[0].session_id,
          exercise_id: "plan-fx-lateral",
        },
      ],
    };
    const first = await h.write("update_plan_draft", input);
    const second = await h.write("update_plan_draft", input);
    expect(first.ok && second.ok).toBe(true);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    // The exercise was added exactly once.
    const rows = (await h.dataset()).planItems.filter(
      (i) =>
        i.plan_version_id === version.plan_version_id && i.status === "active",
    );
    expect(
      rows.filter((r) => r.exercise_id === "plan-fx-lateral"),
    ).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  it("refuses a reused request id carrying a different payload", async () => {
    const h = harness("empty");
    const version = await draft(h, [session("A")]);
    await h.ok("update_plan_draft", {
      request_id: "shared",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [{ type: "update_plan_metadata", name: "Eins" }],
    });
    const error = await h.fails("update_plan_draft", {
      request_id: "shared",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision + 1,
      edits: [{ type: "update_plan_metadata", name: "Zwei" }],
    });
    expect(error.code).toBe("DUPLICATE_OPERATION");
  });

  it("serialises a plan write and a workout write on the same tracker", async () => {
    const h = harness();
    const [plan, workout] = await Promise.all([
      h.write("create_plan_version", {
        request_id: "p1",
        source_plan_version_id: "pfx-v2",
      }),
      h.service.startWorkout({
        request_id: "w1",
        workout_date_local: "2026-06-01",
        timezone: "Europe/Berlin",
        session_name: "Push",
      }),
    ]);
    expect(plan.ok).toBe(true);
    expect(workout.ok).toBe(true);
    // Both committed against a consistent dataset.
    const data = await h.dataset();
    expect(ArnoldDatasetSchema.safeParse(data).success).toBe(true);
  });

  it("keeps the dataset valid after a long sequence of edits", async () => {
    const h = harness("empty");
    let version = await draft(h, [session("A"), session("B")]);
    for (let round = 0; round < 6; round++) {
      const ids = version.sessions.map((s) => s.session_id);
      const result = await h.ok("update_plan_draft", {
        request_id: `round-${round}`,
        plan_version_id: version.plan_version_id,
        expected_row_revision: version.row_revision,
        edits: [
          {
            type: "add_plan_exercise",
            session_id: ids[round % ids.length],
            exercise_id: "plan-fx-lateral",
          },
          { type: "reorder_sessions", session_ids: [...ids].reverse() },
        ],
      });
      version = result.plan!.version;
      expect(ArnoldDatasetSchema.safeParse(await h.dataset()).success).toBe(
        true,
      );
    }
    expect(version.row_revision).toBe(7);
  });
});

describe("the audit trail", () => {
  it("records plan creation with business-readable events", async () => {
    const runtime = createFixturePlanning(planFixtureDataset("empty"));
    const audit = runtime.store.audit as InMemoryAuditLog;
    const response = await runtime.plans.createTrainingPlan({
      request_id: "audit-1",
      name: "Auditplan",
      sessions: [session("Push", ["plan-fx-bench", "plan-fx-lateral"])],
    });
    expect(response.ok).toBe(true);
    const types = [...audit.events.values()].map((e) => e.event_type);
    expect(types).toContain("PLAN_CREATED");
    expect(types).toContain("PLAN_DRAFT_CREATED");
    expect(types).toContain("SESSION_ADDED");
    expect(types.filter((t) => t === "PLAN_EXERCISE_ADDED")).toHaveLength(2);
    for (const event of audit.events.values()) {
      expect(event.result).toBe("verified");
      expect(event.operation_id).toBe("audit-1");
      // Only the acting subject is logged, no further personal data.
      expect(event.actor).toBe("synthetic-fixture");
    }
  });

  it("records an activation and the archiving of its predecessor", async () => {
    const runtime = createFixturePlanning(planFixtureDataset());
    const audit = runtime.store.audit as InMemoryAuditLog;
    const created = await runtime.plans.createPlanVersion({
      request_id: "a1",
      source_plan_version_id: "pfx-v2",
    });
    const version = created.result!.plan!.version;
    await runtime.plans.activateTrainingPlan({
      request_id: "a2",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      confirmation: {
        plan_version_id: version.plan_version_id,
        row_revision: version.row_revision,
        confirmed: true,
      },
    });
    const types = [...audit.events.values()].map((e) => e.event_type);
    expect(types).toContain("PLAN_ACTIVATED");
    expect(types).toContain("PLAN_ARCHIVED");
    expect(types).toContain("PLAN_VALIDATED");
    const activated = [...audit.events.values()].find(
      (e) => e.event_type === "PLAN_ACTIVATED",
    )!;
    expect(activated.entity_id).toBe(version.plan_version_id);
    expect(activated.changes.status).toEqual({
      before: "draft",
      after: "active",
    });
  });

  it("records a replacement and a removal distinctly", async () => {
    const runtime = createFixturePlanning(planFixtureDataset());
    const audit = runtime.store.audit as InMemoryAuditLog;
    const created = await runtime.plans.createPlanVersion({
      request_id: "a1",
      source_plan_version_id: "pfx-v2",
    });
    const version = created.result!.plan!.version;
    const bench = itemOf(version, "plan-fx-bench", "Push");
    const lateral = itemOf(version, "plan-fx-lateral", "Push");
    await runtime.plans.updatePlanDraft({
      request_id: "a2",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "replace_plan_exercise",
          plan_item_id: bench.plan_item_id,
          new_exercise_id: "plan-fx-db-bench",
        },
        { type: "remove_plan_exercise", plan_item_id: lateral.plan_item_id },
      ],
    });
    const types = [...audit.events.values()].map((e) => e.event_type);
    expect(types).toContain("PLAN_DRAFT_UPDATED");
    expect(types).toContain("PLAN_EXERCISE_REPLACED");
    expect(types).toContain("PLAN_EXERCISE_REMOVED");
  });

  it("does not double-log a replayed operation", async () => {
    const runtime = createFixturePlanning(planFixtureDataset("empty"));
    const audit = runtime.store.audit as InMemoryAuditLog;
    const input = {
      request_id: "once",
      name: "Einmal",
      sessions: [session("A")],
    };
    await runtime.plans.createTrainingPlan(input);
    const size = audit.events.size;
    const replayed = await runtime.plans.createTrainingPlan(input);
    expect(replayed.replayed).toBe(true);
    expect(audit.events.size).toBe(size);
  });
});

describe("validation registers", () => {
  it("separates blocking errors from advice", async () => {
    const h = harness("empty");
    // One training day a week is a legitimate choice, not a defect.
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Einmal pro Woche",
      days_per_week: 1,
      sessions: [session("Ganzkörper")],
    });
    expect(result.validation!.valid).toBe(true);
    expect(result.validation!.activatable).toBe(true);
    expect(result.validation!.errors).toHaveLength(0);
  });

  it("offers a recommendation when days per week and sessions disagree", async () => {
    const h = harness("empty");
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Rotierend",
      days_per_week: 4,
      sessions: [session("A"), session("B"), session("C")],
    });
    expect(result.validation!.valid).toBe(true);
    expect(result.validation!.recommendations.map((r) => r.code)).toContain(
      "DAYS_PER_WEEK_MISMATCH",
    );
    // A recommendation never blocks activation.
    expect(result.validation!.activatable).toBe(true);
  });

  it("warns about a duplicated exercise but still allows activation", async () => {
    const h = harness("empty");
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Zweimal Bank",
      sessions: [session("Push", ["plan-fx-bench", "plan-fx-bench"])],
    });
    expect(result.validation!.valid).toBe(true);
    expect(result.validation!.warnings.map((w) => w.code)).toContain(
      "DUPLICATE_EXERCISE_IN_SESSION",
    );
  });

  it("reports an active version as not activatable", async () => {
    const h = harness();
    const validation = await h.plans.validate({ plan_version_id: "pfx-v2" });
    expect(validation.activatable).toBe(false);
    expect(validation.errors.map((e) => e.code)).toContain("PLAN_NOT_A_DRAFT");
  });

  it("names the schema it validated against", async () => {
    const h = harness();
    const validation = await h.plans.validate({ plan_version_id: "pfx-v2" });
    expect(validation.schema_id).toBe("arnold.training_raw");
    expect(validation.schema_version).toBe("1.0.0");
  });

  it("reports the empty-session schema limit on a draft that has one", async () => {
    const h = harness("empty");
    const result = await h.ok("create_training_plan", {
      request_id: "r1",
      name: "Test",
      sessions: [session("A", ["plan-fx-bench", "plan-fx-lateral"])],
    });
    const version = result.plan!.version;
    const removed = await h.ok("update_plan_draft", {
      request_id: "r2",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: version.sessions[0].exercises.map((e) => ({
        type: "remove_plan_exercise",
        plan_item_id: e.plan_item_id,
      })),
    });
    expect(removed.validation!.valid).toBe(false);
    // With every position tombstoned the session no longer exists at all: a
    // session is only representable through its plan items.
    expect(removed.validation!.errors.map((e) => e.code)).toContain(
      "NO_SESSION",
    );
    expect(removed.validation!.errors[0].message).toMatch(
      /mindestens eine Einheit/,
    );
    expect(removed.plan!.version.session_count).toBe(0);
  });
});
