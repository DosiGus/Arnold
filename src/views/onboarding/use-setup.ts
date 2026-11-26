import { useCallback, useEffect, useRef, useState } from "react";
import {
  type OnboardingView,
  type Profile,
  snapshotOf,
  viewOf,
} from "../demo/model.js";
import { useCallTool } from "../helpers.js";

/**
 * Local-first state: every tap shows at once (optimistic), the server stays the
 * source of truth and its answer replaces the local copy. A failed save rolls
 * back to the last confirmed state. Saves of the same burst are merged.
 */
export function useSetup(initial: OnboardingView) {
  const [view, setView] = useState(initial);
  const confirmed = useRef(initial);
  const pending = useRef<Partial<Profile>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saves run strictly one after another, so a later action never overtakes an
  // earlier save on the server.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // Saves not answered yet. While any is open, an older answer must not
  // overwrite what the user tapped after it.
  const open = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const updateTool = useCallTool("update_profile");
  const planTool = useCallTool("create_plan_draft");
  const confirmTool = useCallTool("confirm_plan");
  const wearableTool = useCallTool("set_wearable");
  const finishTool = useCallTool("finish_setup");
  const resetTool = useCallTool("reset_setup");
  const goTool = useCallTool("go_to_step");

  const accept = useCallback((next: OnboardingView) => {
    confirmed.current = next;
    setView(next);
    setError(null);
  }, []);

  const flush = useCallback(() => {
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return queue.current;
    open.current += 1;
    const send = async () => {
      try {
        const res = await updateTool.callToolAsync(patch as never);
        if (res.isError) throw new Error("save");
        const next = (res.structuredContent as { state: OnboardingView }).state;
        confirmed.current = next;
        open.current -= 1;
        if (open.current === 0 && Object.keys(pending.current).length === 0)
          accept(next);
      } catch {
        open.current -= 1;
        setView(confirmed.current);
        setError("Das hat nicht geklappt. Deine Eingabe ist zurückgesetzt.");
      }
    };
    queue.current = queue.current.then(send, send);
    return queue.current;
  }, [updateTool, accept]);

  const update = useCallback(
    (patch: Partial<Profile>) => {
      setView((v) => {
        const s = snapshotOf(v);
        return viewOf({
          ...s,
          profile: { ...s.profile, ...patch },
          plan: s.confirmed ? s.plan : null,
        });
      });
      pending.current = { ...pending.current, ...patch };
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
    async (
      name: string,
      call: () => Promise<{ isError?: boolean; structuredContent?: unknown }>,
      minMs = 0,
    ) => {
      setBusy(name);
      const started = Date.now();
      try {
        await flush();
        const res = await call();
        const wait = minMs - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (res.isError) throw new Error(name);
        accept((res.structuredContent as { state: OnboardingView }).state);
      } catch (e) {
        console.error("setup action failed", name, e);
        setError(
          `Das hat nicht geklappt. Bitte versuche es noch einmal. [${name}: ${e instanceof Error ? e.message : JSON.stringify(e)}]`,
        );
      } finally {
        setBusy(null);
      }
    },
    [flush, accept],
  );

  return {
    view,
    error,
    busy,
    update,
    createPlan: () => run("plan", () => planTool.callToolAsync(), 1600),
    confirmPlan: () => run("confirm", () => confirmTool.callToolAsync()),
    chooseWearable: (choice: "connect" | "later") =>
      run("wearable", () => wearableTool.callToolAsync({ choice })),
    finish: () => run("finish", () => finishTool.callToolAsync()),
    goTo: (step: "welcome" | "profile" | "plan") =>
      run("goto", () => goTool.callToolAsync({ step })),
    reset: () => run("reset", () => resetTool.callToolAsync()),
  };
}
