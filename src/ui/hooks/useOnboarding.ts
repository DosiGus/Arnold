/**
 * State behind the onboarding wizard.
 *
 * All onboarding logic lives on the server. This hook owns only what a UI must
 * own: which step is on screen, what the user has typed but not yet sent, and
 * whether the last write was confirmed.
 *
 * Four properties are deliberate.
 *
 *   1. The server state is the truth. Every write returns the stored state and
 *      the hook replaces its copy with it. Nothing is rendered optimistically,
 *      so a failed save can never look like a successful one.
 *   2. Navigation is instant, answers are persisted. Moving between steps is
 *      local so the wizard feels immediate, and the step is also sent to the
 *      server so reopening the setup lands where the user left it. Answers are
 *      already stored before any navigation, which is why going back never
 *      loses data.
 *   3. A write states the revision it was built on. A stale UI is refused by
 *      the server with `REVISION_CONFLICT` rather than overwriting a change
 *      that arrived from the chat in the meantime.
 *   4. The confirmation is built from the revision as it is *now*, not from the
 *      one the review screen was rendered with, so a draft that changed in
 *      between is refused instead of being confirmed from a stale view.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OnboardingProfilePatch,
  OnboardingState,
  OnboardingStep,
} from "../../shared/onboarding-contract";
import { PROFILE_STEPS } from "../../shared/onboarding-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

const newRequestId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type OnboardingUiState =
  | "LOADING"
  | "READY"
  | "SAVING"
  | "REQUESTING_PLAN"
  | "CONFIRMING"
  | "ERROR"
  /** No usable session credential: the setup must be restarted. */
  | "NO_SESSION";

export type OnboardingController = ReturnType<typeof useOnboarding>;

export function useOnboarding(
  client: ArnoldMcpClient,
  initial?: OnboardingState,
) {
  const [state, setState] = useState<OnboardingState | undefined>(initial);
  const [ui, setUi] = useState<OnboardingUiState>(
    initial ? "READY" : "LOADING",
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  /**
   * Which step to open a setup on.
   *
   * A brand-new session is created in `COLLECTING_PROFILE`, whose step is
   * `goal`, because a chat turn must be able to save an answer straight away.
   * The welcome screen is therefore a UI affordance rather than a server state:
   * it is shown while nothing has been answered yet, and skipped the moment a
   * setup actually has answers to come back to.
   */
  const openingStep = (next: OnboardingState): OnboardingStep =>
    next.progress.answered_required === 0 &&
    next.session.status === "COLLECTING_PROFILE"
      ? "welcome"
      : next.session.current_step;

  /** The step on screen. Follows the server unless the user navigated. */
  const [step, setStep] = useState<OnboardingStep>(
    initial ? openingStep(initial) : "welcome",
  );
  const busy = useRef(false);
  /**
   * Serialises writes instead of dropping them.
   *
   * Answering two questions in quick succession must not lose the second: each
   * write waits for the previous one and then reads the revision as it stands,
   * so they apply in order rather than racing and being refused.
   */
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const stateRef = useRef<OnboardingState | undefined>(initial);
  stateRef.current = state;

  /** Replaces the local copy with what the server stored. */
  const adopt = useCallback((next: OnboardingState, follow = true) => {
    setState(next);
    stateRef.current = next;
    if (follow) setStep(openingStep(next));
  }, []);

  const reload = useCallback(
    async (follow = false) => {
      const token = ++generation.current;
      try {
        const next = await client.onboardingState();
        if (token !== generation.current) return undefined;
        adopt(next, follow);
        setUi("READY");
        return next;
      } catch (e) {
        if (token !== generation.current) return undefined;
        // A missing credential is a different situation from a failed call: it
        // needs a restart, not a retry, and the UI says so.
        const missing = /Sitzungsnachweis/.test((e as Error).message);
        setUi(missing ? "NO_SESSION" : "ERROR");
        setError((e as Error).message);
        return undefined;
      }
    },
    [adopt, client],
  );

  useEffect(() => {
    // A payload handed in by the host may be a replayed tool result, so the
    // state is revalidated against the server before anything is acted on.
    void reload(!initial);
    return () => {
      generation.current++;
    };
  }, [initial, reload]);

  /**
   * Sends one onboarding write.
   *
   * Serialised through `busy`: two overlapping writes would race on the session
   * revision, and the second would be refused anyway.
   */
  const send = useCallback(
    async (
      action: (
        revision: number,
      ) => Promise<
        Awaited<ReturnType<ArnoldMcpClient["saveOnboardingProfile"]>>
      >,
      options: { busyState: OnboardingUiState; success?: string } = {
        busyState: "SAVING",
      },
    ) => {
      // Queue behind whatever is already in flight, then read the revision
      // fresh: the state may well have moved on while we waited.
      const previous = tail.current;
      const run = (async () => {
        await previous.catch(() => {});
        const current = stateRef.current;
        if (!current) return undefined;
        return attempt(current.session.revision);
      })();
      tail.current = run;
      return run;

      async function attempt(revision: number) {
        busy.current = true;
        setUi(options.busyState);
        setError("");
        setMessage("");
        try {
          const response = await action(revision);
          if (!response.ok) {
            setError(
              [response.error?.message, ...(response.error?.details ?? [])]
                .filter(Boolean)
                .join(" · "),
            );
            // A refusal still carries the state that actually stands, so the
            // screen stays truthful instead of showing what was attempted.
            if (response.state) adopt(response.state, false);
            else await reload();
            setUi("READY");
            return response;
          }
          // Never follow the server's recorded step here. That field exists so a
          // *reopened* setup lands in the right place; letting a save move the
          // screen would snap the user back to an earlier question mid-answer.
          if (response.state) adopt(response.state, false);
          setMessage(
            response.replayed
              ? "Bereits gespeichert · keine doppelte Änderung."
              : (options.success ?? ""),
          );
          setUi("READY");
          return response;
        } catch (e) {
          setUi("ERROR");
          setError((e as Error).message);
          // The outcome is unclear, so the stored state is re-read rather than
          // assumed. Nothing is reported as saved.
          await reload();
          return undefined;
        } finally {
          busy.current = false;
        }
      }
    },
    [adopt, reload],
  );

  /** Saves answers and, when given, records the step they came from. */
  const saveProfile = useCallback(
    (profile: OnboardingProfilePatch, nextStep?: OnboardingStep) =>
      send(
        (revision) =>
          client.saveOnboardingProfile({
            request_id: newRequestId(),
            expected_revision: revision,
            profile,
            ...(nextStep ? { step: nextStep } : {}),
          }),
        { busyState: "SAVING", success: "Angaben gespeichert." },
      ),
    [client, send],
  );

  /**
   * Moves to another collection step.
   *
   * Local first so the wizard responds immediately, then persisted so a reopen
   * lands on the same step. A failed persist is not an error worth showing: the
   * answers are already stored and the user is simply looking at another
   * question.
   */
  const goToStep = useCallback(
    (next: OnboardingStep) => {
      setStep(next);
      setError("");
      setMessage("");
      if (!(PROFILE_STEPS as readonly OnboardingStep[]).includes(next)) return;
      // Queued like every other write. Fire-and-forget would race the next
      // answer: both would claim the same revision and the loser — the answer
      // the user just gave — would be refused with a revision conflict.
      const previous = tail.current;
      const run = (async () => {
        await previous.catch(() => {});
        const current = stateRef.current;
        if (!current) return;
        try {
          const response = await client.saveOnboardingProfile({
            request_id: newRequestId(),
            expected_revision: current.session.revision,
            step: next,
          });
          if (response.ok && response.state) adopt(response.state, false);
        } catch {
          /* navigation is local; the answers are already stored */
        }
      })();
      tail.current = run;
    },
    [adopt, client],
  );

  const requestPlan = useCallback(
    () =>
      send(
        (revision) =>
          client.requestOnboardingPlan({
            request_id: newRequestId(),
            expected_revision: revision,
          }),
        { busyState: "REQUESTING_PLAN" },
      ),
    [client, send],
  );

  /**
   * Confirms the plan.
   *
   * The revision comes from the state as it is now. If the draft moved since the
   * review screen rendered, the server refuses with `STALE_CONFIRMATION` — which
   * is the behaviour we want rather than confirming an unseen version.
   */
  const confirmPlan = useCallback(async () => {
    const plan = stateRef.current?.plan;
    if (!plan) return undefined;
    return send(
      (revision) =>
        client.confirmOnboardingPlan({
          request_id: newRequestId(),
          expected_revision: revision,
          confirmation: {
            plan_version_id: plan.plan_version_id,
            row_revision: plan.row_revision,
            confirmed: true,
          },
        }),
      {
        busyState: "CONFIRMING",
        success: "Plan bestätigt und für die Einrichtung freigegeben.",
      },
    );
  }, [client, send]);

  const revisePlan = useCallback(
    (reason?: string) =>
      send(
        (revision) =>
          client.reviseOnboardingPlan({
            request_id: newRequestId(),
            expected_revision: revision,
            ...(reason ? { reason } : {}),
          }),
        { busyState: "SAVING", success: "Der Plan ist wieder bearbeitbar." },
      ),
    [client, send],
  );

  const cancel = useCallback(
    () =>
      send(() => client.cancelOnboarding({ request_id: newRequestId() }), {
        busyState: "SAVING",
        success: "Einrichtung abgebrochen.",
      }),
    [client, send],
  );

  /** Starts a fresh setup, e.g. after an expired or cancelled one. */
  const restart = useCallback(async () => {
    if (busy.current) return undefined;
    busy.current = true;
    setUi("SAVING");
    setError("");
    setMessage("");
    try {
      client.forgetOnboarding();
      const response = await client.startOnboarding(newRequestId());
      if (!response.ok || !response.state) {
        setUi("ERROR");
        setError(
          response.error?.message ??
            "Die Einrichtung konnte nicht gestartet werden.",
        );
        return response;
      }
      adopt(response.state);
      setUi("READY");
      return response;
    } catch (e) {
      setUi("ERROR");
      setError((e as Error).message);
      return undefined;
    } finally {
      busy.current = false;
    }
  }, [adopt, client]);

  const session = state?.session;
  const connectGoogle = async () => {
    setError("");
    try {
      await client.connectGoogle();
      setMessage(
        "Google-Freigabe im geöffneten Fenster abschließen. Anschließend hier aktualisieren.",
      );
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const finishSetup = async () => {
    setError("");
    try {
      await client.finishSetup();
      await reload(true);
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const expired = session?.status === "EXPIRED";
  const cancelled = session?.status === "CANCELLED";

  return {
    state,
    session,
    step,
    ui,
    error,
    message,
    busy: ui === "SAVING" || ui === "REQUESTING_PLAN" || ui === "CONFIRMING",
    expired,
    cancelled,
    /** True while the setup is in a state the user can still work in. */
    active: Boolean(state) && !expired && !cancelled,
    progress: state?.progress,
    validation: state?.validation,
    plan: state?.plan ?? null,
    planValidation: state?.plan_validation ?? null,
    handoff: state?.handoff,
    goToStep,
    /** Shows a step without recording it; for a save that already did. */
    showStep: (next: OnboardingStep) => setStep(next),
    saveProfile,
    requestPlan,
    confirmPlan,
    revisePlan,
    cancel,
    restart,
    reload,
    connectGoogle,
    finishSetup,
    clearMessage: () => setMessage(""),
  };
}
