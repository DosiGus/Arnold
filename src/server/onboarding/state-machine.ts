/**
 * The onboarding state machine.
 *
 * This module is pure: a state and an event in, a new state or a refusal out.
 * No clock, no storage, no IDs, no React. That is what makes the rules testable
 * on their own and — more importantly — unbypassable: `OnboardingService` is
 * the only caller, and it has no second path that moves a status. A React
 * component or an MCP handler cannot set a status at all.
 *
 * Three properties are worth stating up front.
 *
 * First, going back is allowed while answers are being collected and forbidden
 * once a plan is confirmed. A user may freely revisit their goal; they may not
 * silently change a plan they released for setup. Asking for a change after the
 * confirmation is legal, but it *invalidates* the confirmation — the machine
 * reports that as an effect rather than letting an approved revision drift.
 *
 * Second, an expired session accepts nothing but `EXPIRE` and `CANCEL`. The
 * expiry check lives in the guard, not in the caller, so a forgotten check
 * cannot let a stale session keep writing.
 *
 * Third, `COMPLETED` needs evidence that the confirmed plan was activated,
 * which only the server's finishing step can produce. Without it the machine
 * refuses the transition instead of reporting a setup that never happened.
 */
import {
  PROFILE_STEPS,
  stepForStatus,
  type OnboardingErrorCode,
  type OnboardingPath,
  type OnboardingStatus,
  type OnboardingStep,
} from "../../shared/onboarding-contract.js";

/** The facts the rules are allowed to depend on. Nothing else is in scope. */
export interface OnboardingMachineState {
  status: OnboardingStatus;
  step: OnboardingStep;
  /** The path chosen on the welcome screen. Decides which screen collects answers. */
  path: OnboardingPath | null;
  /** Whether the required answers for the path are present. Computed, never stored. */
  profile_complete: boolean;
  has_plan_draft: boolean;
  has_confirmation: boolean;
  /** True once `expires_at_utc` has passed. */
  expired: boolean;
}

export type OnboardingEvent =
  | { type: "START" }
  /** `path` is the path *after* the save, which may be the one just chosen. */
  | {
      type: "SAVE_PROFILE";
      profile_complete: boolean;
      path: OnboardingPath | null;
    }
  /** Navigate to an earlier collection step. Changes the step, not the status. */
  | { type: "GO_BACK"; step: OnboardingStep }
  | { type: "REQUEST_PLAN" }
  | { type: "PLAN_PROPOSED" }
  /** The user wants to change a plan. After a confirmation this voids it. */
  | { type: "REVISE_PLAN" }
  | { type: "CONFIRM_PLAN" }
  | { type: "PREPARE_HANDOFF" }
  /** Only the server's finishing step, after activating the plan, sets `finish_verified`. */
  | { type: "SETUP_FINISHED"; finish_verified: boolean }
  | { type: "CANCEL" }
  | { type: "EXPIRE" }
  /** Re-open a session without changing anything. */
  | { type: "RESUME" };

export type OnboardingEventType = OnboardingEvent["type"];

/**
 * What the caller must persist alongside the new status.
 *
 * Returning these instead of mutating state keeps the machine pure while still
 * making "a change voids the confirmation" a machine rule rather than a
 * convention the service has to remember.
 */
export type TransitionEffect =
  | "clear_confirmation"
  | "clear_plan_draft"
  | "handoff_ready"
  | "handoff_not_ready"
  | "handoff_superseded";

export type TransitionResult =
  | {
      ok: true;
      state: OnboardingMachineState;
      effects: readonly TransitionEffect[];
    }
  | {
      ok: false;
      error: { code: OnboardingErrorCode; message: string };
    };

const refuse = (
  code: OnboardingErrorCode,
  message: string,
): TransitionResult => ({ ok: false, error: { code, message } });

/** Statuses from which no event but a terminal one is accepted. */
const TERMINAL: readonly OnboardingStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
];

export const isTerminal = (status: OnboardingStatus) =>
  TERMINAL.includes(status);

/** Statuses in which profile answers may still be collected or corrected. */
const COLLECTING: readonly OnboardingStatus[] = [
  "COLLECTING_PROFILE",
  "PROFILE_READY",
  "WAITING_FOR_PLAN_PROPOSAL",
];

const move = (
  state: OnboardingMachineState,
  status: OnboardingStatus,
  effects: readonly TransitionEffect[] = [],
  step: OnboardingStep = stepForStatus(status, state.path),
): TransitionResult => ({
  ok: true,
  state: { ...state, status, step },
  effects,
});

/**
 * The one transition function.
 *
 * Every status change in the product goes through here. The switch is on the
 * event rather than the status because each event has one meaning and a small
 * set of legal origins — which reads better than a table of mostly-empty cells
 * and keeps each refusal message specific to what the user actually tried.
 */
export function transitionOnboarding(
  state: OnboardingMachineState,
  event: OnboardingEvent,
): TransitionResult {
  // Cancelling is always allowed, even on an expired session: a user may
  // discard a setup at any time, and doing so must never fail.
  if (event.type === "CANCEL") {
    if (state.status === "CANCELLED")
      return move(state, "CANCELLED", ["handoff_not_ready"]);
    if (state.status === "COMPLETED")
      return refuse(
        "INVALID_STATE_TRANSITION",
        "Eine abgeschlossene Einrichtung kann nicht abgebrochen werden.",
      );
    return move(state, "CANCELLED", [
      "handoff_not_ready",
      "clear_confirmation",
    ]);
  }

  if (event.type === "EXPIRE") {
    if (state.status === "EXPIRED")
      return move(state, "EXPIRED", ["handoff_not_ready"]);
    if (isTerminal(state.status))
      return refuse(
        "INVALID_STATE_TRANSITION",
        "Diese Einrichtung ist bereits beendet.",
      );
    return move(state, "EXPIRED", ["handoff_not_ready", "clear_confirmation"]);
  }

  // Past this point an expired session is inert. Checked here rather than in
  // each branch so no future event can forget it.
  if (state.expired && state.status !== "EXPIRED")
    return refuse(
      "SESSION_EXPIRED",
      "Diese Einrichtungssitzung ist abgelaufen. Starte die Einrichtung neu; deine bisherigen Angaben sind nicht mehr abrufbar.",
    );

  if (state.status === "EXPIRED")
    return refuse(
      "SESSION_EXPIRED",
      "Diese Einrichtungssitzung ist abgelaufen. Starte die Einrichtung neu.",
    );
  if (state.status === "CANCELLED")
    return refuse(
      "SESSION_CANCELLED",
      "Diese Einrichtung wurde abgebrochen. Starte eine neue Einrichtung.",
    );

  switch (event.type) {
    case "RESUME":
      if (state.status === "COMPLETED")
        return refuse(
          "INVALID_STATE_TRANSITION",
          "Diese Einrichtung ist abgeschlossen.",
        );
      // Resuming is explicitly a no-op on the business state: it must not
      // advance a step or re-derive a status behind the user's back.
      return { ok: true, state, effects: [] };

    case "START":
      if (state.status === "NOT_STARTED")
        return move(state, "COLLECTING_PROFILE");
      // Starting an existing setup continues it instead of discarding answers.
      return { ok: true, state, effects: [] };

    case "SAVE_PROFILE": {
      if (state.status === "NOT_STARTED")
        return refuse(
          "INVALID_STATE_TRANSITION",
          "Die Einrichtung wurde noch nicht gestartet.",
        );
      // A profile change while a plan is under review or already confirmed is
      // allowed — "eigentlich lieber nur dreimal pro Woche" is a normal thing
      // to say. What it must not do is leave an approved plan standing.
      if (
        state.status === "PLAN_CONFIRMED" ||
        state.status === "READY_TO_FINISH"
      )
        return move(state, "REVIEWING_PLAN", ["handoff_superseded"]);
      if (state.status === "REVIEWING_PLAN")
        return { ok: true, state, effects: [] };
      return move(
        {
          ...state,
          path: event.path,
          profile_complete: event.profile_complete,
        },
        event.profile_complete ? "PROFILE_READY" : "COLLECTING_PROFILE",
      );
    }

    case "GO_BACK": {
      if (!COLLECTING.includes(state.status))
        return refuse(
          "INVALID_STATE_TRANSITION",
          "Zurück zu den Angaben ist hier nicht möglich. Fordere stattdessen eine Planänderung an.",
        );
      if (!(PROFILE_STEPS as readonly OnboardingStep[]).includes(event.step))
        return refuse(
          "VALIDATION_ERROR",
          "Dieser Schritt gehört nicht zur Angabenerfassung.",
        );
      // The step moves back; the status keeps saying whether the answers are
      // complete, because they are — the user is only looking at them again.
      return {
        ok: true,
        state: { ...state, step: event.step },
        effects: [],
      };
    }

    case "REQUEST_PLAN": {
      if (!state.profile_complete)
        return refuse(
          "PROFILE_INCOMPLETE",
          "Für einen Planvorschlag fehlen noch Pflichtangaben.",
        );
      if (
        state.status === "PROFILE_READY" ||
        state.status === "WAITING_FOR_PLAN_PROPOSAL"
      )
        return move(state, "WAITING_FOR_PLAN_PROPOSAL");
      // Asking for a fresh proposal while reviewing one is legal and replaces
      // the draft reference; an existing confirmation cannot survive it.
      if (state.status === "REVIEWING_PLAN")
        return move(state, "WAITING_FOR_PLAN_PROPOSAL", ["handoff_not_ready"]);
      if (
        state.status === "PLAN_CONFIRMED" ||
        state.status === "READY_TO_FINISH"
      )
        // A brand-new proposal replaces the draft entirely, so the old
        // confirmation has nothing left to refer to and is dropped.
        return move(state, "WAITING_FOR_PLAN_PROPOSAL", [
          "clear_confirmation",
          "handoff_superseded",
        ]);
      return refuse(
        "INVALID_STATE_TRANSITION",
        "Ein Planvorschlag kann erst angefordert werden, wenn die Angaben vollständig sind.",
      );
    }

    case "PLAN_PROPOSED": {
      if (
        state.status !== "WAITING_FOR_PLAN_PROPOSAL" &&
        state.status !== "REVIEWING_PLAN"
      )
        return refuse(
          "INVALID_STATE_TRANSITION",
          "Ein Planvorschlag wird erst angenommen, wenn die Angaben vollständig sind.",
        );
      if (!state.profile_complete)
        return refuse(
          "PROFILE_INCOMPLETE",
          "Für einen Planvorschlag fehlen noch Pflichtangaben.",
        );
      return move(state, "REVIEWING_PLAN", ["handoff_not_ready"]);
    }

    case "REVISE_PLAN": {
      if (!state.has_plan_draft)
        return refuse(
          "PLAN_PROPOSAL_REQUIRED",
          "Es gibt noch keinen Planentwurf, der geändert werden könnte.",
        );
      if (state.status === "REVIEWING_PLAN")
        return { ok: true, state, effects: [] };
      if (
        state.status === "PLAN_CONFIRMED" ||
        state.status === "READY_TO_FINISH"
      )
        // The whole point: a change request after the release takes the plan
        // back into editing and voids the approval of the old revision.
        //
        // The confirmation *record* is kept on purpose. Invalid is not the same
        // as deleted: keeping it lets the handoff say "you released revision 3,
        // the plan is now revision 4" instead of the useless "no confirmation
        // yet". It can never be acted on, because `handoffFor` compares the
        // revisions on every read and reports `superseded`.
        return move(state, "REVIEWING_PLAN", ["handoff_superseded"]);
      return refuse(
        "INVALID_STATE_TRANSITION",
        "In diesem Schritt gibt es keinen Plan zu ändern.",
      );
    }

    case "CONFIRM_PLAN": {
      if (!state.has_plan_draft)
        return refuse(
          "PLAN_PROPOSAL_REQUIRED",
          "Ohne Planentwurf kann nichts bestätigt werden.",
        );
      if (state.status === "PLAN_CONFIRMED" && state.has_confirmation)
        // Idempotent: re-confirming the same revision is not an error. Whether
        // the revision still matches is the service's check, not the machine's.
        return { ok: true, state, effects: ["handoff_ready"] };
      if (state.status !== "REVIEWING_PLAN")
        return refuse(
          "INVALID_STATE_TRANSITION",
          "Ein Plan kann erst nach der Prüfung bestätigt werden.",
        );
      return move(state, "PLAN_CONFIRMED", ["handoff_ready"]);
    }

    case "PREPARE_HANDOFF": {
      if (state.status === "READY_TO_FINISH")
        return move(state, "READY_TO_FINISH", ["handoff_ready"]);
      if (state.status !== "PLAN_CONFIRMED")
        return refuse(
          "HANDOFF_NOT_READY",
          "Die Einrichtung wird erst nach einer ausdrücklichen Planbestätigung abgeschlossen.",
        );
      if (!state.has_confirmation)
        return refuse(
          "CONFIRMATION_REQUIRED",
          "Für die Übergabe fehlt eine gültige Bestätigung des Plans.",
        );
      return move(state, "READY_TO_FINISH", ["handoff_ready"]);
    }

    case "SETUP_FINISHED": {
      if (state.status !== "READY_TO_FINISH")
        return refuse(
          "INVALID_STATE_TRANSITION",
          "Der Abschluss setzt einen bestätigten Plan und den Zustand READY_TO_FINISH voraus.",
        );
      // Only the server's finishing step proves that the plan is active.
      if (!event.finish_verified)
        return refuse(
          "HANDOFF_NOT_READY",
          "Die Einrichtung wird abgeschlossen, sobald der bestätigte Plan aktiviert ist.",
        );
      return move(state, "COMPLETED", ["handoff_ready"]);
    }
  }
}

/** Every event the machine would accept right now. Drives the UI's affordances. */
export function allowedEvents(
  state: OnboardingMachineState,
): OnboardingEventType[] {
  const probes: OnboardingEvent[] = [
    { type: "START" },
    {
      type: "SAVE_PROFILE",
      profile_complete: state.profile_complete,
      path: state.path,
    },
    { type: "GO_BACK", step: "welcome" },
    { type: "REQUEST_PLAN" },
    { type: "PLAN_PROPOSED" },
    { type: "REVISE_PLAN" },
    { type: "CONFIRM_PLAN" },
    { type: "PREPARE_HANDOFF" },
    { type: "SETUP_FINISHED", finish_verified: false },
    { type: "CANCEL" },
    { type: "RESUME" },
  ];
  return probes
    .filter((event) => transitionOnboarding(state, event).ok)
    .map((event) => event.type);
}
