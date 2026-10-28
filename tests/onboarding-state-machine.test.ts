/**
 * The onboarding state machine, tested on its own.
 *
 * The machine is pure, so these tests need no server, no clock and no storage:
 * a state and an event in, a verdict out. That is the point of keeping it
 * separate — the rules that decide whether a plan may be confirmed are checked
 * here exhaustively, and the service tests can then concentrate on persistence.
 */
import { describe, expect, it } from "vitest";
import {
  allowedEvents,
  isTerminal,
  transitionOnboarding,
  type OnboardingEvent,
  type OnboardingMachineState,
} from "../src/server/onboarding/state-machine";
import {
  ONBOARDING_STATUSES,
  type OnboardingStatus,
} from "../src/shared/onboarding-contract";

const base = (
  overrides: Partial<OnboardingMachineState> = {},
): OnboardingMachineState => ({
  status: "NOT_STARTED",
  step: "welcome",
  profile_complete: false,
  has_plan_draft: false,
  has_confirmation: false,
  expired: false,
  ...overrides,
});

/** Asserts a transition succeeded and returns the new state. */
function pass(state: OnboardingMachineState, event: OnboardingEvent) {
  const result = transitionOnboarding(state, event);
  if (!result.ok)
    throw new Error(
      `expected ${event.type} to be allowed from ${state.status}, got ${result.error.code}`,
    );
  return result;
}

function reject(state: OnboardingMachineState, event: OnboardingEvent) {
  const result = transitionOnboarding(state, event);
  expect(
    result.ok,
    `expected ${event.type} to be refused from ${state.status}`,
  ).toBe(false);
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

describe("new session", () => {
  it("starts collecting answers", () => {
    const result = pass(base(), { type: "START" });
    expect(result.state.status).toBe("COLLECTING_PROFILE");
    expect(result.state.step).toBe("goal");
  });

  it("continues an existing setup instead of discarding answers", () => {
    const state = base({ status: "COLLECTING_PROFILE", step: "availability" });
    const result = pass(state, { type: "START" });
    expect(result.state.status).toBe("COLLECTING_PROFILE");
    expect(result.state.step).toBe("availability");
  });

  it("refuses answers before the setup was started", () => {
    expect(
      reject(base(), { type: "SAVE_PROFILE", profile_complete: false }).code,
    ).toBe("INVALID_STATE_TRANSITION");
  });
});

describe("collecting the profile", () => {
  it("stays collecting while answers are missing", () => {
    const result = pass(base({ status: "COLLECTING_PROFILE" }), {
      type: "SAVE_PROFILE",
      profile_complete: false,
    });
    expect(result.state.status).toBe("COLLECTING_PROFILE");
  });

  it("becomes ready once every required answer is in", () => {
    const result = pass(base({ status: "COLLECTING_PROFILE" }), {
      type: "SAVE_PROFILE",
      profile_complete: true,
    });
    expect(result.state.status).toBe("PROFILE_READY");
  });

  it("falls back to collecting when an answer is removed again", () => {
    const result = pass(
      base({ status: "PROFILE_READY", profile_complete: true }),
      { type: "SAVE_PROFILE", profile_complete: false },
    );
    expect(result.state.status).toBe("COLLECTING_PROFILE");
  });
});

describe("stepping back", () => {
  it("moves the step without changing the status", () => {
    const state = base({
      status: "PROFILE_READY",
      step: "summary",
      profile_complete: true,
    });
    const result = pass(state, { type: "GO_BACK", step: "goal" });
    expect(result.state.step).toBe("goal");
    // The answers are still complete; the user is only looking at them again.
    expect(result.state.status).toBe("PROFILE_READY");
  });

  it("refuses a step that is not part of the collection", () => {
    expect(
      reject(base({ status: "COLLECTING_PROFILE" }), {
        type: "GO_BACK",
        step: "google_connection",
      }).code,
    ).toBe("VALIDATION_ERROR");
  });

  it("refuses going back once a plan is confirmed", () => {
    const state = base({
      status: "PLAN_CONFIRMED",
      profile_complete: true,
      has_plan_draft: true,
      has_confirmation: true,
    });
    expect(reject(state, { type: "GO_BACK", step: "goal" }).code).toBe(
      "INVALID_STATE_TRANSITION",
    );
  });
});

describe("requesting a plan", () => {
  it("needs a complete profile", () => {
    expect(
      reject(base({ status: "COLLECTING_PROFILE" }), { type: "REQUEST_PLAN" })
        .code,
    ).toBe("PROFILE_INCOMPLETE");
  });

  it("opens the proposal phase from a ready profile", () => {
    const result = pass(
      base({ status: "PROFILE_READY", profile_complete: true }),
      { type: "REQUEST_PLAN" },
    );
    expect(result.state.status).toBe("WAITING_FOR_PLAN_PROPOSAL");
  });

  it("is idempotent while already waiting", () => {
    const result = pass(
      base({ status: "WAITING_FOR_PLAN_PROPOSAL", profile_complete: true }),
      { type: "REQUEST_PLAN" },
    );
    expect(result.state.status).toBe("WAITING_FOR_PLAN_PROPOSAL");
  });

  it("drops a confirmation when a brand-new proposal is requested", () => {
    const state = base({
      status: "PLAN_CONFIRMED",
      profile_complete: true,
      has_plan_draft: true,
      has_confirmation: true,
    });
    const result = pass(state, { type: "REQUEST_PLAN" });
    expect(result.state.status).toBe("WAITING_FOR_PLAN_PROPOSAL");
    // A replacement draft leaves the old confirmation nothing to point at.
    expect(result.effects).toContain("clear_confirmation");
    expect(result.effects).toContain("handoff_superseded");
  });
});

describe("receiving a proposal", () => {
  it("moves into review", () => {
    const result = pass(
      base({ status: "WAITING_FOR_PLAN_PROPOSAL", profile_complete: true }),
      { type: "PLAN_PROPOSED" },
    );
    expect(result.state.status).toBe("REVIEWING_PLAN");
    expect(result.state.step).toBe("plan_review");
  });

  it("is refused before the proposal phase was opened", () => {
    expect(
      reject(base({ status: "PROFILE_READY", profile_complete: true }), {
        type: "PLAN_PROPOSED",
      }).code,
    ).toBe("INVALID_STATE_TRANSITION");
  });

  it("is refused when required answers went missing again", () => {
    expect(
      reject(
        base({ status: "WAITING_FOR_PLAN_PROPOSAL", profile_complete: false }),
        { type: "PLAN_PROPOSED" },
      ).code,
    ).toBe("PROFILE_INCOMPLETE");
  });
});

describe("confirming a plan", () => {
  const reviewing = base({
    status: "REVIEWING_PLAN",
    profile_complete: true,
    has_plan_draft: true,
  });

  it("requires a draft", () => {
    expect(
      reject(base({ status: "REVIEWING_PLAN", profile_complete: true }), {
        type: "CONFIRM_PLAN",
      }).code,
    ).toBe("PLAN_PROPOSAL_REQUIRED");
  });

  it("confirms from review and marks the handoff ready", () => {
    const result = pass(reviewing, { type: "CONFIRM_PLAN" });
    expect(result.state.status).toBe("PLAN_CONFIRMED");
    expect(result.effects).toContain("handoff_ready");
  });

  it("cannot be reached from the collection phase", () => {
    expect(
      reject(
        base({
          status: "PROFILE_READY",
          profile_complete: true,
          has_plan_draft: true,
        }),
        { type: "CONFIRM_PLAN" },
      ).code,
    ).toBe("INVALID_STATE_TRANSITION");
  });

  it("is idempotent for an already confirmed plan", () => {
    const state = base({
      status: "PLAN_CONFIRMED",
      has_plan_draft: true,
      has_confirmation: true,
      profile_complete: true,
    });
    const result = pass(state, { type: "CONFIRM_PLAN" });
    expect(result.state.status).toBe("PLAN_CONFIRMED");
  });
});

describe("changing a plan after the confirmation", () => {
  const confirmed = base({
    status: "PLAN_CONFIRMED",
    profile_complete: true,
    has_plan_draft: true,
    has_confirmation: true,
  });

  it("takes the plan back into review and supersedes the handoff", () => {
    const result = pass(confirmed, { type: "REVISE_PLAN" });
    expect(result.state.status).toBe("REVIEWING_PLAN");
    expect(result.effects).toContain("handoff_superseded");
    // The record is kept so the user can be told which revision lapsed.
    expect(result.effects).not.toContain("clear_confirmation");
  });

  it("does the same from the handoff state", () => {
    const result = pass(
      { ...confirmed, status: "AWAITING_GOOGLE_CONNECTION" },
      { type: "REVISE_PLAN" },
    );
    expect(result.state.status).toBe("REVIEWING_PLAN");
    expect(result.effects).toContain("handoff_superseded");
  });

  it("supersedes the handoff when an answer changes after the confirmation", () => {
    const result = pass(confirmed, {
      type: "SAVE_PROFILE",
      profile_complete: true,
    });
    expect(result.state.status).toBe("REVIEWING_PLAN");
    expect(result.effects).toContain("handoff_superseded");
  });

  it("refuses a revision request when there is no draft", () => {
    expect(
      reject(base({ status: "REVIEWING_PLAN", profile_complete: true }), {
        type: "REVISE_PLAN",
      }).code,
    ).toBe("PLAN_PROPOSAL_REQUIRED");
  });
});

describe("the OAuth handoff", () => {
  it("needs a confirmed plan", () => {
    expect(
      reject(
        base({
          status: "REVIEWING_PLAN",
          has_plan_draft: true,
          profile_complete: true,
        }),
        { type: "PREPARE_HANDOFF" },
      ).code,
    ).toBe("HANDOFF_NOT_READY");
  });

  it("needs an actual confirmation record", () => {
    expect(
      reject(
        base({
          status: "PLAN_CONFIRMED",
          has_plan_draft: true,
          has_confirmation: false,
          profile_complete: true,
        }),
        { type: "PREPARE_HANDOFF" },
      ).code,
    ).toBe("CONFIRMATION_REQUIRED");
  });

  it("moves to AWAITING_GOOGLE_CONNECTION and is idempotent", () => {
    const state = base({
      status: "PLAN_CONFIRMED",
      has_plan_draft: true,
      has_confirmation: true,
      profile_complete: true,
    });
    const first = pass(state, { type: "PREPARE_HANDOFF" });
    expect(first.state.status).toBe("AWAITING_GOOGLE_CONNECTION");
    const second = pass(first.state, { type: "PREPARE_HANDOFF" });
    expect(second.state.status).toBe("AWAITING_GOOGLE_CONNECTION");
  });
});

describe("COMPLETED is out of reach for Task 006", () => {
  const awaiting = base({
    status: "AWAITING_GOOGLE_CONNECTION",
    has_plan_draft: true,
    has_confirmation: true,
    profile_complete: true,
  });

  it("refuses the completion without verified provisioning", () => {
    const error = reject(awaiting, {
      type: "GOOGLE_CONNECTED",
      provisioning_verified: false,
    });
    expect(error.code).toBe("OAUTH_NOT_IMPLEMENTED");
  });

  it("is never offered as an allowed event", () => {
    for (const status of ONBOARDING_STATUSES)
      expect(
        allowedEvents(
          base({
            status,
            has_plan_draft: true,
            has_confirmation: true,
            profile_complete: true,
          }),
        ),
      ).not.toContain("GOOGLE_CONNECTED");
  });

  it("cannot be reached by skipping the confirmation", () => {
    for (const status of [
      "COLLECTING_PROFILE",
      "PROFILE_READY",
      "WAITING_FOR_PLAN_PROPOSAL",
      "REVIEWING_PLAN",
      "PLAN_CONFIRMED",
    ] satisfies OnboardingStatus[])
      expect(
        reject(base({ status, profile_complete: true, has_plan_draft: true }), {
          type: "GOOGLE_CONNECTED",
          provisioning_verified: true,
        }).code,
      ).toBe("INVALID_STATE_TRANSITION");
  });
});

describe("expiry and cancellation", () => {
  it("refuses every business event on an expired session", () => {
    const expired = base({
      status: "REVIEWING_PLAN",
      expired: true,
      has_plan_draft: true,
      profile_complete: true,
    });
    for (const event of [
      { type: "SAVE_PROFILE", profile_complete: true },
      { type: "REQUEST_PLAN" },
      { type: "PLAN_PROPOSED" },
      { type: "CONFIRM_PLAN" },
      { type: "REVISE_PLAN" },
      { type: "PREPARE_HANDOFF" },
      { type: "RESUME" },
    ] satisfies OnboardingEvent[])
      expect(reject(expired, event).code).toBe("SESSION_EXPIRED");
  });

  it("still allows cancelling an expired session", () => {
    const result = pass(base({ status: "REVIEWING_PLAN", expired: true }), {
      type: "CANCEL",
    });
    expect(result.state.status).toBe("CANCELLED");
  });

  it("refuses everything but a restart after cancellation", () => {
    const cancelled = base({ status: "CANCELLED" });
    expect(reject(cancelled, { type: "START" }).code).toBe("SESSION_CANCELLED");
    expect(reject(cancelled, { type: "CONFIRM_PLAN" }).code).toBe(
      "SESSION_CANCELLED",
    );
  });

  it("voids a confirmation on cancellation and expiry", () => {
    const state = base({
      status: "AWAITING_GOOGLE_CONNECTION",
      has_plan_draft: true,
      has_confirmation: true,
      profile_complete: true,
    });
    expect(pass(state, { type: "CANCEL" }).effects).toContain(
      "clear_confirmation",
    );
    expect(pass(state, { type: "EXPIRE" }).effects).toContain(
      "clear_confirmation",
    );
  });

  it("is idempotent for repeated cancel and expire", () => {
    expect(
      pass(base({ status: "CANCELLED" }), { type: "CANCEL" }).state.status,
    ).toBe("CANCELLED");
    expect(
      pass(base({ status: "EXPIRED" }), { type: "EXPIRE" }).state.status,
    ).toBe("EXPIRED");
  });

  it("names its terminal statuses", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("EXPIRED")).toBe(true);
    expect(isTerminal("REVIEWING_PLAN")).toBe(false);
  });
});

describe("resuming", () => {
  it("changes nothing about the business state", () => {
    const state = base({
      status: "REVIEWING_PLAN",
      step: "plan_review",
      has_plan_draft: true,
      profile_complete: true,
    });
    const result = pass(state, { type: "RESUME" });
    expect(result.state).toEqual(state);
    expect(result.effects).toEqual([]);
  });
});

describe("allowed events drive the UI", () => {
  it("offers no plan confirmation while answers are missing", () => {
    const events = allowedEvents(base({ status: "COLLECTING_PROFILE" }));
    expect(events).toContain("SAVE_PROFILE");
    expect(events).not.toContain("CONFIRM_PLAN");
    expect(events).not.toContain("REQUEST_PLAN");
  });

  it("offers a plan request exactly when the profile is complete", () => {
    expect(
      allowedEvents(base({ status: "PROFILE_READY", profile_complete: true })),
    ).toContain("REQUEST_PLAN");
  });

  it("offers nothing but cancelling on a terminal session", () => {
    expect(allowedEvents(base({ status: "CANCELLED" }))).toEqual(["CANCEL"]);
  });

  it("never reports an event the machine would refuse", () => {
    // The guard against the two drifting apart: every advertised event must
    // actually be accepted from that state.
    for (const status of ONBOARDING_STATUSES)
      for (const complete of [true, false]) {
        const state = base({
          status,
          profile_complete: complete,
          has_plan_draft: true,
          has_confirmation: true,
        });
        for (const type of allowedEvents(state)) {
          const event = (
            type === "SAVE_PROFILE"
              ? { type, profile_complete: complete }
              : type === "GO_BACK"
                ? { type, step: "goal" }
                : type === "GOOGLE_CONNECTED"
                  ? { type, provisioning_verified: false }
                  : { type }
          ) as OnboardingEvent;
          expect(
            transitionOnboarding(state, event).ok,
            `${type} advertised but refused from ${status}`,
          ).toBe(true);
        }
      }
  });
});
