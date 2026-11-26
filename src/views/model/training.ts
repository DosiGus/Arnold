/**
 * Arnold's session proposal (`get_workout`) → the training card, and the
 * card's ticked sets → one `log_workout` call.
 *
 * Mapping only: the proposed weights and repetitions are Arnold's (doppelte
 * Progression, `src/analytics/progression.ts`); the card shows them and sends
 * back what the user actually did. Unknown stays unknown: an empty weight is
 * sent as no weight, never as 0.
 */
import type {
  SessionProposal,
  WorkoutContext,
} from "../../shared/workout-contract.js";
import type { PlanDay } from "../demo/model.js";
import type { SetRow } from "../onboarding/screens.js";

const kgText = (kg: number | null) =>
  kg === null ? "" : String(kg).replace(".", ",");

const range = (min: number | null, max: number | null) =>
  min === null && max === null
    ? "?"
    : min === max || max === null
      ? `${min}`
      : min === null
        ? `${max}`
        : `${min}–${max}`;

/** One key per exercise of the proposal. */
const keyOf = (e: SessionProposal["exercises"][number], i: number) =>
  e.plan_item_id ?? `extra-${i}-${e.exercise_id}`;

/** The session to train: the one named, else the first of the plan. */
export function proposalFor(
  context: WorkoutContext,
  sessionId: string | null,
): SessionProposal | null {
  return (
    context.proposals.find((p) => p.session_id === sessionId) ??
    context.proposals[0] ??
    null
  );
}

export function trainingDayOf(proposal: SessionProposal): PlanDay {
  return {
    id: proposal.session_id,
    kind: "strength",
    name: proposal.session_name,
    focus: "Arnolds Vorschlag fürs nächste Training",
    exercises: proposal.exercises.map((e, i) => ({
      id: keyOf(e, i),
      name: e.exercise_name,
      sets: e.target_sets ?? (e.sets.length || null),
      reps: range(e.rep_min, e.rep_max),
      kg: e.sets[0]?.load_kg ?? null,
      estimated: false,
    })),
  };
}

export function rowsOf(proposal: SessionProposal): Record<string, SetRow[]> {
  return Object.fromEntries(
    proposal.exercises.map((e, i) => {
      const rows: SetRow[] = e.sets.length
        ? e.sets.map((s) => ({
            kg: kgText(s.load_kg),
            reps: s.reps === null ? "" : String(s.reps),
            done: false,
          }))
        : Array.from({ length: e.target_sets ?? 1 }, () => ({
            kg: "",
            reps: "",
            done: false,
          }));
      return [keyOf(e, i), rows];
    }),
  );
}

const number = (text: string) => {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
};

/**
 * The `log_workout` arguments for the ticked sets, or an error sentence when
 * a ticked set cannot be stored as typed.
 */
export function logWorkoutInput(
  proposal: SessionProposal,
  rows: Record<string, SetRow[]>,
  options: { requestId: string; date: string; timezone: string },
): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const exercises: Record<string, unknown>[] = [];
  for (const [i, e] of proposal.exercises.entries()) {
    const done = (rows[keyOf(e, i)] ?? []).filter((r) => r.done);
    if (!done.length) {
      if (e.plan_item_id)
        exercises.push({ plan_item_id: e.plan_item_id, skip: true });
      continue;
    }
    const sets: { reps: number; load_kg?: number }[] = [];
    for (const r of done) {
      const reps = number(r.reps);
      const kg = number(r.kg);
      if (reps === null || !Number.isInteger(reps) || reps <= 0)
        return {
          ok: false,
          error: `Bei ${e.exercise_name} fehlen die Wiederholungen eines erledigten Satzes.`,
        };
      if (Number.isNaN(kg) || (kg !== null && kg < 0))
        return {
          ok: false,
          error: `Das Gewicht bei ${e.exercise_name} ist keine Zahl.`,
        };
      sets.push({ reps, ...(kg !== null ? { load_kg: kg } : {}) });
    }
    exercises.push(
      e.plan_item_id
        ? { plan_item_id: e.plan_item_id, sets }
        : { exercise_id: e.exercise_id, sets },
    );
  }
  return {
    ok: true,
    input: {
      request_id: options.requestId,
      workout_date_local: options.date,
      timezone: options.timezone,
      plan_version_id: proposal.plan_version_id,
      session_id: proposal.session_id,
      exercises,
    },
  };
}
