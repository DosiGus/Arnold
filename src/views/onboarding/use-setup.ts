import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OnboardingResponseSchema,
  OnboardingStateSchema,
  type OnboardingState,
} from "../../shared/onboarding-contract.js";
import { ArnoldCallError, useArnoldTool } from "../arnold-client.js";
import type { Profile, Wearable } from "../demo/model.js";
import {
  awaitsChat,
  cardProfileOf,
  cardViewOf,
  isBuilding,
  patchOf,
} from "../model/onboarding.js";

/** How often the card reads the state while ChatGPT builds the plan. */
export const BUILD_POLL_MS = 2500;
/** After this long without a plan the card asks the user to nudge the chat. */
export const BUILD_HINT_MS = 90_000;

/** The sentence the "Plan erstellen" button sends to the chat. */
export const BUILD_SENTENCE =
  "Erstelle mir jetzt bitte meinen Trainingsplan aus meinen Angaben.";

const requestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `card-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const message = (e: unknown) =>
  e instanceof ArnoldCallError
    ? e.message
    : "Das hat nicht geklappt. Bitte versuche es noch einmal.";

/**
 * The setup card's state against Arnold's onboarding service.
 *
 * Local first: every tap shows at once, the server stays the source of truth
 * and its stored state replaces the local copy. Taps of one burst are sent as
 * one `update_onboarding_profile` patch; saves run one after another, and a
 * failed save rolls back to the last stored state. The plan is built by
 * ChatGPT: the button asks Arnold for a proposal, sends a chat sentence and
 * reads the state until the proposal is there.
 */
export function useSetup(
  initial: OnboardingState,
  sendFollowUp: (sentence: string) => unknown,
) {
  const [state, setState] = useState(initial);
  const confirmed = useRef(initial);
  // Taps not yet stored, shown on top of the stored state.
  const [local, setLocal] = useState<Partial<Profile>>({});
  const pending = useRef<Partial<Profile>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [wearable, setWearable] = useState<Wearable>(
    initial.session.status === "COMPLETED" ? "later" : "open",
  );
  const [slow, setSlow] = useState(false);

  const updateTool = useArnoldTool(
    "update_onboarding_profile",
    OnboardingResponseSchema,
  );
  const readTool = useArnoldTool("get_onboarding_state", OnboardingStateSchema);
  const requestTool = useArnoldTool(
    "request_onboarding_plan",
    OnboardingResponseSchema,
  );
  const confirmTool = useArnoldTool(
    "confirm_onboarding_plan",
    OnboardingResponseSchema,
  );
  const finishTool = useArnoldTool(
    "finish_arnold_setup",
    OnboardingResponseSchema,
  );

  const accept = useCallback((next: OnboardingState | null) => {
    if (!next) return;
    confirmed.current = next;
    setState(next);
  }, []);

  const flush = useCallback(() => {
    const taps = pending.current;
    pending.current = {};
    if (Object.keys(taps).length === 0) return queue.current;
    const send = async () => {
      // Built at send time, on the state the previous save stored.
      const patch = patchOf(confirmed.current.session.profile, taps);
      if (!patch) return;
      try {
        const res = await updateTool.call({
          request_id: requestId(),
          profile: patch,
        });
        accept(res.state);
        setError(null);
      } catch (e) {
        setError(`${message(e)} Deine Eingabe ist zurückgesetzt.`);
        pending.current = {};
      } finally {
        // Shown taps are what is stored now, plus taps made meanwhile.
        setLocal({ ...pending.current });
      }
    };
    queue.current = queue.current.then(send, send);
    return queue.current;
  }, [updateTool, accept]);

  const update = useCallback(
    (change: Partial<Profile>) => {
      setLocal((l) => ({ ...l, ...change }));
      pending.current = { ...pending.current, ...change };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 350);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const run = useCallback(
    async (name: string, call: () => Promise<OnboardingState | null>) => {
      setBusy(name);
      try {
        if (timer.current) clearTimeout(timer.current);
        await flush();
        accept(await call());
        setError(null);
        return true;
      } catch (e) {
        setError(message(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [flush, accept],
  );

  // While the plan comes from the chat (built by ChatGPT, or the user's own
  // plan being sent there), read the state until it is there.
  const building = isBuilding(state);
  const waiting = awaitsChat(state);
  const { call: read } = readTool;
  useEffect(() => {
    if (!building) setSlow(false);
    if (!waiting) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (building && Date.now() - started > BUILD_HINT_MS) setSlow(true);
      read()
        .then((next) => {
          if (!awaitsChat(next)) accept(next);
        })
        .catch(() => undefined);
    }, BUILD_POLL_MS);
    return () => clearInterval(id);
  }, [building, waiting, read, accept]);

  const view = useMemo(() => {
    const v = cardViewOf(state, wearable);
    if (Object.keys(local).length === 0) return v;
    // Taps not stored yet are shown at once; the server's answer replaces them.
    return {
      ...v,
      profile: { ...cardProfileOf(state.session.profile), ...local },
    };
  }, [state, wearable, local]);

  return {
    view,
    state,
    error,
    busy,
    building,
    slow,
    update,
    createPlan: async () => {
      const ok = await run("plan", async () => {
        const res = await requestTool.call({ request_id: requestId() });
        return res.state;
      });
      if (ok) void sendFollowUp(BUILD_SENTENCE);
    },
    /** Nudges the chat again when the plan takes long. */
    askAgain: () => void sendFollowUp(BUILD_SENTENCE),
    confirmPlan: () =>
      run("confirm", async () => {
        const plan = confirmed.current.plan;
        if (!plan)
          throw new ArnoldCallError("confirm", "NO_PLAN", "Kein Plan.");
        const res = await confirmTool.call({
          request_id: requestId(),
          confirmation: {
            plan_version_id: plan.plan_version_id,
            row_revision: plan.row_revision,
            confirmed: true,
          },
        });
        return res.state;
      }),
    /** Completes a setup whose confirmation is stored but not yet finished. */
    finish: () =>
      run("finish", async () => {
        if (confirmed.current.session.status === "COMPLETED")
          return confirmed.current;
        const res = await finishTool.call({ request_id: requestId() });
        return res.state;
      }),
    chooseWearable: (choice: Wearable) => setWearable(choice),
    /** Back to an earlier collection step; answers stay. */
    goTo: (step: "welcome" | "profile") =>
      run("goto", async () => {
        const res = await updateTool.call({ request_id: requestId(), step });
        return res.state;
      }),
  };
}
