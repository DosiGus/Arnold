/**
 * Deterministic harness for the plan management tests.
 *
 * Every identifier, exercise and plan here is synthetic. Nothing reads or
 * writes the Arnold master file, any real tracker or the database.
 *
 * IDs are sequential and the clock is fixed, so a test can assert on an exact
 * id or timestamp instead of matching a pattern.
 */
import { expect } from "vitest";
import {
  createFixturePlanning,
  planFixtureDataset,
  type PlanFixtureShape,
} from "../../src/server/plan/fixture";
import {
  PlanWriteResponseSchema,
  type PlanWriteOperation,
  type PlanWriteResponse,
  type TrainingPlanVersion,
} from "../../src/shared/plan-contract";
import type { ArnoldDataset } from "../../src/shared/arnold-schema-v1";

export const NOW = "2026-06-01T08:00:00Z";

export type Harness = ReturnType<typeof harness>;

export function harness(
  shape: PlanFixtureShape = "active_ppl",
  options: { now?: string } = {},
) {
  let counter = 0;
  let instant = Date.parse(options.now ?? NOW);
  const runtime = createFixturePlanning(planFixtureDataset(shape), {
    id: () => `gen-${String(++counter).padStart(3, "0")}`,
    clock: () => new Date(instant),
  });
  return {
    ...runtime,
    /** Moves the fixed clock forward, so two operations get distinct stamps. */
    advance(ms = 60_000) {
      instant += ms;
    },
    dataset: () => runtime.store.read(),
    async write(
      operation: PlanWriteOperation,
      input: Record<string, unknown>,
    ): Promise<PlanWriteResponse> {
      return PlanWriteResponseSchema.parse(
        await runtime.plans.execute(operation, input),
      );
    },
    /** Asserts the operation succeeded and returns its result. */
    async ok(operation: PlanWriteOperation, input: Record<string, unknown>) {
      const response = await this.write(operation, input);
      expect(
        response.error,
        `${operation} failed: ${response.error?.code} ${response.error?.message} ${response.error?.details.join("; ")}`,
      ).toBeNull();
      expect(response.ok).toBe(true);
      return response.result!;
    },
    /** Asserts the operation failed and returns the error code. */
    async fails(operation: PlanWriteOperation, input: Record<string, unknown>) {
      const response = await this.write(operation, input);
      expect(response.ok, `${operation} unexpectedly succeeded`).toBe(false);
      expect(response.result).toBeNull();
      return response.error!;
    },
  };
}

/** A minimal valid session input. */
export const session = (
  name: string,
  exercises: string[] = ["plan-fx-bench"],
  extra: Record<string, unknown> = {},
) => ({
  session_name: name,
  exercises: exercises.map((exercise_id) => ({
    exercise_id,
    target_sets: 3,
    rep_min: 8,
    rep_max: 12,
    ...extra,
  })),
});

/** Creates a draft and returns it, so a test can start from a known state. */
export async function draft(
  h: Harness,
  sessions = [session("Training A")],
  extra: Record<string, unknown> = {},
) {
  const result = await h.ok("create_training_plan", {
    request_id: `create-${Math.random().toString(36).slice(2)}`,
    name: "Testplan",
    sessions,
    ...extra,
  });
  return result.plan!.version;
}

/** Walks a version to find one planned exercise by its catalog id. */
export function itemOf(
  version: TrainingPlanVersion,
  exerciseId: string,
  sessionName?: string,
) {
  for (const s of version.sessions) {
    if (sessionName && s.session_name !== sessionName) continue;
    const found = s.exercises.find(
      (e) => e.exercise_id === exerciseId && e.status === "active",
    );
    if (found) return found;
  }
  throw new Error(
    `No active ${exerciseId} in ${sessionName ?? "plan"}; have ${version.sessions
      .flatMap((s) =>
        s.exercises.map(
          (e) => `${s.session_name}/${e.exercise_id}/${e.status}`,
        ),
      )
      .join(", ")}`,
  );
}

export const sessionOf = (version: TrainingPlanVersion, name: string) => {
  const found = version.sessions.find((s) => s.session_name === name);
  if (!found)
    throw new Error(
      `No session "${name}"; have ${version.sessions.map((s) => s.session_name).join(", ")}`,
    );
  return found;
};

/** Active plan items of one version, straight from the raw dataset. */
export const rawItems = (data: ArnoldDataset, planVersionId: string) =>
  data.planItems.filter((item) => item.plan_version_id === planVersionId);

export const names = (version: TrainingPlanVersion) =>
  version.sessions.map((s) => s.session_name);

export const exerciseNames = (
  version: TrainingPlanVersion,
  sessionName: string,
) =>
  sessionOf(version, sessionName)
    .exercises.filter((e) => e.status === "active")
    .map((e) => e.exercise_id);
