/**
 * The single place where Arnold's internal load and execution vocabulary becomes
 * German user-facing text.
 *
 * No component may re-interpret `load_basis`, `execution_mode`, `reps_basis` or
 * `side` on its own: a second interpretation is how "60 kg pro Hantel" silently
 * turns into "60 kg total". Everything here is pure string formatting over the
 * values stored in the sheet; nothing is converted, summed or normalised, so a
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

export const REPS_BASIS_LABEL: Record<ArnoldRepsBasis, string> = {
  total: "Wiederholungen gesamt",
  per_side: "Wiederholungen pro Seite",
};

export const SET_TYPE_LABEL = {
  warmup: "Aufwärmsatz",
  working: "Arbeitssatz",
  drop: "Drop-Satz",
  failure: "Satz bis zum Muskelversagen",
  other: "Sonstiger Satz",
} as const;

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

/** The full comparison class of a plotted load, including its relevant side. */
export function formatComparability(variant: {
  readonly execution_mode: ArnoldExecutionMode;
  readonly side: ArnoldSide | null;
  readonly implement_count: number;
  readonly load_basis: ArnoldLoadBasis;
}): string {
  const mode = EXECUTION_MODE_LABEL[variant.execution_mode];
  const side = variant.side ? SIDE_LABEL[variant.side] : null;
  return [
    mode,
    side && side !== mode ? side : null,
    variant.implement_count > 1
      ? `${variant.implement_count} ${variant.load_basis === "per_implement" ? "Hanteln" : "Geräte"}`
      : null,
    LOAD_BASIS_LABEL[variant.load_basis],
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * How a set was performed, as a short label, or `null` when it carries no
 * information beyond the plain two-sided default. Only the stored values are
 * read, so a set that deviates from its exercise's default still reports what
 * actually happened.
 */
export function formatExecution(set: {
  readonly execution_mode: ArnoldExecutionMode;
  readonly side: ArnoldSide;
  readonly implement_count?: number;
}): string | null {
  if (set.execution_mode === "bilateral_simultaneous" && set.side === "both")
    return null;
  // For a unilateral set the side is the information; the mode is implied by it.
  if (set.execution_mode === "unilateral") return SIDE_LABEL[set.side];
  return EXECUTION_MODE_LABEL[set.execution_mode];
}

/**
 * Accessible one-sentence description of a set, for screen readers and
 * `title`/`aria-label` text, where the compact line would lose its meaning.
 */
export function describeSet(set: {
  readonly load_kg: number | null;
  readonly load_basis: ArnoldLoadBasis;
  readonly reps: number;
  readonly reps_basis: ArnoldRepsBasis;
  readonly execution_mode: ArnoldExecutionMode;
  readonly side: ArnoldSide;
  readonly set_number: number;
  readonly set_type: keyof typeof SET_TYPE_LABEL;
}): string {
  const parts = [
    `${SET_TYPE_LABEL[set.set_type]} ${set.set_number}`,
    set.load_basis === "bodyweight_only"
      ? "Körpergewicht"
      : set.load_kg === null
        ? "Gewicht unbekannt"
        : `${formatNumber(set.load_kg, 2)} Kilogramm ${LOAD_BASIS_LABEL[set.load_basis]}`,
    set.reps_basis === "per_side"
      ? `${set.reps} Wiederholungen pro Seite`
      : `${set.reps} Wiederholungen`,
  ];
  const execution = formatExecution(set);
  if (execution) parts.push(execution);
  return `${parts.join(", ")}.`;
}
