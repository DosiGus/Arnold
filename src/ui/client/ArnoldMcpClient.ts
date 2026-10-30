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
import {
  OnboardingBriefSchema,
  OnboardingHandoffSchema,
  OnboardingResponseSchema,
  OnboardingStateSchema,
  type OnboardingProfilePatch,
  type OnboardingStep,
} from "../../shared/onboarding-contract";
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
import { z } from "zod";
import type { ArnoldClient } from "../client";
import {
  clearStoredClaim,
  readStoredClaim,
  writeStoredClaim,
  type OnboardingClaim,
} from "./onboarding-claim";

export type { OnboardingClaim };

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
  /** Held in memory so an opaque MCP App origin without storage still works. */
  private onboardingClaim?: OnboardingClaim;
  constructor(private readonly client: ArnoldClient) {}
  async connectGoogle() {
    const result = z
      .object({ authorization_url: z.string().url() })
      .parse(await this.client.call("connect_google_account", this.claim()));
    await this.client.openExternal(result.authorization_url);
  }
  async finishSetup() {
    return z
      .object({ spreadsheet_url: z.string().url() })
      .parse(await this.client.call("finish_arnold_setup", this.claim()));
  }
  async openDashboard() {
    await this.client.call("show_arnold_dashboard");
  }
  /** Tells the model what the app shows, without starting a chat turn. */
  async tellModel(text: string) {
    return this.client.updateModelContext(text);
  }
  /** Hands the next turn to the chat, as if the user had typed `text`. */
  async askChat(text: string) {
    return (await this.client.sendChatMessage?.(text)) ?? false;
  }
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

  /* ------------------------------------------------------------ onboarding */

  /**
   * Remembers the session secret for this setup.
   *
   * Kept in `sessionStorage` so a reload inside the same tab continues the
   * setup instead of starting a new one, and in memory as the fallback for an
   * opaque app origin that has no storage at all. It is scoped to the session id
   * and deliberately not `localStorage`: a setup secret should not outlive the
   * browser session that created it.
   */
  rememberOnboarding(claim: OnboardingClaim) {
    this.onboardingClaim = claim;
    writeStoredClaim(claim);
  }

  getOnboardingClaim(): OnboardingClaim | undefined {
    if (this.onboardingClaim) return this.onboardingClaim;
    const stored = readStoredClaim();
    if (stored) this.onboardingClaim = stored;
    return stored;
  }

  forgetOnboarding() {
    this.onboardingClaim = undefined;
    clearStoredClaim();
  }

  /** The claim, or a thrown error: no onboarding call is made without one. */
  private claim(): OnboardingClaim {
    const claim = this.getOnboardingClaim();
    if (!claim)
      throw new Error(
        "Für diese Einrichtung liegt kein Sitzungsnachweis vor. Bitte die Einrichtung neu starten.",
      );
    return claim;
  }

  async startOnboarding(request_id: string, resume?: OnboardingClaim) {
    const response = OnboardingResponseSchema.parse(
      await this.client.call("start_arnold_onboarding", {
        request_id,
        ...(resume ? { resume_session: resume } : {}),
      }),
    );
    if (response.ok && response.state && response.session_token)
      this.rememberOnboarding({
        onboarding_session_id: response.state.session.onboarding_session_id,
        session_token: response.session_token,
      });
    return response;
  }

  async onboardingState() {
    return OnboardingStateSchema.parse(
      await this.client.call("get_onboarding_state", this.claim()),
    );
  }

  async onboardingBrief() {
    return OnboardingBriefSchema.parse(
      await this.client.call("get_onboarding_brief", this.claim()),
    );
  }

  /** One onboarding write. Every response is validated before the UI sees it. */
  private async writeOnboarding(tool: string, input: Record<string, unknown>) {
    return OnboardingResponseSchema.parse(
      await this.client.call(tool, { ...this.claim(), ...input }),
    );
  }

  async saveOnboardingProfile(input: {
    request_id: string;
    expected_revision: number;
    profile?: OnboardingProfilePatch;
    step?: OnboardingStep;
  }) {
    return this.writeOnboarding("update_onboarding_profile", input);
  }

  async requestOnboardingPlan(input: {
    request_id: string;
    expected_revision: number;
  }) {
    return this.writeOnboarding("request_onboarding_plan", input);
  }

  async submitOnboardingProposal(input: Record<string, unknown>) {
    return this.writeOnboarding("submit_onboarding_plan_proposal", input);
  }

  async confirmOnboardingPlan(input: {
    request_id: string;
    expected_revision: number;
    confirmation: {
      plan_version_id: string;
      row_revision: number;
      confirmed: true;
    };
  }) {
    return this.writeOnboarding("confirm_onboarding_plan", input);
  }

  async reviseOnboardingPlan(input: {
    request_id: string;
    expected_revision: number;
    reason?: string;
  }) {
    return this.writeOnboarding("revise_onboarding_plan", input);
  }

  async cancelOnboarding(input: { request_id: string; reason?: string }) {
    return this.writeOnboarding("cancel_onboarding", input);
  }

  async onboardingHandoff() {
    const parsed = z
      .object({
        handoff: OnboardingHandoffSchema,
        state: OnboardingStateSchema,
      })
      .parse(await this.client.call("get_onboarding_handoff", this.claim()));
    return parsed;
  }

  /* -------------------------------------------------------------- workouts */

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
      await this.client.call("get_arnold_dashboard", args(query), {
        publish: false,
      }),
    );
  }

  async workouts(query: HistoryQuery = {}): Promise<ArnoldWorkoutHistoryView> {
    return ArnoldWorkoutHistoryViewSchema.parse(
      await this.client.call("get_arnold_workouts", args(query)),
    );
  }

  async progress(query: ProgressQuery): Promise<ArnoldExerciseProgressView> {
    return ArnoldExerciseProgressViewSchema.parse(
      await this.client.call("get_arnold_exercise_progress", args(query)),
    );
  }
}
