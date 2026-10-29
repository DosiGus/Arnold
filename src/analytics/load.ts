import type { ArnoldSet } from "../shared/arnold-schema-v1.js";
import { round, tupleKey } from "./validation.js";
import type {
  AnalyticsReason,
  Comparability,
  LoadReference,
  MetricStatus,
  SetBucket,
  VolumeChannel,
} from "./types.js";

/** Epley is only applied inside this repetition range; see docs/ARCHITECTURE.md. */
export const EPLEY_MIN_REPS = 1;
export const EPLEY_MAX_REPS = 10;

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? round(value) : null;
}

/**
 * `working` carries the strength metrics. Drop, failure and other sets are real
 * work and count towards volume, but they are not comparable attempts, so they
 * never set a personal record or a one-rep-max estimate.
 */
export function setBucket(setType: ArnoldSet["set_type"]): SetBucket {
  if (setType === "warmup") return "warmup";
  if (setType === "working") return "working";
  return "supplemental";
}

/**
 * Records may only be compared inside one comparability key. `side` is part of
 * the key for unilateral work, where left and right are different limbs; for the
 * other execution modes `side` carries no extra information.
 */
export function comparabilityOf(set: ArnoldSet): Comparability {
  const side = set.execution_mode === "unilateral" ? set.side : null;
  return Object.freeze({
    key: tupleKey([
      set.exercise_id,
      set.load_basis,
      set.execution_mode,
      set.implement_count,
      side,
    ]),
    exercise_id: set.exercise_id,
    load_basis: set.load_basis,
    execution_mode: set.execution_mode,
    implement_count: set.implement_count,
    side,
  });
}

const LOAD_REFERENCE: Record<ArnoldSet["load_basis"], LoadReference> = {
  total: "total",
  per_implement: "per_implement",
  machine_display: "machine_display",
  added: "added_external",
  assistance: "assistance",
  bodyweight_only: "bodyweight",
};

export type SetLoadAnalysis = Readonly<{
  set: ArnoldSet;
  date: string;
  bucket: SetBucket;
  comparability: Comparability;
  load_reference: LoadReference;
  channel: VolumeChannel | null;
  /** Limbs trained inside this single set record: 1 unilateral, 2 alternating. */
  sides_trained: number | null;
  /** Implements moved per repetition; an alternating set moves one at a time. */
  implements_per_rep: number | null;
  total_reps: number | null;
  load_per_rep_kg: number | null;
  nominal_volume_kg: number | null;
  volume_status: MetricStatus;
  volume_reasons: readonly AnalyticsReason[];
  /** Documented load for a max-load record, inside its comparability key. */
  comparable_load_kg: number | null;
  /** Repetitions per limb, the input Epley actually needs. */
  one_rm_reps: number | null;
  one_rm_kg: number | null;
  one_rm_status: MetricStatus;
  one_rm_reasons: readonly AnalyticsReason[];
}>;

/**
 * Turns one raw set into every load figure the engine derives from it.
 *
 * Volume is not blindly `load × reps`: the repetition count is normalised over
 * `reps_basis` and the trained sides, and the load per repetition follows
 * `load_basis`, `implement_count` and `execution_mode`. Where the data does not
 * permit a figure, the figure stays `null` with a machine-readable reason.
 */
export function analyzeSetLoad(set: ArnoldSet, date: string): SetLoadAnalysis {
  const bucket = setBucket(set.set_type);
  const volumeReasons: AnalyticsReason[] = [];
  const oneRmReasons: AnalyticsReason[] = [];
  const base = {
    set,
    date,
    bucket,
    comparability: comparabilityOf(set),
    load_reference: LOAD_REFERENCE[set.load_basis],
  };

  // An alternating set moves a single implement per repetition, which is why a
  // pair of 12 kg dumbbells curled alternately counts 12 kg per repetition.
  const implementsPerRep =
    set.execution_mode === "alternating" ? 1 : set.implement_count;
  const sides =
    set.execution_mode === "alternating"
      ? 2
      : set.execution_mode === "unilateral"
        ? 1
        : 1;

  // `per_side` repetitions on a simultaneous bilateral movement contradict each
  // other. Guessing a side count here would silently double or halve volume.
  if (
    set.reps_basis === "per_side" &&
    set.execution_mode === "bilateral_simultaneous"
  )
    return Object.freeze({
      ...base,
      channel: null,
      sides_trained: null,
      implements_per_rep: null,
      total_reps: null,
      load_per_rep_kg: null,
      nominal_volume_kg: null,
      volume_status: "invalid" as MetricStatus,
      volume_reasons: Object.freeze([
        "reps_basis_ambiguous_for_execution_mode" as AnalyticsReason,
      ]),
      comparable_load_kg: null,
      one_rm_reps: null,
      one_rm_kg: null,
      one_rm_status: "invalid" as MetricStatus,
      one_rm_reasons: Object.freeze([
        "reps_basis_ambiguous_for_execution_mode" as AnalyticsReason,
      ]),
    });

  const totalReps = set.reps_basis === "per_side" ? set.reps * sides : set.reps;
  if (set.reps === 0) volumeReasons.push("reps_zero");

  // Volume channel and load per repetition.
  let channel: VolumeChannel | null = null;
  let loadPerRep: number | null = null;
  let volumeStatus: MetricStatus = "valid";
  if (set.load_basis === "bodyweight_only") {
    volumeStatus = "not_available";
    volumeReasons.push("bodyweight_total_load_unavailable");
  } else if (set.load_basis === "assistance") {
    volumeStatus = "not_available";
    volumeReasons.push("assistance_load_not_volume_comparable");
  } else if (set.load_kg === null) {
    volumeStatus = "not_available";
    volumeReasons.push("load_missing");
  } else if (!Number.isFinite(set.load_kg)) {
    volumeStatus = "invalid";
    volumeReasons.push("load_not_finite");
  } else if (set.load_basis === "machine_display") {
    channel = "machine_display";
    loadPerRep = set.load_kg;
    volumeReasons.push("machine_load_not_free_weight_comparable");
  } else if (set.load_basis === "added") {
    channel = "added_external";
    loadPerRep = set.load_kg;
    volumeStatus = "partial";
    volumeReasons.push("added_load_total_unavailable");
  } else {
    channel = "free_weight";
    loadPerRep =
      set.load_basis === "per_implement"
        ? set.load_kg * implementsPerRep
        : set.load_kg;
  }
  loadPerRep = loadPerRep === null ? null : finiteOrNull(loadPerRep);
  let volume =
    loadPerRep === null ? null : finiteOrNull(loadPerRep * totalReps);
  if (loadPerRep === null && channel !== null) {
    channel = null;
    volumeStatus = "invalid";
    volumeReasons.push("load_not_finite");
  }
  if (volume === null && loadPerRep !== null) {
    channel = null;
    volume = null;
    volumeStatus = "invalid";
    volumeReasons.push("volume_not_finite");
  }

  // Max-load records use the documented load as recorded; the comparability key
  // already pins the load basis and the implement count, so nothing is scaled.
  const comparableLoad =
    set.load_basis === "bodyweight_only" || set.load_basis === "assistance"
      ? null
      : set.load_kg !== null && Number.isFinite(set.load_kg)
        ? round(set.load_kg)
        : null;

  // Epley needs the repetitions one limb actually performed in sequence.
  let oneRmReps: number | null = null;
  if (set.execution_mode === "alternating" && set.reps_basis === "total")
    oneRmReasons.push("reps_per_side_ambiguous");
  else oneRmReps = set.reps;

  let oneRm: number | null = null;
  let oneRmStatus: MetricStatus = "valid";
  if (bucket !== "working") {
    oneRmStatus = "not_available";
    oneRmReasons.push("set_type_not_working");
  } else if (set.load_basis === "bodyweight_only") {
    oneRmStatus = "not_available";
    oneRmReasons.push("bodyweight_total_load_unavailable");
  } else if (set.load_basis === "added" || set.load_basis === "assistance") {
    oneRmStatus = "not_available";
    oneRmReasons.push("load_basis_not_one_rm_comparable");
  } else if (
    set.load_kg === null ||
    !Number.isFinite(set.load_kg) ||
    set.load_kg <= 0
  ) {
    oneRmStatus = "not_available";
    oneRmReasons.push("load_not_positive");
  } else if (oneRmReps === null) {
    oneRmStatus = "not_available";
  } else if (oneRmReps < EPLEY_MIN_REPS || oneRmReps > EPLEY_MAX_REPS) {
    oneRmStatus = "not_available";
    oneRmReasons.push("reps_out_of_epley_range");
  } else {
    oneRm = finiteOrNull(
      oneRmReps === 1 ? set.load_kg : set.load_kg * (1 + oneRmReps / 30),
    );
    if (oneRm === null) {
      oneRmStatus = "invalid";
      oneRmReasons.push("load_not_finite");
    } else if (set.load_basis === "per_implement")
      oneRmReasons.push("value_is_per_implement");
    else if (set.load_basis === "machine_display")
      oneRmReasons.push("value_is_machine_specific");
  }

  return Object.freeze({
    ...base,
    channel,
    sides_trained: sides,
    implements_per_rep: implementsPerRep,
    total_reps: totalReps,
    load_per_rep_kg: loadPerRep,
    nominal_volume_kg: volume,
    volume_status: volumeStatus,
    volume_reasons: Object.freeze(volumeReasons),
    comparable_load_kg: comparableLoad,
    one_rm_reps: oneRmReps,
    one_rm_kg: oneRm,
    one_rm_status: oneRmStatus,
    one_rm_reasons: Object.freeze(oneRmReasons),
  });
}
