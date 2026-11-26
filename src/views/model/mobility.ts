/**
 * Arnold's mobility overview (`get_mobility_overview`) → the checklist of the
 * training screen. Mapping and wording only; which routines are due today and
 * whether they are done comes from the server.
 */
import { MOBILITY_CATALOG } from "../../shared/mobility-catalog.js";
import type { MobilityOverview } from "../../shared/mobility-contract.js";
import type { PlanDay, PlanKind } from "../demo/model.js";

const names = new Map(MOBILITY_CATALOG.map((e) => [e.id, e.name_de]));

export type Routine = MobilityOverview["today"]["items"][number];

/** Today's routines of one card kind: the morning routine, or the sessions. */
export function routinesOf(
  overview: MobilityOverview,
  kind: PlanKind,
): Routine[] {
  const wanted = kind === "morning" ? "morning" : "session";
  return overview.today.items.filter((i) => i.kind === wanted);
}

/** The routine to show first: an open one, else the first. */
export const firstOpen = (routines: readonly Routine[]): Routine | null =>
  routines.find((r) => !r.done) ?? routines[0] ?? null;

export function routineDay(routine: Routine): PlanDay {
  return {
    id: routine.session_id,
    kind: routine.kind === "morning" ? "morning" : "mobility",
    name: routine.session_name,
    focus: `${routine.minutes} Min.`,
    exercises: routine.template.items.map((item) => {
      const side = item.sides === 2 ? " je Seite" : "";
      return {
        id: item.exercise_id,
        name: names.get(item.exercise_id) ?? item.exercise_id,
        sets: null,
        reps: "",
        kg: null,
        estimated: false,
        detail:
          item.reps !== null
            ? `${item.reps} Wdh.${side}`
            : `${item.seconds_per_side} s${side}`,
      };
    }),
  };
}

/**
 * The `log_mobility` arguments for a planned routine done today. No minutes:
 * the card does not measure them, and unknown stays unknown.
 */
export function logMobilityInput(
  overview: MobilityOverview,
  routine: Routine,
  options: { requestId: string; timezone: string },
): Record<string, unknown> {
  return {
    request_id: options.requestId,
    kind: routine.kind,
    session_id: routine.session_id,
    workout_date_local: overview.today.date_local,
    timezone: options.timezone,
  };
}
