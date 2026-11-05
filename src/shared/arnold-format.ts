/**
 * The single place where Arnold's internal load and execution vocabulary becomes
 * German user-facing text.
 *
 * No component may re-interpret `load_basis`, `execution_mode`, `reps_basis` or
 * `side` on its own: a second interpretation is how "60 kg pro Hantel" silently
 * turns into "60 kg total". Everything here is pure string formatting over the
 * values as stored; nothing is converted, summed or normalised, so a
 * displayed number is always the number the user entered.
 */
import type {
  ArnoldExecutionMode,
  ArnoldLoadBasis,
  ArnoldRepsBasis,
  ArnoldSide,
} from "./arnold-schema-v1.js";

/** Label for the load convention a number follows. */
export const LOAD_BASIS_LABEL: Record<ArnoldLoadBasis, string> = {
  total: "Gesamtgewicht",
  per_implement: "kg pro Hantel",
  machine_display: "Maschinenanzeige",
  added: "Zusatzgewicht",
  assistance: "Unterstützung",
  bodyweight_only: "Körpergewicht",
};

/** Short suffix appended directly after a weight, kept as compact as possible. */
const LOAD_BASIS_SUFFIX: Record<ArnoldLoadBasis, string> = {
  total: "",
  per_implement: "pro Hantel",
  machine_display: "Maschinenanzeige",
  added: "Zusatzgewicht",
  assistance: "Unterstützung",
  bodyweight_only: "",
};

export const EXECUTION_MODE_LABEL: Record<ArnoldExecutionMode, string> = {
  bilateral_simultaneous: "Beidseitig",
  unilateral: "Einseitig",
  alternating: "Abwechselnd",
};

export const SIDE_LABEL: Record<ArnoldSide, string> = {
  both: "Beidseitig",
  left: "Links",
  right: "Rechts",
  alternating: "Abwechselnd",
};

export const WORKOUT_STATUS_LABEL = {
  planned: "Geplant",
  in_progress: "Läuft",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
  voided: "Verworfen",
} as const;

/** German decimal formatting; `maximumFractionDigits` only, so 70 stays "70". */
export function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: digits,
  }).format(value);
}

/** The placeholder for every unknown value. Never substitute a 0 for it. */
export const UNKNOWN = "–";

export type LoadDescriptor = {
  readonly load_kg: number | null;
  readonly load_basis: ArnoldLoadBasis;
  readonly execution_mode?: ArnoldExecutionMode;
  readonly implement_count?: number;
  readonly side?: ArnoldSide;
};

/**
 * The weight of one set as text, carrying its own load convention.
 *
 * `bodyweight_only` has no number to show, so it is named rather than printed as
 * "0 kg"; `assistance` keeps its minus sign meaning ("Unterstützung") in words
 * instead of as arithmetic. A missing load stays unknown.
 */
export function formatLoad(set: LoadDescriptor): string {
  if (set.load_basis === "bodyweight_only") return "Körpergewicht";
  if (set.load_kg === null || !Number.isFinite(set.load_kg))
    return `${UNKNOWN} kg`;
  const suffix = LOAD_BASIS_SUFFIX[set.load_basis];
  const weight = `${formatNumber(set.load_kg, 2)} kg`;
  return suffix ? `${weight} ${suffix}` : weight;
}

/**
 * Reps as text, keeping `per_side` visible: "10 pro Seite" is not "10".
 */
export function formatReps(
  reps: number,
  reps_basis: ArnoldRepsBasis = "total",
): string {
  return reps_basis === "per_side"
    ? `${formatNumber(reps, 0)} pro Seite`
    : formatNumber(reps, 0);
}

/**
 * One set as a single line: "70 kg × 8" or "20 kg pro Hantel × 10 pro Seite".
 */
export function formatSetLine(
  set: LoadDescriptor & {
    readonly reps: number;
    readonly reps_basis?: ArnoldRepsBasis;
  },
): string {
  return `${formatLoad(set)} × ${formatReps(set.reps, set.reps_basis ?? "total")}`;
}
