/**
 * The plan change and the adjustment card (src/views/model/plan-change.ts)
 * against the real tools: the card's inputs activate exactly the revision on
 * screen, a draft edited in the meantime is refused.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PlanAdjustmentListSchema,
  PlanAdjustmentWriteResponseSchema,
} from "../src/shared/plan-adjustment-contract";
import {
  PlanContextSchema,
  PlanVersionComparisonSchema,
  PlanWriteResponseSchema,
} from "../src/shared/plan-contract";
import {
  adjustmentInput,
  adjustmentModel,
  applyPlanInput,
  declinePlanInput,
  pickAdjustment,
  planChangeCandidate,
  planChangeModel,
  watchLine,
} from "../src/views/model/plan-change";
import { cardServer, type CardServer } from "./fixtures/views-cards";

let server: CardServer;
beforeEach(async () => {
  server = await cardServer();
});
afterEach(() => server.close());

const context = () => server.read("get_plan_editor_context", PlanContextSchema);

async function draft(name: string) {
  const created = await server.read(
    "create_plan_version",
    PlanWriteResponseSchema,
    { request_id: randomUUID(), source_plan_version_id: "pfx-v2" },
  );
  const version = created.result!.plan!.version;
  await server.read("update_plan_draft", PlanWriteResponseSchema, {
    request_id: randomUUID(),
    plan_version_id: version.plan_version_id,
    expected_row_revision: version.row_revision,
    edits: [{ type: "update_plan_metadata", name }],
  });
}

async function model() {
  const ctx = await context();
  const candidate = planChangeCandidate(ctx);
  if (candidate.kind !== "compare") throw new Error(candidate.reason);
  const comparison = await server.read(
    "compare_plan_versions",
    PlanVersionComparisonSchema,
    {
      from_plan_version_id: candidate.from,
      to_plan_version_id: candidate.draft.plan_version_id,
    },
  );
  return planChangeModel(ctx, comparison)!;
}

describe("plan change card", () => {
  it("says why nothing waits for a yes", async () => {
    const ctx = await context();
    expect(planChangeCandidate({ ...ctx, drafts: [] })).toEqual({
      kind: "none",
      reason: "no_draft",
    });
    expect(
      planChangeCandidate({ ...ctx, active_plan_version_id: null }),
    ).toEqual({ kind: "none", reason: "no_active" });
  });

  it("shows the difference and activates it with one input", async () => {
    await draft("Neuer Plan");
    const m = await model();
    expect(m.rows).toContainEqual(
      expect.objectContaining({ label: "Planname", after: "Neuer Plan" }),
    );
    const done = await server.read(
      "activate_training_plan",
      PlanWriteResponseSchema,
      applyPlanInput(m, randomUUID()),
    );
    expect(done.ok).toBe(true);
    expect((await context()).active_plan_version_id).toBe(m.planVersionId);
  });

  it("is refused when the draft changed meanwhile, and can discard", async () => {
    await draft("Erster Name");
    const shown = await model();
    await server.read("update_plan_draft", PlanWriteResponseSchema, {
      request_id: randomUUID(),
      plan_version_id: shown.planVersionId,
      expected_row_revision: shown.rowRevision,
      edits: [{ type: "update_plan_metadata", name: "Zweiter Name" }],
    });
    await expect(
      server.read(
        "activate_training_plan",
        PlanWriteResponseSchema,
        applyPlanInput(shown, randomUUID()),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const done = await server.read(
      "archive_plan_draft",
      PlanWriteResponseSchema,
      declinePlanInput(await model(), randomUUID()),
    );
    expect(done.ok).toBe(true);
    expect((await context()).drafts).toEqual([]);
  });

  it("says something about the watch only when it knows", () => {
    expect(watchLine("delivered")).toContain("auf deiner Uhr");
    expect(watchLine("pending")).toContain("Verbinden");
    expect(watchLine("no_watch")).toBeNull();
    expect(watchLine(undefined)).toBeNull();
  });
});

describe("adjustment card", () => {
  const list = () =>
    server.read("get_plan_adjustments", PlanAdjustmentListSchema);

  it("shows the draft and confirms, then cancels it", async () => {
    expect(pickAdjustment(await list())).toBeNull();
    await server.read(
      "create_plan_adjustment",
      PlanAdjustmentWriteResponseSchema,
      {
        request_id: randomUUID(),
        timezone: "Europe/Berlin",
        kind: "week",
        minutes_per_session: 20,
      },
    );
    const m = adjustmentModel(pickAdjustment(await list())!);
    expect(m).toMatchObject({ status: "draft", title: "Diese Woche" });
    expect(m.back).toContain("normaler Plan");
    expect(m.sessions.length).toBeGreaterThan(0);
    const confirmed = await server.read(
      "confirm_plan_adjustment",
      PlanAdjustmentWriteResponseSchema,
      adjustmentInput(m, randomUUID()),
    );
    const after = adjustmentModel(confirmed.result!.plan_adjustment);
    expect(after.status).toBe("confirmed");
    const cancelled = await server.read(
      "cancel_plan_adjustment",
      PlanAdjustmentWriteResponseSchema,
      adjustmentInput(after, randomUUID()),
    );
    expect(cancelled.result!.plan_adjustment.adjustment.status).toBe(
      "cancelled",
    );
  });
});
