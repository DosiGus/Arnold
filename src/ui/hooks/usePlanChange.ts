import { useCallback, useEffect, useRef, useState } from "react";
import type { TrainingPlanVersionSummary } from "../../shared/plan-contract";
import {
  planChangeRows,
  type PlanChangeRow,
} from "../../shared/plan-change-rows";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

/**
 * State of the plan change card.
 *
 * It shows the newest open draft against the active plan. The card names the
 * exact version and revision it loaded, and "Übernehmen" confirms exactly that
 * pair: a draft edited in the meantime is refused by the server (state
 * `stale`) and shown again, never activated from an outdated view. Nothing is
 * activated without the click.
 */
export type PlanChangeState =
  | { kind: "loading" }
  | { kind: "none"; reason: "no_active" | "no_draft" | "no_difference" }
  | { kind: "failed" }
  | {
      kind: "ready" | "running" | "confirmed" | "declined" | "error" | "stale";
      draft: TrainingPlanVersionSummary;
      active: TrainingPlanVersionSummary;
      /** Open drafts in total; more than one means the card says which one. */
      openDrafts: number;
      rows: PlanChangeRow[];
      canWrite: boolean;
    };

const newRequestId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Shown = Extract<PlanChangeState, { draft: unknown }>;

export function usePlanChange(client: ArnoldMcpClient, onChanged: () => void) {
  const [state, setState] = useState<PlanChangeState>({ kind: "loading" });
  const shown = useRef<Shown | undefined>(undefined);
  // One request id per operation on one version+revision, so a retry after an
  // unclear outcome is recognised by the server instead of doing it twice.
  const ids = useRef(new Map<string, string>());
  const busy = useRef(false);

  const load = useCallback(
    async (afterStale = false) => {
      try {
        const context = await client.planContext();
        const draft = context.drafts[0];
        const active = context.families
          .flatMap((family) => family.versions)
          .find(
            (version) =>
              version.plan_version_id === context.active_plan_version_id,
          );
        if (!context.active_plan_version_id || !active) {
          shown.current = undefined;
          return setState({ kind: "none", reason: "no_active" });
        }
        if (!draft) {
          shown.current = undefined;
          return setState({ kind: "none", reason: "no_draft" });
        }
        const comparison = await client.comparePlans(
          context.active_plan_version_id,
          draft.plan_version_id,
        );
        if (comparison.changes.length === 0) {
          shown.current = undefined;
          return setState({ kind: "none", reason: "no_difference" });
        }
        const next: Shown = {
          kind: afterStale ? "stale" : "ready",
          draft: comparison.to,
          active: comparison.from,
          openDrafts: context.drafts.length,
          rows: planChangeRows(comparison.changes),
          canWrite: context.can_write,
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
    async (operation: "activate_training_plan" | "archive_plan_draft") => {
      const current = shown.current;
      if (!current || busy.current) return;
      busy.current = true;
      const { plan_version_id, row_revision } = current.draft;
      const idKey = `${operation}:${plan_version_id}:${row_revision}`;
      const requestId = ids.current.get(idKey) ?? newRequestId();
      ids.current.set(idKey, requestId);
      setState({ ...current, kind: "running" });
      try {
        const response = await client.writePlan(
          operation,
          operation === "activate_training_plan"
            ? {
                request_id: requestId,
                plan_version_id,
                expected_row_revision: row_revision,
                confirmation: {
                  plan_version_id,
                  row_revision,
                  confirmed: true,
                },
              }
            : {
                request_id: requestId,
                plan_version_id,
                expected_row_revision: row_revision,
              },
        );
        if (response.ok) {
          const done: Shown = {
            ...current,
            kind:
              operation === "activate_training_plan" ? "confirmed" : "declined",
          };
          shown.current = done;
          setState(done);
          onChanged();
          return;
        }
        const code = response.error?.code;
        if (code === "REVISION_CONFLICT" || code === "STALE_CONFIRMATION") {
          await load(true);
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
    apply: useCallback(() => send("activate_training_plan"), [send]),
    decline: useCallback(() => send("archive_plan_draft"), [send]),
    reload: useCallback(() => load(), [load]),
  };
}
