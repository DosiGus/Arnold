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
  constructor(private readonly client: ArnoldClient) {}

  get embedded() {
    return this.client.embedded;
  }

  async dashboard(query: DashboardQuery = {}): Promise<ArnoldDashboardView> {
    return ArnoldDashboardViewSchema.parse(
      await this.client.call("get_arnold_dashboard_v2", args(query)),
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
