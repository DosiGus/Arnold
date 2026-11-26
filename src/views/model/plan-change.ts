/**
 * The two cards that wait for the user's yes: the plan change (open draft
 * against the active plan, `compare_plan_versions`) and the adjustment for a
 * while (`get_plan_adjustments`). Mapping only; what changed is decided by
 * the server.
 */
import { formatShortDay } from "../../shared/arnold-format.js";
import {
  planChangeRows,
  type PlanChangeRow,
} from "../../shared/plan-change-rows.js";
import type {
  PlanAdjustmentList,
  PlanAdjustmentView,
} from "../../shared/plan-adjustment-contract.js";
import type {
  PlanContext,
  PlanVersionComparison,
  TrainingPlanVersionSummary,
} from "../../shared/plan-contract.js";
import type { WatchDelivery } from "../../shared/watch-contract.js";

export type PlanChangeCandidate =
  | { kind: "none"; reason: "no_active" | "no_draft" }
  | {
      kind: "compare";
      from: string;
      draft: TrainingPlanVersionSummary;
    };

/** The newest open draft against the active plan, or why there is none. */
export function planChangeCandidate(context: PlanContext): PlanChangeCandidate {
  const active = context.active_plan_version_id;
  if (!active) return { kind: "none", reason: "no_active" };
  const draft = context.drafts[0];
  if (!draft) return { kind: "none", reason: "no_draft" };
  return { kind: "compare", from: active, draft };
}

export type PlanChangeModel = {
  name: string;
  versionNo: number;
  planVersionId: string;
  rowRevision: number;
  openDrafts: number;
  rows: PlanChangeRow[];
  canWrite: boolean;
};

/** Null when the draft does not differ from the active plan. */
export function planChangeModel(
  context: PlanContext,
  comparison: PlanVersionComparison,
): PlanChangeModel | null {
  if (comparison.changes.length === 0) return null;
  const to = comparison.to;
  return {
    name: to.name,
    versionNo: to.version_no,
    planVersionId: to.plan_version_id,
    rowRevision: to.row_revision,
    openDrafts: context.drafts.length,
    rows: planChangeRows(comparison.changes),
    canWrite: context.can_write,
  };
}

/**
 * Exactly the version and revision on screen: the server refuses a draft that
 * was edited in the meantime.
 */
export function applyPlanInput(model: PlanChangeModel, requestId: string) {
  return {
    request_id: requestId,
    plan_version_id: model.planVersionId,
    expected_row_revision: model.rowRevision,
    confirmation: {
      plan_version_id: model.planVersionId,
      row_revision: model.rowRevision,
      confirmed: true,
    },
  };
}

export function declinePlanInput(model: PlanChangeModel, requestId: string) {
  return {
    request_id: requestId,
    plan_version_id: model.planVersionId,
    expected_row_revision: model.rowRevision,
  };
}

export const STALE_CODES = ["REVISION_CONFLICT", "STALE_CONFIRMATION"];

/** Whether the saved plan is on the watch; null says nothing about it. */
export function watchLine(watch: WatchDelivery | undefined): string | null {
  if (watch === "delivered") return "Der Plan ist auf deiner Uhr.";
  if (watch === "pending")
    return "Die Uhr bekommt den Plan beim nächsten Verbinden.";
  return null;
}

/* ------------------------------------------------- adjustment for a while */

/** Newest draft first, then the running one, then the next confirmed. */
export function pickAdjustment(
  list: PlanAdjustmentList,
): PlanAdjustmentView | null {
  const views = list.adjustments;
  const drafts = views
    .filter((v) => v.adjustment.status === "draft")
    .sort((a, b) =>
      b.adjustment.created_at_utc.localeCompare(a.adjustment.created_at_utc),
    );
  return (
    drafts[0] ??
    views.find((v) => v.running) ??
    views.find((v) => v.adjustment.status === "confirmed") ??
    null
  );
}

export type AdjustmentModel = {
  id: string;
  rowRevision: number;
  status: PlanAdjustmentView["adjustment"]["status"];
  title: string;
  period: string;
  sessions: { key: string; label: string; value: string }[];
  rows: PlanChangeRow[];
  hints: string[];
  back: string;
  /** "Gilt jetzt" or "Gilt ab Mo. 24.11." once confirmed. */
  confirmedText: string;
};

function title(view: PlanAdjustmentView): string {
  const { kind, reason } = view.adjustment;
  if (kind === "today") return "Heute kürzer";
  if (kind === "week") return "Diese Woche";
  if (kind === "month") return "Diesen Monat: Stand halten";
  return reason ?? "Für eine Weile";
}

export function adjustmentModel(view: PlanAdjustmentView): AdjustmentModel {
  const a = view.adjustment;
  const start = a.start_date_local;
  const end = a.end_date_local;
  return {
    id: a.plan_adjustment_id,
    rowRevision: a.row_revision,
    status: a.status,
    title: title(view),
    period:
      start === end
        ? `Nur ${formatShortDay(start)}`
        : `${formatShortDay(start)} bis ${formatShortDay(end)}`,
    sessions: view.sessions.map((s) => ({
      key: s.session_id,
      label: s.session_name,
      value: [
        `${s.exercises.length} ${s.exercises.length === 1 ? "Übung" : "Übungen"}`,
        s.minutes === null ? null : `ca. ${s.minutes} Min.`,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    rows: planChangeRows(view.changes),
    hints: [
      view.runs_unchanged
        ? "Deine geplanten Läufe bleiben, wie sie sind."
        : null,
      view.capped ? "Länger als 56 Tage geht eine Anpassung nicht." : null,
    ].filter((h): h is string => h !== null),
    back: `Ab ${formatShortDay(view.normal_from)} gilt wieder dein normaler Plan.`,
    confirmedText: view.running
      ? "Gilt jetzt"
      : `Gilt ab ${formatShortDay(start)}`,
  };
}

export const adjustmentInput = (model: AdjustmentModel, requestId: string) => ({
  request_id: requestId,
  plan_adjustment_id: model.id,
  expected_row_revision: model.rowRevision,
});
