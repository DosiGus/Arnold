/**
 * "Dauerhaft im Plan": replaces one exercise of the active plan from the
 * training card.
 *
 * The active plan is never edited in place. This runs the same three plan
 * writes the plan editor uses — a new version, the replacement in it, its
 * activation — so history, revisions and audit stay exactly as they are.
 * The user's tap on "Dauerhaft im Plan" with both exercise names on screen is
 * the explicit confirmation the activation needs.
 *
 * Each write carries its own `request_id`; an unclear answer is resent once
 * with the same id, which the server reconciles instead of repeating. If a
 * later step fails, the half-built draft is discarded so no stray version is
 * left behind, and the card says what happened. Nothing is shown as changed
 * until the server has confirmed the activation.
 */
import { useCallback, useRef, useState } from "react";
import type {
  PlanWriteOperation,
  PlanWriteResponse,
} from "../../shared/plan-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";

const newRequestId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const FAILED =
  "Der Plan wurde nicht geändert. Du kannst die Übung nur für heute nehmen oder es gleich noch einmal versuchen.";

export function usePlanReplace(client: ArnoldMcpClient) {
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);

  /** One write, resent once with the same id when the outcome is unclear. */
  const send = useCallback(
    async (
      operation: PlanWriteOperation,
      input: Record<string, unknown>,
    ): Promise<PlanWriteResponse | undefined> => {
      const request = { request_id: newRequestId(), ...input };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await client.writePlan(operation, request);
          if (
            response.ok ||
            response.error?.recovery !== "retry_same_request" ||
            attempt === 1
          )
            return response;
        } catch {
          if (attempt === 1) return undefined;
        }
      }
      return undefined;
    },
    [client],
  );

  const discard = useCallback(
    async (plan_version_id: string, expected_row_revision: number) => {
      await send("archive_plan_draft", {
        plan_version_id,
        expected_row_revision,
        reason: "Tausch aus der Trainingskarte nicht abgeschlossen",
      }).catch(() => undefined);
    },
    [send],
  );

  /**
   * Replaces the exercise at `planItemId` of the active version
   * `planVersionId`. Resolves to an error text for the user, or undefined
   * when the new version is active.
   */
  const replace = useCallback(
    async (input: {
      planVersionId: string;
      planItemId: string;
      exerciseId: string;
    }): Promise<string | undefined> => {
      if (guard.current) return "Eine Planänderung läuft gerade.";
      guard.current = true;
      setBusy(true);
      try {
        const context = await client.planContext(input.planVersionId);
        const plan = context.plan;
        if (!context.can_write)
          return "In dieser Verbindung kann Arnold den Plan nicht ändern. Nimm die Übung nur für heute.";
        if (
          !plan ||
          plan.status !== "active" ||
          plan.plan_version_id !== input.planVersionId
        )
          return "Dein Plan hat sich inzwischen geändert. Öffne die Karte neu und versuche es noch einmal.";
        if (
          context.drafts.some((d) => d.plan_family_id === plan.plan_family_id)
        )
          return "Für diesen Plan ist schon ein Entwurf offen. Schließ ihn im Plan-Editor ab oder nimm die Übung nur für heute.";

        const session = plan.sessions.find((s) =>
          s.exercises.some((e) => e.plan_item_id === input.planItemId),
        );
        const position =
          session?.exercises.findIndex(
            (e) => e.plan_item_id === input.planItemId,
          ) ?? -1;
        const before = session?.exercises[position];
        if (!session || !before)
          return "Diese Übung steht nicht mehr in deinem Plan. Öffne die Karte neu.";

        const created = await send("create_plan_version", {
          source_plan_version_id: plan.plan_version_id,
        });
        const draft = created?.ok ? created.result?.plan?.version : undefined;
        if (!draft) return created?.error?.message ?? FAILED;

        // Same family: the session keeps its id and the order of its exercises.
        const item = draft.sessions.find(
          (s) => s.session_id === session.session_id,
        )?.exercises[position];
        if (!item || item.exercise_id !== before.exercise_id) {
          await discard(draft.plan_version_id, draft.row_revision);
          return FAILED;
        }

        const edited = await send("update_plan_draft", {
          plan_version_id: draft.plan_version_id,
          expected_row_revision: draft.row_revision,
          edits: [
            {
              type: "replace_plan_exercise",
              plan_item_id: item.plan_item_id,
              new_exercise_id: input.exerciseId,
            },
          ],
        });
        const next = edited?.ok ? edited.result?.plan?.version : undefined;
        if (!next) {
          await discard(draft.plan_version_id, draft.row_revision);
          return edited?.error?.message ?? FAILED;
        }

        const activated = await send("activate_training_plan", {
          plan_version_id: next.plan_version_id,
          expected_row_revision: next.row_revision,
          confirmation: {
            plan_version_id: next.plan_version_id,
            row_revision: next.row_revision,
            confirmed: true,
          },
        });
        if (!activated?.ok) {
          await discard(next.plan_version_id, next.row_revision);
          return activated?.error?.message ?? FAILED;
        }
        return undefined;
      } catch {
        return FAILED;
      } finally {
        guard.current = false;
        setBusy(false);
      }
    },
    [client, send, discard],
  );

  return { replace, busy };
}
