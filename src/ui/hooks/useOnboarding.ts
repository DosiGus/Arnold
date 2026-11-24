/**
 * The confirmed server state remains authoritative for revisions and writes.
 * Question answers are a separate, explicitly unconfirmed local buffer, so
 * navigation never waits for MCP. Every plan/control operation drains that
 * buffer before using the latest server revision. Unknown writes retain their
 * original request; a server conflict requires explicit user review.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OnboardingPath,
  OnboardingProfilePatch,
  OnboardingState,
  OnboardingStep,
} from "../../shared/onboarding-contract";
import { PROFILE_STEPS } from "../../shared/onboarding-contract";
import type { OnboardingProfileBuffer } from "../client/OnboardingProfileBuffer";
import {
  buildProgress,
  exerciseChoices,
  isProfileComplete,
  validateProfile,
} from "../../shared/onboarding-profile";
import { splitsForDays } from "../../shared/onboarding-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

/** What the buttons say in the chat on the user's behalf. Short, first person. */
import { asFailure, RECOVERY_COPY, type UiFailure } from "../recovery";

export const PLAN_REQUEST_MESSAGE =
  "Meine Angaben sind fertig. Bitte erstelle jetzt meinen Trainingsplan.";
export const OWN_PLAN_MESSAGE =
  "Ich habe schon einen Trainingsplan und möchte ihn übernehmen.";

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
  const [failure, setFailure] = useState<UiFailure>();
  const [pending, setPending] = useState(false);
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const [message, setMessage] = useState("");
  const [profileBuffer, setProfileBuffer] = useState<OnboardingProfileBuffer>();
  const [, redrawProfile] = useState(0);
  const bufferRef = useRef<OnboardingProfileBuffer | undefined>(undefined);
  /** Reopening follows the stored screen; local answers can move ahead of it. */
  const openingStep = (next: OnboardingState): OnboardingStep =>
    next.session.current_step;

  const [step, setStep] = useState<OnboardingStep>(
    initial ? openingStep(initial) : "welcome",
  );
  const busy = useRef(false);
  /** Control writes and stored navigation follow all buffered answers. */
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const stateRef = useRef<OnboardingState | undefined>(initial);
  stateRef.current = state;

  /** Replaces the local copy with what the server stored. */
  const adopt = useCallback((next: OnboardingState, follow = true) => {
    if (
      stateRef.current &&
      next.session.revision < stateRef.current.session.revision
    )
      return;
    setState(next);
    stateRef.current = next;
    bufferRef.current?.adopt(next);
    if (follow) setStep(openingStep(next));
  }, []);

  const reload = useCallback(
    async (
      follow = false,
      quiet = false,
      stillCurrent: () => boolean = () => true,
    ) => {
      const token = ++generation.current;
      try {
        const next = await client.onboardingState();
        if (token !== generation.current || !stillCurrent()) return undefined;
        if (
          stateRef.current &&
          next.session.revision < stateRef.current.session.revision
        )
          return stateRef.current;
        const mayFollow = follow && !bufferRef.current?.hasChanges;
        adopt(next, mayFollow);
        if (mayFollow) setReloadEpoch((epoch) => epoch + 1);
        if (!quiet) setUi("READY");
        if (!quiet && follow && !client.hasPendingOnboarding()) {
          setError("");
          setFailure(undefined);
        }
        return next;
      } catch (e) {
        if (token !== generation.current || quiet || !stillCurrent())
          return undefined;
        // A missing credential is a different situation from a failed call: it
        // needs a restart, not a retry, and the UI says so.
        const missing = /Sitzungsnachweis/.test((e as Error).message);
        setUi(missing ? "NO_SESSION" : "ERROR");
        const failure = asFailure(e, "retry_same_request");
        setFailure(failure);
        setError(RECOVERY_COPY[failure.recovery].body);
        return undefined;
      }
    },
    [adopt, client],
  );

  useEffect(() => {
    const current = stateRef.current;
    if (!current) return;
    const buffer = client.profileBuffer(current);
    bufferRef.current = buffer;
    setProfileBuffer(buffer);
    const changed = () => {
      const next = buffer.state;
      stateRef.current = next;
      setState(next);
      setPending(client.hasPendingOnboarding() && !buffer.saving);
      redrawProfile((value) => value + 1);
    };
    const unsubscribe = buffer.subscribe(changed);
    buffer.start();
    changed();
    // A restored local answer must also choose the next unanswered question.
    if (buffer.hasChanges) {
      const localPath = buffer.project().path;
      if (
        localPath &&
        (current.session.current_step === "welcome" ||
          localPath !== current.session.profile.path)
      )
        setStep(localPath === "own_plan" ? "own_plan" : "profile");
      setReloadEpoch((value) => value + 1);
    }
    return unsubscribe;
  }, [client]);

  useEffect(() => {
    if (initial) adopt(initial, false);
  }, [initial, adopt]);

  useEffect(() => {
    // A payload handed in by the host may be a replayed tool result, so the
    // state is revalidated against the server before anything is acted on.
    const unconfirmed = client.hasPendingOnboarding();
    setPending(unconfirmed);
    if (unconfirmed && !bufferRef.current?.saving) {
      setFailure({
        code: "COMMIT_STATUS_UNKNOWN",
        recovery: "retry_same_request",
      });
      setError("Eine Speicherung ist noch nicht bestätigt.");
    }
    void reload(true).then((next) => {
      if (next) client.profileBuffer(next).start();
    });
    return () => {
      generation.current++;
    };
  }, [client, reload]);

  /** One control action at a time, using the revision after the profile flush. */
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
      if (busy.current) return undefined;
      busy.current = true;
      ++generation.current;
      setUi(options.busyState);
      // Queue behind whatever is already in flight, then read the revision
      // fresh: the state may well have moved on while we waited.
      const previous = tail.current;
      const run = (async () => {
        try {
          await previous.catch(() => {});
          if (bufferRef.current && !(await bufferRef.current.flush())) {
            setUi("READY");
            return undefined;
          }
          const current = stateRef.current;
          if (!current) {
            setUi("READY");
            return undefined;
          }
          return await attempt(current.session.revision);
        } finally {
          busy.current = false;
        }
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
          setPending(client.hasPendingOnboarding());
          if (!response.ok) {
            const failure = asFailure(response.error);
            setFailure(failure);
            setError(RECOVERY_COPY[failure.recovery].body);
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
          setPending(client.hasPendingOnboarding());
          const failure = asFailure(e, "retry_same_request");
          setFailure(failure);
          setError(RECOVERY_COPY[failure.recovery].body);
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

  /** Records an uncommitted local answer. The buffer saves it independently. */
  const saveProfile = useCallback((profile: OnboardingProfilePatch) => {
    try {
      return bufferRef.current?.stage(profile) ?? false;
    } catch (error) {
      const next = asFailure(error, "retry_same_request");
      setFailure(next);
      setError(RECOVERY_COPY[next.recovery].body);
      return false;
    }
  }, []);

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
        if (bufferRef.current && !(await bufferRef.current.flush())) return;
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

  /**
   * "Plan erstellen": opens the proposal phase, then hands the turn to the
   * chat so ChatGPT builds the plan right away instead of waiting to be asked.
   */
  const requestPlan = useCallback(async () => {
    const response = await send(
      (revision) =>
        client.requestOnboardingPlan({
          request_id: newRequestId(),
          expected_revision: revision,
        }),
      { busyState: "REQUESTING_PLAN" },
    );
    if (response?.ok) await client.askChat(PLAN_REQUEST_MESSAGE);
    return response;
  }, [client, send]);

  /**
   * One of the two welcome buttons. The own-plan path continues in the chat,
   * so it also posts a message that tells ChatGPT to ask for the plan.
   */
  const choosePath = useCallback(
    async (path: OnboardingPath) => {
      if (busy.current || !bufferRef.current?.stage({ path })) return;
      setStep(path === "own_plan" ? "own_plan" : "profile");
      setError("");
      setMessage("");
      // The welcome choice is local too. Only a handoff to the model waits for
      // the persisted path, so the chat cannot start from an older profile.
      if (path === "own_plan") {
        busy.current = true;
        setUi("SAVING");
        try {
          if (await bufferRef.current.flush())
            await client.askChat(OWN_PLAN_MESSAGE);
        } finally {
          busy.current = false;
          setUi("READY");
        }
      }
    },
    [client],
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
        success: "Plan bestätigt. Arnold ist eingerichtet.",
      },
    );
  }, [client, send]);

  /** Completes a confirmed setup whose finishing step was interrupted. */
  const finishSetup = useCallback(
    () =>
      send(() => client.finishOnboarding({ request_id: newRequestId() }), {
        busyState: "CONFIRMING",
        success: "Arnold ist eingerichtet.",
      }),
    [client, send],
  );

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

  const displayed =
    state && profileBuffer?.hasChanges
      ? (() => {
          const profile = profileBuffer.project(state.session.profile);
          return {
            ...state,
            session: { ...state.session, profile },
            validation: validateProfile(profile),
            exercise_choices: exerciseChoices(profile),
            split_options: splitsForDays(profile.training.days_per_week),
            progress: buildProgress(profile, {
              step: state.session.current_step,
              can_request_plan:
                isProfileComplete(profile) &&
                ["COLLECTING_PROFILE", "PROFILE_READY"].includes(
                  state.session.status,
                ),
              can_confirm_plan: false,
            }),
          };
        })()
      : state;
  const session = displayed?.session;
  const profileFailure =
    profileBuffer?.failure ??
    (profileBuffer?.paused
      ? {
          code: profileBuffer.conflict
            ? "REVISION_CONFLICT"
            : "COMMIT_STATUS_UNKNOWN",
          recovery: profileBuffer.conflict
            ? ("reload_then_retry" as const)
            : ("retry_same_request" as const),
        }
      : undefined);
  const expired = session?.status === "EXPIRED";
  const cancelled = session?.status === "CANCELLED";

  return {
    state: displayed,
    savedProfile: state?.session.profile,
    profileDirty: profileBuffer?.hasChanges ?? false,
    profilePaused: profileBuffer?.paused ?? false,
    profileConflict: profileBuffer?.conflict ?? false,
    profileVolatile: profileBuffer?.volatile ?? false,
    profileSaving: profileBuffer?.saving ?? false,
    session,
    step,
    ui,
    error: profileFailure ? RECOVERY_COPY[profileFailure.recovery].body : error,
    failure: profileFailure ?? failure,
    reloadEpoch,
    pending: pending || (profileBuffer?.paused ?? false),
    retry: async () => {
      if (bufferRef.current?.hasChanges) {
        const ok = await bufferRef.current.retry();
        if (ok) {
          setError("");
          setFailure(undefined);
          setPending(false);
        }
        return;
      }
      try {
        const response = await client.retryOnboarding();
        setPending(client.hasPendingOnboarding());
        if (response?.state) adopt(response.state, true);
        if (response?.ok) {
          setError("");
          setFailure(undefined);
        }
        return response;
      } catch (error) {
        setPending(true);
        setFailure(asFailure(error, "retry_same_request"));
      }
    },
    message,
    busy: ui === "SAVING" || ui === "REQUESTING_PLAN" || ui === "CONFIRMING",
    expired,
    cancelled,
    /** True while the setup is in a state the user can still work in. */
    active: Boolean(state) && !expired && !cancelled,
    progress: displayed?.progress,
    validation: displayed?.validation,
    plan: state?.plan ?? null,
    planValidation: state?.plan_validation ?? null,
    handoff: state?.handoff,
    goToStep,
    /** Shows a step without recording it; for a save that already did. */
    showStep: (next: OnboardingStep) => setStep(next),
    saveProfile,
    choosePath,
    requestPlan,
    confirmPlan,
    revisePlan,
    cancel,
    restart,
    reload,
    finishSetup,
    clearMessage: () => setMessage(""),
  };
}
