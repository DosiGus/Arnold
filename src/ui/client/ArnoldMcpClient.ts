import { AbandonWriteResponseSchema } from "../../shared/write-recovery";
import {
  WorkoutContextSchema,
  WriteResponseSchema,
  type WriteOperation,
} from "../../shared/workout-contract";
import {
  PlanContextSchema,
  PlanHistorySchema,
  PlanValidationResultSchema,
  PlanVersionComparisonSchema,
  PlanWriteResponseSchema,
  TrainingPlanListSchema,
  type PlanWriteOperation,
} from "../../shared/plan-contract";
/**
 * Typed access to the Arnold v2 MCP tools.
 *
 * The views call these methods and never assemble tool names or parse tool
 * results themselves, so MCP stays one layer with one place to validate. Every
 * response is checked against its Zod schema here: a malformed payload becomes a
 * thrown error rather than a half-rendered dashboard.
 */
import {
  ArnoldDashboardViewSchema,
  ArnoldExerciseProgressViewSchema,
  ArnoldWorkoutHistoryViewSchema,
  type ArnoldDashboardView,
  type ArnoldExerciseProgressView,
  type ArnoldWorkoutHistoryView,
  type ProgressMetricKey,
} from "../../shared/arnold-view";
import type { ArnoldClient } from "../client";

export type DashboardQuery = {
  from?: string;
  to?: string;
  plan_version_ids?: string[];
  session_ids?: string[];
  exercise_ids?: string[];
  weekly_goal_training_days?: number;
};

export type HistoryQuery = {
  from?: string;
  to?: string;
  plan_version_ids?: string[];
  session_ids?: string[];
  session_name?: string;
  exercise_ids?: string[];
  workout_statuses?: string[];
  limit?: number;
  offset?: number;
};

export type ProgressQuery = {
  exercise_id: string;
  from?: string;
  to?: string;
  metric?: ProgressMetricKey;
};

/** Drops empty values so an unset filter is absent rather than null. */
function args(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) =>
        value !== undefined &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0),
    ),
  );
}

export class ArnoldMcpClient {
  private pendingWrites = new Map<string, string>();
  private pendingPlanWrites = new Map<string, string>();
  constructor(private readonly client: ArnoldClient) {}
  getPending(tracker: string) {
    let saved = this.pendingWrites.get(tracker);
    try {
      saved ??=
        sessionStorage.getItem(`arnold.workout.pending.${tracker}`) ??
        undefined;
    } catch {
      /* opaque MCP App origins have no browser storage */
    }
    try {
      return saved ? JSON.parse(saved) : undefined;
    } catch {
      return undefined;
    }
  }
  putPending(tracker: string, value: unknown) {
    const saved = JSON.stringify(value);
    this.pendingWrites.set(tracker, saved);
    try {
      sessionStorage.setItem(`arnold.workout.pending.${tracker}`, saved);
    } catch {
      /* retain in the shared client across view changes */
    }
  }
  clearPending(tracker: string) {
    this.pendingWrites.delete(tracker);
    try {
      sessionStorage.removeItem(`arnold.workout.pending.${tracker}`);
    } catch {
      /* no browser storage */
    }
  }

  /**
   * The same unconfirmed-write bookkeeping for plan operations, under its own
   * key. A pending plan write and a pending set write must never overwrite each
   * other: both have to stay recoverable with their original request_id.
   */
  private planKey = (tracker: string) => `arnold.plan.pending.${tracker}`;
  getPendingPlan(tracker: string) {
    let saved = this.pendingPlanWrites.get(tracker);
    try {
      saved ??= sessionStorage.getItem(this.planKey(tracker)) ?? undefined;
    } catch {
      /* opaque MCP App origins have no browser storage */
    }
    try {
      return saved ? JSON.parse(saved) : undefined;
    } catch {
      return undefined;
    }
  }
  putPendingPlan(tracker: string, value: unknown) {
    const saved = JSON.stringify(value);
    this.pendingPlanWrites.set(tracker, saved);
    try {
      sessionStorage.setItem(this.planKey(tracker), saved);
    } catch {
      /* retain in the shared client across view changes */
    }
  }
  clearPendingPlan(tracker: string) {
    this.pendingPlanWrites.delete(tracker);
    try {
      sessionStorage.removeItem(this.planKey(tracker));
    } catch {
      /* no browser storage */
    }
  }

  async abandonRejected(request_id: string) {
    return AbandonWriteResponseSchema.parse(
      await this.client.call("abandon_rejected_write", { request_id }),
    );
  }
  async workout(workout_id?: string) {
    return WorkoutContextSchema.parse(
      await this.client.call("get_workout", workout_id ? { workout_id } : {}),
    );
  }
  async write(operation: WriteOperation, input: Record<string, unknown>) {
    return WriteResponseSchema.parse(await this.client.call(operation, input));
  }

  /* ------------------------------------------------------- training plans */

  /** Everything the plan editor needs for one render. */
  async planContext(plan_version_id?: string) {
    return PlanContextSchema.parse(
      await this.client.call(
        "get_plan_editor_context",
        plan_version_id ? { plan_version_id } : {},
      ),
    );
  }
  async planHistory(plan_family_id?: string) {
    return PlanHistorySchema.parse(
      await this.client.call(
        "get_plan_history",
        plan_family_id ? { plan_family_id } : {},
      ),
    );
  }
  async planList() {
    return TrainingPlanListSchema.parse(
      await this.client.call("list_training_plans", {}),
    );
  }
  async validatePlan(plan_version_id: string) {
    return PlanValidationResultSchema.parse(
      await this.client.call("validate_training_plan", { plan_version_id }),
    );
  }
  async comparePlans(from_plan_version_id: string, to_plan_version_id: string) {
    return PlanVersionComparisonSchema.parse(
      await this.client.call("compare_plan_versions", {
        from_plan_version_id,
        to_plan_version_id,
      }),
    );
  }
  /** One plan write. The response is always validated before the UI sees it. */
  async writePlan(
    operation: PlanWriteOperation,
    input: Record<string, unknown>,
  ) {
    return PlanWriteResponseSchema.parse(
      await this.client.call(operation, input),
    );
  }

  get embedded() {
    return this.client.embedded;
  }

  async dashboard(query: DashboardQuery = {}): Promise<ArnoldDashboardView> {
    return ArnoldDashboardViewSchema.parse(
      await this.client.call("get_arnold_dashboard_v2", args(query), {
        publish: false,
      }),
    );
  }

  async workouts(query: HistoryQuery = {}): Promise<ArnoldWorkoutHistoryView> {
    return ArnoldWorkoutHistoryViewSchema.parse(
      await this.client.call("get_arnold_workouts_v2", args(query)),
    );
  }

  async progress(query: ProgressQuery): Promise<ArnoldExerciseProgressView> {
    return ArnoldExerciseProgressViewSchema.parse(
      await this.client.call("get_arnold_exercise_progress_v2", args(query)),
    );
  }
}
