/**
 * The editable form of one workout: what the card shows under "Anpassen" and
 * turns into a `log_workout` request. Pure functions, no I/O.
 *
 * A draft starts from the server's proposal (last time, else plan) or from a
 * saved workout. Every exercise in it is sent with its sets spelled out, so
 * what the user sees is exactly what is stored.
 */
import type { ArnoldExercise, ArnoldSet } from "../shared/arnold-schema-v1";
import type {
  ProposedExercise,
  ProposedSet,
  SessionProposal,
  SetConventions,
} from "../shared/workout-contract";
import { formatLoad, formatNumber } from "./format";

export type DraftExercise = {
  /** Stable key for React; a plan item id or a generated one. */
  key: string;
  plan_item_id: string | null;
  exercise_id: string;
  exercise_name: string;
  /** The planned exercise this one replaces today, if swapped. */
  replaces?: string;
  conventions: SetConventions;
  sets: ProposedSet[];
  /** Edited set by set instead of one line for all sets. */
  each: boolean;
};

export type Draft = {
  exercises: DraftExercise[];
  /** Plan items the user left out today. */
  skipped: { plan_item_id: string; exercise_name: string }[];
};

export function sidesFor(c: SetConventions): ArnoldSet["side"][] {
  if (c.execution_mode === "unilateral") return ["left", "right"];
  if (c.execution_mode === "alternating") return ["alternating"];
  return ["both"];
}

export function conventionsOf(exercise: ArnoldExercise): SetConventions {
  return {
    load_basis: exercise.default_load_basis,
    execution_mode: exercise.default_execution_mode,
    implement_count: exercise.default_implement_count,
    reps_basis:
      exercise.default_execution_mode === "unilateral" ? "per_side" : "total",
  };
}

export const isBodyweight = (c: SetConventions) =>
  c.load_basis === "bodyweight_only";

/** Planned sets grouped into rounds: one per set, both sides together. */
export function rounds(exercise: Pick<DraftExercise, "sets" | "conventions">) {
  const per = sidesFor(exercise.conventions).length;
  const out: ProposedSet[][] = [];
  for (let i = 0; i < exercise.sets.length; i += per)
    out.push(exercise.sets.slice(i, i + per));
  return out;
}

/** True when every round has the same reps and weight. */
export function uniform(exercise: Pick<DraftExercise, "sets" | "conventions">) {
  const first = exercise.sets[0];
  return exercise.sets.every(
    (s) => s.reps === first.reps && s.load_kg === first.load_kg,
  );
}

/** What is still unknown and has to be filled in before saving. */
export function missing(exercise: DraftExercise) {
  const out: ("sets" | "reps" | "load")[] = [];
  if (!exercise.sets.length) out.push("sets");
  if (exercise.sets.some((s) => s.reps <= 0)) out.push("reps");
  if (
    !isBodyweight(exercise.conventions) &&
    exercise.sets.some((s) => s.load_kg === null)
  )
    out.push("load");
  return out;
}

const repsUnit = (c: SetConventions) =>
  c.reps_basis === "per_side" ? " je Seite" : "";

/**
 * One exercise as one line: "3 × 10 · 60 kg", "4 × 4 · Körpergewicht",
 * "60 kg · 10, 9, 8" when the sets differ. Unknown weight is said, not zeroed.
 */
export function exerciseLine(
  exercise: Pick<DraftExercise, "sets" | "conventions">,
): string {
  const c = exercise.conventions;
  const all = rounds(exercise);
  if (!all.length) return "Sätze fehlen";
  const load = (kg: number | null) =>
    isBodyweight(c)
      ? "Körpergewicht"
      : kg === null
        ? "Gewicht fehlt"
        : formatLoad({ load_kg: kg, load_basis: c.load_basis });
  if (uniform(exercise)) {
    const first = exercise.sets[0];
    const reps = first.reps > 0 ? formatNumber(first.reps, 0) : "?";
    return `${all.length} × ${reps}${repsUnit(c)} · ${load(first.load_kg)}`;
  }
  const loads = new Set(exercise.sets.map((s) => s.load_kg));
  const reps = all.map((r) => formatNumber(r[0].reps, 0)).join(", ");
  if (loads.size === 1)
    return `${load(exercise.sets[0].load_kg)} · ${reps}${repsUnit(c)}`;
  return all
    .map(
      (r) =>
        `${isBodyweight(c) ? "" : `${formatNumber(r[0].load_kg ?? 0, 2)} × `}${formatNumber(r[0].reps, 0)}`,
    )
    .join(", ");
}

let counter = 0;
const newKey = () => `extra-${++counter}`;

/** The planned exercise of one plan item, as in a fresh draft. */
export function plannedExercise(
  proposal: SessionProposal | undefined,
  planItemId: string,
): DraftExercise | undefined {
  const found = proposal?.exercises.find((e) => e.plan_item_id === planItemId);
  return found ? fromProposed(found) : undefined;
}

export function draftFromProposal(proposal: SessionProposal): Draft {
  return {
    exercises: proposal.exercises.map((e) => fromProposed(e)),
    skipped: [],
  };
}

function fromProposed(e: ProposedExercise): DraftExercise {
  return {
    key: e.plan_item_id ?? newKey(),
    plan_item_id: e.plan_item_id,
    exercise_id: e.exercise_id,
    exercise_name: e.exercise_name,
    conventions: e.conventions,
    sets: e.sets.length
      ? e.sets
      : // No count known: one empty round to fill in.
        sidesFor(e.conventions).map((side) => ({
          reps: e.rep_max ?? e.rep_min ?? 0,
          load_kg: null,
          side,
        })),
    each: !uniform(e),
  };
}

/**
 * A saved workout as a draft. Plan items that are not in it were skipped;
 * an exercise without a plan item was swapped in or added.
 */
export function draftFromSaved(
  sets: readonly ArnoldSet[],
  proposal: SessionProposal | undefined,
): Draft {
  const active = sets
    .filter((s) => s.status === "active" && s.set_type === "working")
    .sort(
      (a, b) =>
        a.exercise_order - b.exercise_order ||
        a.set_number - b.set_number ||
        a.side.localeCompare(b.side),
    );
  const groups = new Map<string, ArnoldSet[]>();
  for (const set of active) {
    const key = `${set.exercise_order}`;
    groups.set(key, [...(groups.get(key) ?? []), set]);
  }
  const exercises: DraftExercise[] = [...groups.values()].map((list) => {
    const first = list[0];
    const exercise: DraftExercise = {
      key: first.plan_item_id ?? newKey(),
      plan_item_id: first.plan_item_id,
      exercise_id: first.exercise_id,
      exercise_name: first.exercise_name_snapshot,
      conventions: {
        load_basis: first.load_basis,
        execution_mode: first.execution_mode,
        implement_count: first.implement_count,
        reps_basis: first.reps_basis,
      },
      sets: list.map((s) => ({
        reps: s.reps,
        load_kg: s.load_basis === "bodyweight_only" ? null : s.load_kg,
        side: s.side,
      })),
      each: false,
    };
    return { ...exercise, each: !uniform(exercise) };
  });
  const present = new Set(exercises.map((e) => e.plan_item_id));
  return {
    exercises,
    skipped: (proposal?.exercises ?? [])
      .filter((e) => e.plan_item_id && !present.has(e.plan_item_id))
      .map((e) => ({
        plan_item_id: e.plan_item_id!,
        exercise_name: e.exercise_name,
      })),
  };
}

/** Same reps and weight for every set, with `count` sets. */
export function setUniform(
  exercise: DraftExercise,
  change: { count?: number; reps?: number; load_kg?: number | null },
): DraftExercise {
  const sides = sidesFor(exercise.conventions);
  const first = exercise.sets[0];
  const reps = change.reps ?? first?.reps ?? 0;
  const load =
    change.load_kg !== undefined ? change.load_kg : (first?.load_kg ?? null);
  const count = change.count ?? Math.max(1, rounds(exercise).length);
  const sets: ProposedSet[] = [];
  for (let n = 0; n < count; n++)
    for (const side of sides)
      sets.push({
        reps,
        load_kg: isBodyweight(exercise.conventions) ? null : load,
        side,
      });
  return { ...exercise, sets };
}

/** Changes one round (both sides of one set) when editing set by set. */
export function setRound(
  exercise: DraftExercise,
  index: number,
  change: { reps?: number; load_kg?: number | null },
): DraftExercise {
  const per = sidesFor(exercise.conventions).length;
  return {
    ...exercise,
    sets: exercise.sets.map((s, i) =>
      Math.floor(i / per) === index
        ? {
            ...s,
            ...(change.reps !== undefined ? { reps: change.reps } : {}),
            ...(change.load_kg !== undefined
              ? {
                  load_kg: isBodyweight(exercise.conventions)
                    ? null
                    : change.load_kg,
                }
              : {}),
          }
        : s,
    ),
  };
}

/**
 * Swaps an exercise for today. The planned volume stays; the weight of the
 * old exercise says nothing about the new one, so it starts empty.
 */
export function swapExercise(
  exercise: DraftExercise,
  next: ArnoldExercise,
): DraftExercise {
  const conventions = conventionsOf(next);
  const count = Math.max(1, rounds(exercise).length);
  const reps = exercise.sets[0]?.reps ?? 0;
  const swapped: DraftExercise = {
    ...exercise,
    exercise_id: next.exercise_id,
    exercise_name: next.name_de,
    replaces: exercise.replaces ?? exercise.exercise_name,
    conventions,
    sets: [],
    each: false,
  };
  return setUniform({ ...swapped, sets: [] }, { count, reps, load_kg: null });
}

export function addedExercise(next: ArnoldExercise): DraftExercise {
  const conventions = conventionsOf(next);
  return setUniform(
    {
      key: newKey(),
      plan_item_id: null,
      exercise_id: next.exercise_id,
      exercise_name: next.name_de,
      conventions,
      sets: [],
      each: false,
    },
    { count: 3, reps: 10, load_kg: null },
  );
}

/** The `exercises` of a `log_workout` request for this draft. */
export function requestExercises(draft: Draft) {
  return [
    ...draft.skipped.map((s) => ({ plan_item_id: s.plan_item_id, skip: true })),
    ...draft.exercises.map((e) => ({
      ...(e.plan_item_id ? { plan_item_id: e.plan_item_id } : {}),
      exercise_id: e.exercise_id,
      sets: e.sets.map((s) => ({
        reps: s.reps,
        ...(isBodyweight(e.conventions) || s.load_kg === null
          ? {}
          : { load_kg: s.load_kg }),
        ...(s.side === "left" || s.side === "right" ? { side: s.side } : {}),
      })),
    })),
  ];
}
