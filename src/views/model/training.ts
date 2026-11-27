/**
 * Arnold's session proposal (`get_workout`) → the training card, and the
 * card's ticked sets → one `log_workout` call.
 *
 * Mapping only: the proposed weights and repetitions are Arnold's (doppelte
 * Progression, `src/analytics/progression.ts`); the card shows them and sends
 * back what the user actually did. Unknown stays unknown: an empty weight is
 * sent as no weight, never as 0.
 */
import {
  UNUSUAL_SET_LIMITS,
  type SessionProposal,
  type WorkoutContext,
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
      bodyweight: e.conventions.load_basis === "bodyweight_only",
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

/** A ticked row as numbers, or why it cannot be stored as typed. */
function measured(
  exercise: string,
  r: SetRow,
):
  { ok: true; reps: number; kg: number | null } | { ok: false; error: string } {
  const reps = number(r.reps);
  const kg = number(r.kg);
  if (reps === null || !Number.isInteger(reps) || reps <= 0)
    return {
      ok: false,
      error: `Bei ${exercise} fehlen die Wiederholungen eines erledigten Satzes.`,
    };
  if (Number.isNaN(kg) || (kg !== null && kg < 0))
    return { ok: false, error: `Das Gewicht bei ${exercise} ist keine Zahl.` };
  return { ok: true, reps, kg };
}

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
      const checked = measured(e.exercise_name, r);
      if (!checked.ok) return checked;
      const { reps, kg } = checked;
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

/* ------------------------------------------------------ open training */

/** The latest strength training that was started and never finished. */
export function openWorkoutOf(
  context: WorkoutContext,
): WorkoutContext["workouts"][number] | null {
  return (
    context.workouts
      .filter(
        (w) =>
          w.status === "in_progress" &&
          (w.activity_type === undefined || w.activity_type === "strength"),
      )
      .sort((a, b) => b.created_at_utc.localeCompare(a.created_at_utc))[0] ??
    null
  );
}

type StoredSet = WorkoutContext["sets"][number];

/**
 * The proposal's rows with what an open training already holds: stored sets
 * first (ticked, not changeable), then the proposal's remaining sets.
 */
export function resumeRows(
  proposal: SessionProposal,
  stored: readonly StoredSet[],
): Record<string, SetRow[]> {
  const proposed = rowsOf(proposal);
  return Object.fromEntries(
    proposal.exercises.map((e, i) => {
      const key = keyOf(e, i);
      const kept = stored
        .filter(
          (s) =>
            s.status === "active" &&
            (e.plan_item_id
              ? s.plan_item_id === e.plan_item_id
              : s.plan_item_id === null && s.exercise_id === e.exercise_id),
        )
        .sort((a, b) => a.set_number - b.set_number)
        .map((s) => ({
          kg: kgText(s.load_kg),
          reps: String(s.reps),
          done: true,
          stored: true,
        }));
      return [key, [...kept, ...(proposed[key] ?? []).slice(kept.length)]];
    }),
  );
}

/** The newly ticked sets of a continued training, for `log_workout_sets`. */
export function newSetsOf(
  proposal: SessionProposal,
  rows: Record<string, SetRow[]>,
):
  { ok: true; sets: Record<string, unknown>[] } | { ok: false; error: string } {
  const sets: Record<string, unknown>[] = [];
  for (const [i, e] of proposal.exercises.entries()) {
    for (const [n, r] of (rows[keyOf(e, i)] ?? []).entries()) {
      if (!r.done || r.stored) continue;
      const checked = measured(e.exercise_name, r);
      if (!checked.ok) return checked;
      sets.push({
        exercise_id: e.exercise_id,
        plan_item_id: e.plan_item_id,
        set_type: "working",
        reps: checked.reps,
        load_kg: checked.kg,
        side: e.sets[n]?.side ?? e.sets[0]?.side ?? "both",
        ...e.conventions,
      });
    }
  }
  return { ok: true, sets };
}

/* ------------------------------------------------------ Arnold asks back */

/** A refusal the card can answer: its question and the taps that answer it. */
export interface SaveQuestion {
  question: string;
  choices: {
    label: string;
    kind: "primary" | "soft" | "ghost";
    /** Absent: only closes the question, nothing is written. */
    run?: () => Promise<SaveOutcome>;
  }[];
}

/** Null: stored. A string: why not. A question: the user decides. */
export type SaveOutcome = string | SaveQuestion | null;

/** Server texts address the model; the card keeps what concerns the user. */
export function cardMessage(message: string): string {
  const cut = message.indexOf(" Es wurde nichts gespeichert.");
  return cut < 0 ? message : `${message.slice(0, cut)} Nichts gespeichert.`;
}

/** Names the ticked values behind a `CONFIRMATION_REQUIRED`. */
export function unusualQuestion(
  proposal: SessionProposal,
  rows: Record<string, SetRow[]>,
): string {
  const found: string[] = [];
  for (const [i, e] of proposal.exercises.entries())
    for (const r of rows[keyOf(e, i)] ?? []) {
      if (!r.done || r.stored) continue;
      const kg = number(r.kg);
      const reps = number(r.reps);
      if (kg !== null && kg > UNUSUAL_SET_LIMITS.load_kg)
        found.push(`${r.kg.trim()} kg bei ${e.exercise_name}`);
      if (reps !== null && reps > UNUSUAL_SET_LIMITS.reps)
        found.push(`${r.reps.trim()} Wiederholungen bei ${e.exercise_name}`);
    }
  return found.length
    ? `Ungewöhnlich hoch: ${[...new Set(found)].join(", ")}. Stimmt das?`
    : "Ein Wert ist ungewöhnlich hoch. Stimmt er?";
}

/**
 * The one saved training a `DUPLICATE_WORKOUT` is about (`workout_id=…` in
 * its details), if unambiguous.
 */
export function savedTwinId(details: readonly string[]): string | null {
  const ids = details.flatMap((d) => /^workout_id=(.+)$/.exec(d)?.[1] ?? []);
  return ids.length === 1 ? ids[0]! : null;
}
