import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanAdjustmentView } from "../../shared/plan-adjustment-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import type { WatchDelivery } from "../../shared/watch-contract";

/**
 * State of the card "Anpassung auf Zeit" (UX-008).
 *
 * It shows the newest open draft, else the adjustment that runs now, else
 * the next confirmed one. "Bestätigen" confirms exactly the revision shown;
 * one changed in the meantime is loaded again, never confirmed unseen.
 * Nothing takes effect without the click.
 */
export type PlanAdjustmentState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "failed" }
  | {
      kind: "ready" | "running" | "error";
      view: PlanAdjustmentView;
      canWrite: boolean;
      watch?: WatchDelivery;
    };

type Shown = Extract<PlanAdjustmentState, { view: unknown }>;

const newRequestId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Newest draft first, then the running one, then the next confirmed. */
export function pickAdjustment(
  views: readonly PlanAdjustmentView[],
): PlanAdjustmentView | undefined {
  const drafts = views
    .filter((v) => v.adjustment.status === "draft")
    .sort((a, b) =>
      a.adjustment.created_at_utc < b.adjustment.created_at_utc ? 1 : -1,
    );
  return (
    drafts[0] ??
    views.find((v) => v.running) ??
    views.find((v) => v.adjustment.status === "confirmed")
  );
}

export function usePlanAdjustment(
  client: ArnoldMcpClient,
  onChanged: () => void,
) {
  const [state, setState] = useState<PlanAdjustmentState>({ kind: "loading" });
  const shown = useRef<Shown | undefined>(undefined);
  const ids = useRef(new Map<string, string>());
  const busy = useRef(false);

  const load = useCallback(
    async (id?: string) => {
      try {
        const list = await client.planAdjustments(id);
        const view = pickAdjustment(list.adjustments);
        if (!view) {
          shown.current = undefined;
          return setState({ kind: "none" });
        }
        const next: Shown = {
          kind: "ready",
          view,
          canWrite: list.can_write,
        };
        shown.current = next;
        setState(next);
      } catch {
        setState({ kind: "failed" });
      }
    },
    [client],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (operation: "confirm_plan_adjustment" | "cancel_plan_adjustment") => {
      const current = shown.current;
      if (!current || busy.current) return;
      busy.current = true;
      const { plan_adjustment_id, row_revision } = current.view.adjustment;
      const key = `${operation}:${plan_adjustment_id}:${row_revision}`;
      const requestId = ids.current.get(key) ?? newRequestId();
      ids.current.set(key, requestId);
      setState({ ...current, kind: "running" });
      try {
        const response = await client.writePlanAdjustment(operation, {
          request_id: requestId,
          plan_adjustment_id,
          expected_row_revision: row_revision,
        });
        if (response.ok && response.result) {
          const done: Shown = {
            ...current,
            kind: "ready",
            view: response.result.plan_adjustment,
            watch: response.watch_delivery ?? "unknown",
          };
          shown.current = done;
          setState(done);
          onChanged();
          return;
        }
        if (response.error?.code === "REVISION_CONFLICT") {
          await load(plan_adjustment_id);
          return;
        }
        setState({ ...current, kind: "error" });
      } catch {
        setState({ ...current, kind: "error" });
      } finally {
        busy.current = false;
      }
    },
    [client, load, onChanged],
  );

  return {
    state,
    confirm: useCallback(() => send("confirm_plan_adjustment"), [send]),
    cancel: useCallback(() => send("cancel_plan_adjustment"), [send]),
    reload: useCallback(() => load(), [load]),
  };
}
