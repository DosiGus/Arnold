/**
 * State of one onboarding card (Eckdaten, Module, Checkliste).
 *
 * A host sends no news to a card that is already in the chat (RDS-013), so the
 * card never waits for a push: it reads the server state again when the window
 * gets focus, when the page turns visible, when the card is tapped and after
 * its own writes. Reads never run twice at the same time, and a read that
 * started before a write never overwrites the newer state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OnboardingProfilePatch,
  OnboardingState,
} from "../../shared/onboarding-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

const newRequestId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const SAVE_FAILED = "Das hat nicht geklappt. Versuch es noch einmal.";
export const SAVE_CONFLICT =
  "Dein Stand hatte sich geändert. Ich habe ihn neu geladen. Prüf die Angaben und tippe noch einmal auf Weiter.";

export const PLAN_MOVED =
  "Dein Plan hat sich geändert. Ich habe ihn neu geladen. Prüf ihn und tippe noch einmal auf Plan bestätigen.";

export type CardSaveResult =
  { ok: true } | { ok: false; message: string; conflict: boolean };

/**
 * The setup has no welcome page that picks the way any more (D-17: "Eigener
 * Plan" is deferred). The first card that saves sets the way: while none is
 * stored the patch carries `arnold_plan`; a stored way is never changed.
 */
export function withPath(
  patch: OnboardingProfilePatch,
  storedPath: OnboardingState["session"]["profile"]["path"],
): OnboardingProfilePatch {
  return storedPath === null && patch.path === undefined
    ? { path: "arnold_plan", ...patch }
    : patch;
}

export function useOnboardingCard(
  client: ArnoldMcpClient,
  initial: OnboardingState,
) {
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const stateRef = useRef(initial);
  stateRef.current = state;
  const reading = useRef(false);
  const writing = useRef(false);
  /** Bumped by every accepted write; an older read is dropped. */
  const generation = useRef(0);
  const alive = useRef(true);
  /** The same patch retried after a lost answer keeps its request id. */
  const attempt = useRef<{ key: string; id: string } | undefined>(undefined);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (reading.current || writing.current) return;
    reading.current = true;
    const started = generation.current;
    try {
      const next = await client.onboardingState();
      if (alive.current && started === generation.current) setState(next);
    } catch {
      // A failed read keeps the last state; the next trigger tries again.
    } finally {
      reading.current = false;
    }
  }, [client]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const onFocus = () => void reload();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  const save = useCallback(
    async (patch: OnboardingProfilePatch): Promise<CardSaveResult> => {
      const profile = withPath(patch, stateRef.current.session.profile.path);
      if (writing.current)
        return { ok: false, message: SAVE_FAILED, conflict: false };
      writing.current = true;
      setSaving(true);
      const key = JSON.stringify(profile);
      const id =
        attempt.current?.key === key ? attempt.current.id : newRequestId();
      attempt.current = { key, id };
      try {
        const response = await client.saveOnboardingProfile({
          request_id: id,
          expected_revision: stateRef.current.session.revision,
          profile,
        });
        if (response.ok && response.state) {
          generation.current += 1;
          attempt.current = undefined;
          if (alive.current) setState(response.state);
          return { ok: true };
        }
        if (response.error?.code === "REVISION_CONFLICT") {
          attempt.current = undefined;
          writing.current = false;
          await reload();
          return { ok: false, message: SAVE_CONFLICT, conflict: true };
        }
        return { ok: false, message: SAVE_FAILED, conflict: false };
      } catch {
        return { ok: false, message: SAVE_FAILED, conflict: false };
      } finally {
        writing.current = false;
        if (alive.current) setSaving(false);
      }
    },
    [client, reload],
  );

  /**
   * Confirms the plan shown on the card, exactly the version and revision the
   * user sees. A moved draft is refused by the server and read again.
   */
  const confirmPlan = useCallback(async (): Promise<CardSaveResult> => {
    const plan = stateRef.current.plan;
    if (!plan || writing.current)
      return { ok: false, message: SAVE_FAILED, conflict: false };
    writing.current = true;
    setSaving(true);
    try {
      const response = await client.confirmOnboardingPlan({
        request_id: newRequestId(),
        expected_revision: stateRef.current.session.revision,
        confirmation: {
          plan_version_id: plan.plan_version_id,
          row_revision: plan.row_revision,
          confirmed: true,
        },
      });
      if (response.ok && response.state) {
        generation.current += 1;
        if (alive.current) setState(response.state);
        return { ok: true };
      }
      if (
        response.error?.code === "REVISION_CONFLICT" ||
        response.error?.code === "STALE_CONFIRMATION"
      ) {
        writing.current = false;
        await reload();
        return { ok: false, message: PLAN_MOVED, conflict: true };
      }
      return { ok: false, message: SAVE_FAILED, conflict: false };
    } catch {
      return { ok: false, message: SAVE_FAILED, conflict: false };
    } finally {
      writing.current = false;
      if (alive.current) setSaving(false);
    }
  }, [client, reload]);

  return { state, saving, reload, save, confirmPlan };
}
