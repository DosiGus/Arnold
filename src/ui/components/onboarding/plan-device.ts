import type { PlannedExercise } from "../../../shared/plan-contract";
import { conventionsOf } from "./proposal-weights";

/**
 * How a planned exercise's weight is adjusted by hand (RDS-009): the step of
 * the plus and minus buttons and the lowest weight, by the kind of equipment.
 * Bodyweight exercises have no weight to adjust.
 */
export type WeightDevice = {
  kind: "barbell" | "dumbbell" | "machine" | "other";
  label: string;
  step: number;
  min: number;
};

export function deviceOf(item: PlannedExercise): WeightDevice | undefined {
  const c = conventionsOf(item);
  const equipment = item.exercise_equipment.toLowerCase();
  if (
    c.load_basis === "bodyweight_only" ||
    /körpergewicht|bodyweight/.test(equipment)
  )
    return undefined;
  if (
    c.load_basis === "machine_display" ||
    /machine|cable|kabel|masch/.test(equipment)
  )
    return { kind: "machine", label: "Maschine oder Kabel", step: 5, min: 5 };
  if (
    c.load_basis === "per_implement" ||
    /dumbbell|kurzhantel|kettlebell/.test(equipment)
  )
    return { kind: "dumbbell", label: "Kurzhantel", step: 2, min: 2 };
  if (/barbell|langhantel/.test(equipment))
    return { kind: "barbell", label: "Langhantel", step: 2.5, min: 20 };
  return { kind: "other", label: "Gewicht", step: 2.5, min: 2.5 };
}

const round = (n: number) => Math.round(n * 100) / 100;
/** One step up; from an unknown weight the lowest weight comes first. */
export const stepUp = (kg: number | null, d: WeightDevice) =>
  kg === null ? d.min : round(Math.max(d.min, kg + d.step));
/** One step down; null when that would fall below the lowest weight. */
export const stepDown = (kg: number | null, d: WeightDevice) =>
  kg === null || kg - d.step < d.min ? null : round(kg - d.step);
