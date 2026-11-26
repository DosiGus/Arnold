/**
 * Which card the chat asked for. One bundle serves several tools; the host
 * does not name the opening tool, so the card reads it from the shape of the
 * result (each tool has its own contract) and, for a failed pairing, from the
 * arguments. Confirmation tokens come only from `_meta.arnold`.
 */
import {
  DeleteAccountPublicResponseSchema,
  type DeleteAccountResponse,
} from "../../shared/account-contract.js";
import type { ArnoldDashboardView } from "../../shared/arnold-view.js";
import type { DashboardCard } from "../../shared/dashboard-cards.js";
import {
  MobilityCardViewSchema,
  type MobilityCard,
} from "../../shared/mobility-contract.js";
import { mergeModelOutput } from "../../shared/model-output-contract.js";
import {
  RunCardViewSchema,
  type RunCard,
} from "../../shared/run-card-contract.js";
import {
  ListGarminWatchesSchema,
  PairGarminWatchResponseSchema,
  type ListGarminWatches,
  type PairGarminWatchConfirmMeta,
} from "../../shared/watch-contract.js";
import type { Screen } from "../onboarding/dashboard.js";
import {
  accountErrorText,
  deleteConfirmation,
  pairConfirmation,
  type DeleteConfirmation,
} from "./settings.js";

export type Opening =
  | { kind: "dashboard" }
  | { kind: "run"; card: RunCard; workoutId: string | null }
  | { kind: "mobility"; card: MobilityCard; workoutId: string | null }
  /** `confirm` is null when the card has no token (replayed card). */
  | {
      kind: "pair";
      deviceLabel: string;
      confirm: PairGarminWatchConfirmMeta | null;
    }
  | { kind: "paired"; deviceLabel: string }
  | { kind: "pair_failed"; message: string }
  | { kind: "watches"; data: ListGarminWatches }
  | {
      kind: "delete";
      items: string[];
      confirm: DeleteConfirmation | null;
    }
  | { kind: "deleted" };

type Meta = Record<string, unknown> | undefined;

const arnoldOf = (meta: Meta) =>
  (meta?.arnold ?? {}) as Record<string, unknown>;

export function openingOf(
  output: unknown,
  meta: Meta,
  input: Record<string, unknown> | undefined,
): Opening {
  const arnold = arnoldOf(meta);
  const merged = mergeModelOutput(output, arnold.internal);
  const run = RunCardViewSchema.safeParse(merged);
  if (run.success)
    return {
      kind: "run",
      card: run.data.card,
      workoutId: run.data.workout_id,
    };
  const mobility = MobilityCardViewSchema.safeParse(merged);
  if (mobility.success)
    return {
      kind: "mobility",
      card: mobility.data.card,
      workoutId: mobility.data.workout_id,
    };
  const pair = PairGarminWatchResponseSchema.safeParse(merged);
  if (pair.success)
    return pair.data.stage === "paired"
      ? { kind: "paired", deviceLabel: pair.data.device_label }
      : {
          kind: "pair",
          deviceLabel: pair.data.device_label,
          confirm: pairConfirmation(arnold),
        };
  const watches = ListGarminWatchesSchema.safeParse(merged);
  if (watches.success) return { kind: "watches", data: watches.data };
  const del = DeleteAccountPublicResponseSchema.safeParse(merged);
  if (del.success) {
    if (del.data.stage === "deleted") return { kind: "deleted" };
    const items = (
      del.data as Omit<
        Extract<DeleteAccountResponse, { stage: "confirm" }>,
        "confirmation_token"
      >
    ).summary.stored_items;
    return { kind: "delete", items, confirm: deleteConfirmation(arnold) };
  }
  if (typeof input?.user_code === "string" && typeof arnold.code === "string")
    return {
      kind: "pair_failed",
      message: accountErrorText(
        arnold.code,
        "Die Uhr ließ sich gerade nicht koppeln.",
      ),
    };
  return { kind: "dashboard" };
}

/**
 * Where a dashboard card leads: a screen of the app, or one of the chat cards
 * the app has no screen for.
 */
export type DashboardTarget =
  | { type: "screen"; screen: Screen }
  | {
      type: "card";
      card: "progress" | "history" | "plan_change" | "plan_adjustment";
      exerciseId: string | null;
      metric: NonNullable<ArnoldDashboardView["focus"]>["metric"];
      workoutId: string | null;
    };

const SCREENS: Partial<Record<DashboardCard, Screen>> = {
  home: "dashboard",
  week: "dashboard",
  today: "training",
  plan: "plan",
  stats: "stats",
  goals: "goals",
  records: "records",
};

export function dashboardTarget(
  focus: ArnoldDashboardView["focus"],
): DashboardTarget {
  if (!focus) return { type: "screen", screen: "dashboard" };
  const screen = SCREENS[focus.card];
  if (screen) return { type: "screen", screen };
  return {
    type: "card",
    card: focus.card as Extract<DashboardTarget, { type: "card" }>["card"],
    exerciseId: focus.exercise_id,
    metric: focus.metric,
    workoutId: focus.workout_id,
  };
}
