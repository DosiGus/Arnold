/**
 * Start weights for a new plan: what the first training of an exercise
 * should use when the user has never logged it.
 *
 * A deterministic estimate, deliberately on the light side. The first session
 * is for finding the weight; from the second one on the card proposes what was
 * actually lifted, so a cautious start costs one easy workout, a heavy one an
 * injury. The same answers always give the same weights, which is why this
 * lives here and not in the chat model.
 *
 * The table holds, per catalog exercise, the weight for 10 clean repetitions
 * of an intermediate man of 80 kg, as a fraction of body weight, in the
 * exercise's own load basis (total, per dumbbell, or the machine display).
 * Everything else scales from it:
 *
 *   - body weight allometrically (strength grows slower than mass),
 *   - sex, experience and age by fixed factors,
 *   - the repetition target by the Epley relation,
 *   - and, when the user named a weight and its repetitions for an anchor
 *     lift, every exercise of that anchor's group from the user's own figure
 *     instead (D-02): the figure is turned into the weight for 10 by the same
 *     Epley relation and carried over by the table's proportions.
 *
 * Bodyweight exercises and exercises outside the table get no estimate: an
 * unknown weight stays unknown.
 */

export type StartLoadLevel = "lighter" | "normal" | "heavier";

type Group = "push" | "pull" | "legs";

/**
 * The anchor lifts the setup may ask about, per movement, in the order the
 * equipment decides between them (D-03). The setup asks for the first that
 * fits; any of them, once named, carries over to its whole group.
 */
export const ANCHORS: Record<Group, readonly AnchorLift[]> = {
  push: ["bench-press", "dumbbell-bench-press", "chest-press-machine"],
  pull: ["lat-pulldown", "seated-cable-row", "one-arm-row"],
  legs: ["squat", "leg-press", "goblet-squat"],
};
export const ANCHOR_LIFTS = [
  "bench-press",
  "dumbbell-bench-press",
  "chest-press-machine",
  "lat-pulldown",
  "seated-cable-row",
  "one-arm-row",
  "squat",
  "leg-press",
  "goblet-squat",
] as const;
export type AnchorLift = (typeof ANCHOR_LIFTS)[number];
/** Repetitions a named weight may be for. */
export const KNOWN_REPS_MIN = 1;
export const KNOWN_REPS_MAX = 12;
/**
 * A named weight: kilograms (in the lift's own load basis) for a number of
 * clean repetitions. A bare number is the older answer for "8–10" and counts
 * as 9 repetitions.
 */
export type KnownLoad = { kg: number; reps: number } | number;
export type KnownLoads = Partial<Record<AnchorLift, KnownLoad>>;

export type StartLoadInput = {
  exercise_id: string;
  /** The planned repetitions; the top of a range, so the estimate stays light. */
  reps: number | null;
  sex?: "female" | "male" | "diverse" | null;
  body_weight_kg?: number | null;
  age_years?: number | null;
  experience?: "beginner" | "intermediate" | "advanced" | null;
  known?: KnownLoads;
  level?: StartLoadLevel;
};

type Row = {
  /** Fraction of body weight for 10 reps, intermediate man of 80 kg. */
  ratio: number;
  group: Group;
  /** Smallest step the equipment allows, and the lightest sensible load. */
  step: number;
  min: number;
};

const barbell = (ratio: number, group: Group): Row => ({
  ratio,
  group,
  step: 2.5,
  min: 20,
});
const dumbbell = (ratio: number, group: Group): Row => ({
  ratio,
  group,
  step: 2,
  min: 2,
});
const machine = (ratio: number, group: Group): Row => ({
  ratio,
  group,
  step: 5,
  min: 5,
});
const cable = (ratio: number, group: Group): Row => ({
  ratio,
  group,
  step: 2.5,
  min: 5,
});

const TABLE: Record<string, Row> = {
  "bench-press": barbell(0.75, "push"),
  "dumbbell-bench-press": dumbbell(0.28, "push"),
  "incline-dumbbell-press": dumbbell(0.25, "push"),
  "chest-press-machine": machine(0.7, "push"),
  "overhead-press": barbell(0.45, "push"),
  "dumbbell-shoulder-press": dumbbell(0.2, "push"),
  "lateral-raise": dumbbell(0.1, "push"),
  "triceps-pushdown": cable(0.3, "push"),
  "lat-pulldown": machine(0.7, "pull"),
  "barbell-row": barbell(0.65, "pull"),
  "one-arm-row": dumbbell(0.3, "pull"),
  "seated-cable-row": cable(0.65, "pull"),
  "face-pull": cable(0.25, "pull"),
  "dumbbell-curl": dumbbell(0.15, "pull"),
  deadlift: barbell(1.1, "legs"),
  squat: barbell(0.9, "legs"),
  "goblet-squat": dumbbell(0.3, "legs"),
  "leg-press": machine(1.5, "legs"),
  "leg-curl": machine(0.45, "legs"),
  "leg-extension": machine(0.5, "legs"),
  "romanian-deadlift": barbell(0.8, "legs"),
  "hip-thrust": barbell(1, "legs"),
};

/** Relative strength to an intermediate man, per sex and body half. */
const SEX: Record<string, { upper: number; lower: number }> = {
  male: { upper: 1, lower: 1 },
  female: { upper: 0.55, lower: 0.7 },
  // Unknown or diverse: between the two, nearer the lighter side.
  other: { upper: 0.65, lower: 0.78 },
};
const DEFAULT_BODY_WEIGHT: Record<string, number> = {
  male: 80,
  female: 65,
  other: 72,
};
const EXPERIENCE = { beginner: 0.6, intermediate: 1, advanced: 1.25 } as const;
const LEVEL: Record<StartLoadLevel, number> = {
  lighter: 0.85,
  normal: 1,
  heavier: 1.1,
};
/** The light side: estimates from answers, and from a named weight. */
const CAUTION = 0.9;
const CAUTION_KNOWN = 0.95;
/** The repetitions an older bare number stands for ("8–10"). */
const LEGACY_KNOWN_REPS = 9;

/** Weight for `reps` relative to the weight for 10 (Epley). */
const repFactor = (reps: number) => (1 + 10 / 30) / (1 + reps / 30);

const ageFactor = (age: number | null | undefined) =>
  age == null ? 1 : age >= 70 ? 0.7 : age >= 60 ? 0.8 : age >= 50 ? 0.9 : 1;

const round = (row: Row, kg: number) =>
  Math.max(row.min, Math.round(kg / row.step) * row.step);

/** A usable named weight, or null: invalid figures count as not named. */
function knownFigure(
  value: KnownLoad | undefined,
): { kg: number; reps: number } | null {
  if (value === undefined) return null;
  const figure =
    typeof value === "number" ? { kg: value, reps: LEGACY_KNOWN_REPS } : value;
  if (!Number.isFinite(figure.kg) || figure.kg <= 0) return null;
  if (
    !Number.isInteger(figure.reps) ||
    figure.reps < KNOWN_REPS_MIN ||
    figure.reps > KNOWN_REPS_MAX
  )
    return null;
  return figure;
}

/**
 * The named anchor an exercise follows: the exercise itself when it is a
 * named anchor, else the first named anchor of its group.
 */
function knownAnchor(
  exerciseId: string,
  group: Group,
  known: KnownLoads | undefined,
): { anchor: AnchorLift; kg: number; reps: number } | null {
  if (!known) return null;
  const order = ANCHORS[group];
  const own = order.find((anchor) => anchor === exerciseId);
  for (const anchor of own ? [own, ...order] : order) {
    const figure = knownFigure(known[anchor]);
    if (figure) return { anchor, ...figure };
  }
  return null;
}

/** True when Arnold can estimate a start weight for this exercise. */
export function canEstimateStartLoad(exerciseId: string): boolean {
  return exerciseId in TABLE;
}

/** The start weight in the exercise's load basis, or null when unknown. */
export function estimateStartLoad(input: StartLoadInput): number | null {
  const row = TABLE[input.exercise_id];
  if (!row) return null;
  const reps = Math.min(30, Math.max(1, input.reps ?? 10));
  const level = LEVEL[input.level ?? "normal"];

  const known = knownAnchor(input.exercise_id, row.group, input.known);
  if (known) {
    // The user's own figure at their own repetitions, as the weight for 10,
    // carried over by the table's proportions.
    const at10 = known.kg / repFactor(known.reps);
    const kg =
      at10 *
      (row.ratio / TABLE[known.anchor].ratio) *
      repFactor(reps) *
      CAUTION_KNOWN *
      level;
    return round(row, kg);
  }

  const sex =
    input.sex === "male" || input.sex === "female" ? input.sex : "other";
  const bodyWeight =
    input.body_weight_kg && input.body_weight_kg > 0
      ? input.body_weight_kg
      : DEFAULT_BODY_WEIGHT[sex];
  // 80 kg is the table's reference; strength scales with mass^(2/3).
  const reference = 80 * Math.pow(bodyWeight / 80, 2 / 3);
  const half = row.group === "legs" ? "lower" : "upper";
  const kg =
    reference *
    row.ratio *
    SEX[sex][half] *
    EXPERIENCE[input.experience ?? "beginner"] *
    ageFactor(input.age_years) *
    repFactor(reps) *
    CAUTION *
    level;
  return round(row, kg);
}
