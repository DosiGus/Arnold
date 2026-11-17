import { MarkRecapSeenOutputSchema } from "../../shared/recap-contract";
import type { DashboardCard } from "../../shared/dashboard-cards";
import type { RunCard } from "../../shared/run-card-contract";
import { OnboardingProfileBuffer } from "./OnboardingProfileBuffer";
import { ArnoldToolError } from "../recovery";
import { DeleteAccountResponseSchema } from "../../shared/account-contract";
import {
  SetGarminHealthConsentResponseSchema,
  UnpairGarminWatchResponseSchema,
} from "../../shared/watch-contract";
import type { GarminPayload } from "../client";
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
  PlanAdjustmentListSchema,
  PlanAdjustmentWriteResponseSchema,
} from "../../shared/plan-adjustment-contract";
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
import {
  GetRunWeekInputSchema,
  RunAnalysisResponseSchema,
  RunProfileResponseSchema,
  RunWeekResponseSchema,
  RunWriteResponseSchema,
  ScheduleRunWeekResponseSchema,
  type RunWriteOperation,
} from "../../shared/run-contract";
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
  /** The user's IANA zone, so the server can tell which day is today. */
  timezone?: string;
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
  private profileBuffers = new Map<string, OnboardingProfileBuffer>();
  profileBuffer(
    initial: import("../../shared/onboarding-contract").OnboardingState,
  ) {
    const sessionId = initial.session.onboarding_session_id;
    let buffer = this.profileBuffers.get(sessionId);
    if (!buffer) {
      buffer = new OnboardingProfileBuffer({
        sessionId,
        initial,
        save: (profile, request_id, expected_revision) => {
          if (this.getOnboardingClaim()?.onboarding_session_id !== sessionId)
            throw new ArnoldToolError({
              code: "SESSION_NOT_FOUND",
              recovery: "start_over",
            });
          return this.saveOnboardingProfile({
            profile,
            request_id,
            expected_revision,
          });
        },
      });
      this.profileBuffers.set(sessionId, buffer);
    } else buffer.adopt(initial);
    return buffer;
  }
  constructor(private readonly client: ArnoldClient) {}
  private refreshListeners = new Set<() => void>();
  subscribeRefresh(listener: () => void) {
    this.refreshListeners.add(listener);
    return () => {
      this.refreshListeners.delete(listener);
    };
  }
  refreshViews() {
    this.refreshListeners.forEach((listener) => listener());
    window.dispatchEvent(new Event("arnold:refresh"));
  }
  async showOnboarding() {
    await this.client.call(
      "show_arnold_onboarding",
      this.getOnboardingClaim() ?? {},
    );
  }
  async deleteAccount(confirmation_token?: string) {
    return DeleteAccountResponseSchema.parse(
      await this.client.call(
        "delete_arnold_account",
        confirmation_token ? { confirmation_token } : {},
        { publish: false },
      ),
    );
  }
  /** Without a token: the confirmation card. With it: the user's click pairs. */
  async pairGarminWatch(args: {
    user_code: string;
    timezone: string;
    confirmation_token?: string;
  }) {
    return this.garmin(
      await this.client.call("pair_garmin_watch", args, { publish: false }),
    );
  }
  async listGarminWatches() {
    const payload = this.garmin(
      await this.client.call("list_garmin_watches", {}, { publish: false }),
    );
    if (payload.kind !== "watches")
      throw new Error("Unerwartete Antwort von list_garmin_watches.");
    return payload.watches;
  }
  /** Switches the app to the watches of the account. */
  async openGarminWatches() {
    await this.client.call("list_garmin_watches");
  }
  async unpairGarminWatch(device_id: string) {
    return UnpairGarminWatchResponseSchema.parse(
      await this.client.call(
        "unpair_garmin_watch",
        { device_id },
        { publish: false },
      ),
    );
  }
  /** Granting refers to the text version the card showed; revoking needs none. */
  async setGarminHealthConsent(granted: boolean, text_version?: string) {
    return SetGarminHealthConsentResponseSchema.parse(
      await this.client.call(
        "set_garmin_health_consent",
        granted ? { granted, text_version } : { granted },
        { publish: false },
      ),
    );
  }
  private garmin(value: unknown): GarminPayload {
    const payload = value as GarminPayload | undefined;
    if (payload?.kind !== "pair" && payload?.kind !== "watches")
      throw new Error("Unerwartete Antwort der Garmin-Tools.");
    return payload;
  }
  async openLink(url: string) {
    await this.client.openExternal(url);
  }
  async displayMode(mode: "inline" | "fullscreen") {
    return this.client.displayMode(mode);
  }
  /** Switches the app to a dashboard card; the training card by default. */
  async openDashboard(card: DashboardCard = "today") {
    await this.client.call("show_arnold_dashboard", { card });
  }
  /** Switches the app to a run card (`show_arnold_run`); the card loads its own numbers. */
  async openRun(card: RunCard) {
    await this.client.call("show_arnold_run", { card });
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
    if (
      this.onboardingClaim?.onboarding_session_id !==
      claim.onboarding_session_id
    )
      this.pendingOnboarding = undefined;
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
    for (const buffer of this.profileBuffers.values()) buffer.suspend();
    this.clearPendingOnboarding();
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

  private pendingOnboarding?: { tool: string; input: Record<string, unknown> };
  private onboardingPendingKey() {
    return `arnold.onboarding.pending.${this.claim().onboarding_session_id}`;
  }
  private readPendingOnboarding() {
    if (this.pendingOnboarding) return this.pendingOnboarding;
    try {
      const raw = sessionStorage.getItem(this.onboardingPendingKey());
      if (raw) {
        const parsed = z
          .object({
            tool: z.enum([
              "update_onboarding_profile",
              "request_onboarding_plan",
              "submit_onboarding_plan_proposal",
              "confirm_onboarding_plan",
              "finish_arnold_setup",
              "revise_onboarding_plan",
              "cancel_onboarding",
            ]),
            input: z.record(z.string(), z.unknown()),
          })
          .parse(JSON.parse(raw));
        this.pendingOnboarding = parsed;
      }
    } catch {
      /* An opaque origin retains the in-memory operation. */
    }
    return this.pendingOnboarding;
  }
  hasPendingOnboarding() {
    return Boolean(this.readPendingOnboarding());
  }
  async retryOnboarding() {
    const pending = this.readPendingOnboarding();
    if (pending) return this.writeOnboarding(pending.tool, pending.input);
  }
  private clearPendingOnboarding(
    key?: string,
    operation = this.pendingOnboarding,
  ) {
    if (this.pendingOnboarding === operation)
      this.pendingOnboarding = undefined;
    try {
      sessionStorage.removeItem(key ?? this.onboardingPendingKey());
    } catch {
      /* no storage */
    }
  }
  /** Writes remain immutable across a lost response and a browser reload. */
  private async writeOnboarding(tool: string, input: Record<string, unknown>) {
    const claim = this.claim();
    const storageKey = this.onboardingPendingKey();
    const existing = this.readPendingOnboarding();
    if (
      existing &&
      (existing.tool !== tool || existing.input.request_id !== input.request_id)
    )
      throw new ArnoldToolError({
        code: "COMMIT_STATUS_UNKNOWN",
        recovery: "retry_same_request",
      });
    // Once dispatched, a retry uses the original arguments, including its
    // revision. A later caller must not replace an uncertain operation.
    if (existing) input = existing.input;
    const pending = { tool, input };
    this.pendingOnboarding = pending;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify(this.pendingOnboarding),
      );
    } catch {
      /* no storage */
    }
    const result = OnboardingResponseSchema.parse(
      await this.client.call(tool, { ...claim, ...input }),
    );
    if (result.ok || result.error?.recovery !== "retry_same_request")
      this.clearPendingOnboarding(storageKey, pending);
    return result;
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

  /** Activates the confirmed plan and completes the setup. Safe to repeat. */
  async finishOnboarding(input: { request_id: string }) {
    return this.writeOnboarding("finish_arnold_setup", input);
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
  /** Marks the recap of a workout as seen (receipt on the server, no training data). */
  async markRecapSeen(workout_id: string) {
    return MarkRecapSeenOutputSchema.parse(
      await this.client.call("mark_recap_seen", { workout_id }),
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
  /* ----------------------------------------- adjustment for a while (UX-008) */

  async planAdjustments(plan_adjustment_id?: string) {
    return PlanAdjustmentListSchema.parse(
      await this.client.call(
        "get_plan_adjustments",
        plan_adjustment_id ? { plan_adjustment_id } : {},
      ),
    );
  }
  async writePlanAdjustment(
    operation: "confirm_plan_adjustment" | "cancel_plan_adjustment",
    input: {
      request_id: string;
      plan_adjustment_id: string;
      expected_row_revision: number;
    },
  ) {
    return PlanAdjustmentWriteResponseSchema.parse(
      await this.client.call(operation, input),
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

  async historyWorkout(workout_id: string) {
    const context = await this.workout(workout_id);
    if (!context.workout)
      throw new ArnoldToolError({
        code: "WORKOUT_NOT_FOUND",
        recovery: "reload_then_retry",
      });
    const date = context.workout.workout_date_local;
    return this.workouts({
      from: date,
      to: date,
      workout_statuses: [
        "planned",
        "in_progress",
        "completed",
        "cancelled",
        "voided",
      ],
      limit: 200,
    });
  }

  async progress(query: ProgressQuery): Promise<ArnoldExerciseProgressView> {
    return ArnoldExerciseProgressViewSchema.parse(
      await this.client.call("get_arnold_exercise_progress", args(query)),
    );
  }

  /* ------------------------------------------------------------- running */
  /** Every call below is a run tool; the card shows what comes back, nothing else. */
  async runWeek(input: z.infer<typeof GetRunWeekInputSchema>) {
    return RunWeekResponseSchema.parse(
      await this.client.call("get_run_week", input, { publish: false }),
    );
  }
  async runAnalysis(input: {
    view: "run" | "week" | "four_weeks";
    workout_id?: string;
    date?: string;
    timezone: string;
  }) {
    return RunAnalysisResponseSchema.parse(
      await this.client.call("get_run_analysis", input, { publish: false }),
    );
  }
  async runProfile(timezone?: string) {
    return RunProfileResponseSchema.parse(
      await this.client.call("get_run_profile", timezone ? { timezone } : {}, {
        publish: false,
      }),
    );
  }
  /** Step 1 without `confirm`; step 2 with the hash of the preview the user saw. */
  async scheduleRunWeek(input: {
    timezone: string;
    confirm?: boolean;
    request_id?: string;
    preview_hash?: string;
  }) {
    return ScheduleRunWeekResponseSchema.parse(
      await this.client.call("schedule_run_week", input, { publish: false }),
    );
  }
  async runWrite(operation: RunWriteOperation, input: Record<string, unknown>) {
    return RunWriteResponseSchema.parse(
      await this.client.call(operation, input, { publish: false }),
    );
  }
}
