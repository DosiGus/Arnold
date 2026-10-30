/**
 * The starter exercise catalog.
 *
 * One list, two jobs. The onboarding shows it as the "which exercises do you
 * like?" picker, and a new tracker is seeded with it, so every exercise a user
 * can pick also exists as a valid `exercise_id` when the plan is built.
 *
 * Deliberately small: the basic lifts a trainer would offer per muscle group,
 * not an encyclopaedia. Each entry says which equipment it needs, so the picker
 * only shows what the user can actually do where they train.
 */
import type {
  ArnoldExecutionMode,
  ArnoldLoadBasis,
} from "./arnold-schema-v1.js";

/** Muscle groups as the picker and the "focus" question group them. */
export const MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "arms",
  "legs",
  "glutes",
  "core",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_GROUP_LABEL: Record<MuscleGroup, string> = {
  chest: "Brust",
  back: "Rücken",
  shoulders: "Schultern",
  arms: "Arme",
  legs: "Beine",
  glutes: "Po",
  core: "Bauch",
};

/** Equipment a user can own or find outside a gym. Bodyweight is always there. */
export const EQUIPMENT = [
  "dumbbells",
  "barbell",
  "bench",
  "kettlebell",
  "pull_up_bar",
  "dip_bars",
  "resistance_bands",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  dumbbells: "Kurzhanteln",
  barbell: "Langhantel",
  bench: "Hantelbank",
  kettlebell: "Kettlebell",
  pull_up_bar: "Klimmzugstange",
  dip_bars: "Dip-Barren",
  resistance_bands: "Widerstandsbänder",
};

/** What only a gym has. Never offered as a choice, always present in a gym. */
type GymOnly = "machine" | "cable";
type Requirement = Equipment | GymOnly;

export interface StarterExercise {
  exercise_id: string;
  name_de: string;
  muscle_group: MuscleGroup;
  /** All of these are needed. Empty means bodyweight only. */
  needs: readonly Requirement[];
  /** Arnold exercise row fields, used when a tracker is seeded. */
  equipment_label: string;
  family_key: string;
  load_basis: ArnoldLoadBasis;
  execution_mode: ArnoldExecutionMode;
  implement_count: number;
}

const entry = (
  exercise_id: string,
  name_de: string,
  muscle_group: MuscleGroup,
  needs: readonly Requirement[],
  equipment_label: string,
  family_key: string,
  load_basis: ArnoldLoadBasis,
  execution_mode: ArnoldExecutionMode = "bilateral_simultaneous",
  implement_count = 1,
): StarterExercise => ({
  exercise_id,
  name_de,
  muscle_group,
  needs,
  equipment_label,
  family_key,
  load_basis,
  execution_mode,
  implement_count,
});

/**
 * The list. Ids are storage keys and must never be renamed: plans and logged
 * sets refer to them. The first nine predate this file and keep their ids.
 */
export const STARTER_EXERCISES: readonly StarterExercise[] = [
  // Brust
  entry(
    "bench-press",
    "Bankdrücken",
    "chest",
    ["barbell", "bench"],
    "Langhantel",
    "press",
    "total",
  ),
  entry(
    "dumbbell-bench-press",
    "Kurzhantel-Bankdrücken",
    "chest",
    ["dumbbells", "bench"],
    "Kurzhantel",
    "press",
    "per_implement",
    "bilateral_simultaneous",
    2,
  ),
  entry(
    "incline-dumbbell-press",
    "Schrägbankdrücken mit Kurzhanteln",
    "chest",
    ["dumbbells", "bench"],
    "Kurzhantel",
    "press",
    "per_implement",
    "bilateral_simultaneous",
    2,
  ),
  entry(
    "chest-press-machine",
    "Brustpresse",
    "chest",
    ["machine"],
    "Maschine",
    "press",
    "machine_display",
  ),
  entry(
    "push-up",
    "Liegestütze",
    "chest",
    [],
    "Körpergewicht",
    "press",
    "bodyweight_only",
  ),
  // Rücken
  entry(
    "pull-up",
    "Klimmzüge",
    "back",
    ["pull_up_bar"],
    "Körpergewicht",
    "pull",
    "bodyweight_only",
  ),
  entry(
    "lat-pulldown",
    "Latzug",
    "back",
    ["machine"],
    "Maschine",
    "pull",
    "machine_display",
  ),
  entry(
    "barbell-row",
    "Langhantelrudern",
    "back",
    ["barbell"],
    "Langhantel",
    "row",
    "total",
  ),
  entry(
    "one-arm-row",
    "Rudern einarmig",
    "back",
    ["dumbbells"],
    "Kurzhantel",
    "row",
    "per_implement",
    "unilateral",
  ),
  entry(
    "seated-cable-row",
    "Rudern am Kabelzug",
    "back",
    ["cable"],
    "Kabelzug",
    "row",
    "machine_display",
  ),
  entry(
    "band-row",
    "Rudern mit Band",
    "back",
    ["resistance_bands"],
    "Widerstandsband",
    "row",
    "bodyweight_only",
  ),
  entry(
    "deadlift",
    "Kreuzheben",
    "back",
    ["barbell"],
    "Langhantel",
    "hinge",
    "total",
  ),
  // Schultern
  entry(
    "overhead-press",
    "Schulterdrücken mit Langhantel",
    "shoulders",
    ["barbell"],
    "Langhantel",
    "press",
    "total",
  ),
  entry(
    "dumbbell-shoulder-press",
    "Schulterdrücken mit Kurzhanteln",
    "shoulders",
    ["dumbbells"],
    "Kurzhantel",
    "press",
    "per_implement",
    "bilateral_simultaneous",
    2,
  ),
  entry(
    "lateral-raise",
    "Seitheben",
    "shoulders",
    ["dumbbells"],
    "Kurzhantel",
    "raise",
    "per_implement",
    "bilateral_simultaneous",
    2,
  ),
  entry(
    "face-pull",
    "Face Pulls",
    "shoulders",
    ["cable"],
    "Kabelzug",
    "pull",
    "machine_display",
  ),
  // Arme
  entry(
    "dumbbell-curl",
    "Bizepscurls mit Kurzhanteln",
    "arms",
    ["dumbbells"],
    "Kurzhantel",
    "curl",
    "per_implement",
    "bilateral_simultaneous",
    2,
  ),
  entry(
    "triceps-pushdown",
    "Trizepsdrücken am Kabel",
    "arms",
    ["cable"],
    "Kabelzug",
    "extension",
    "machine_display",
  ),
  entry(
    "dips",
    "Dips",
    "arms",
    ["dip_bars"],
    "Körpergewicht",
    "press",
    "bodyweight_only",
  ),
  // Beine
  entry(
    "squat",
    "Kniebeugen",
    "legs",
    ["barbell"],
    "Langhantel",
    "squat",
    "total",
  ),
  entry(
    "goblet-squat",
    "Goblet Squats",
    "legs",
    ["dumbbells"],
    "Kurzhantel",
    "squat",
    "total",
  ),
  entry(
    "leg-press",
    "Beinpresse",
    "legs",
    ["machine"],
    "Maschine",
    "press",
    "machine_display",
  ),
  entry(
    "lunge",
    "Ausfallschritte",
    "legs",
    [],
    "Körpergewicht",
    "lunge",
    "bodyweight_only",
    "alternating",
  ),
  entry(
    "leg-curl",
    "Beinbeuger",
    "legs",
    ["machine"],
    "Maschine",
    "curl",
    "machine_display",
  ),
  entry(
    "leg-extension",
    "Beinstrecker",
    "legs",
    ["machine"],
    "Maschine",
    "extension",
    "machine_display",
  ),
  entry(
    "calf-raise",
    "Wadenheben",
    "legs",
    [],
    "Körpergewicht",
    "raise",
    "bodyweight_only",
  ),
  // Po
  entry(
    "romanian-deadlift",
    "Rumänisches Kreuzheben",
    "glutes",
    ["barbell"],
    "Langhantel",
    "hinge",
    "total",
  ),
  entry(
    "hip-thrust",
    "Hip Thrust",
    "glutes",
    ["barbell", "bench"],
    "Langhantel",
    "hinge",
    "total",
  ),
  entry(
    "glute-bridge",
    "Glute Bridge",
    "glutes",
    [],
    "Körpergewicht",
    "hinge",
    "bodyweight_only",
  ),
  // Bauch
  entry(
    "crunch",
    "Crunches",
    "core",
    [],
    "Körpergewicht",
    "flexion",
    "bodyweight_only",
  ),
  entry(
    "hanging-leg-raise",
    "Beinheben hängend",
    "core",
    ["pull_up_bar"],
    "Körpergewicht",
    "flexion",
    "bodyweight_only",
  ),
];

export const STARTER_EXERCISE_IDS = STARTER_EXERCISES.map(
  (exercise) => exercise.exercise_id,
) as [string, ...string[]];

const BY_ID = new Map(STARTER_EXERCISES.map((e) => [e.exercise_id, e]));
export const starterExercise = (id: string) => BY_ID.get(id);

/** Where someone trains. `outdoor` means a park: bars, bodyweight, own bands. */
export type TrainingPlace = "gym" | "home" | "outdoor" | "mixed";

/**
 * What is available at a place.
 *
 * A gym has everything. At home and outdoors only what the user said they own,
 * plus the bars a calisthenics park always has. "Mixed" offers the gym's range:
 * the brief then asks for exercises that also work at home.
 */
function available(
  place: TrainingPlace,
  owned: readonly Equipment[],
): ReadonlySet<Requirement> {
  if (place === "gym" || place === "mixed")
    return new Set<Requirement>([...EQUIPMENT, "machine", "cable"]);
  if (place === "outdoor")
    return new Set<Requirement>([...owned, "pull_up_bar", "dip_bars"]);
  return new Set<Requirement>(owned);
}

/** The exercises a user can do where they train, in catalog order. */
export function exercisesFor(
  place: TrainingPlace | null,
  owned: readonly Equipment[] = [],
): StarterExercise[] {
  if (place === null) return [...STARTER_EXERCISES];
  const have = available(place, owned);
  return STARTER_EXERCISES.filter((exercise) =>
    exercise.needs.every((need) => have.has(need)),
  );
}
