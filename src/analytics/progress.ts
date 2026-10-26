import type { PreparedInput } from "./eligibility.js";
import type { SetLoadAnalysis } from "./load.js";
import { compareDate } from "./period.js";
import {
  coveredSum,
  exact,
  freezeReasons,
  metric,
  round,
  unavailable,
} from "./validation.js";
import type {
  AnalyticsReason,
  Comparability,
  ExerciseProgress,
  LoadReference,
  MetricUnit,
  Series,
} from "./types.js";

type Aggregation = Series["aggregation"];

/**
 * Collapses several workouts on one calendar date into a single chart point.
 * The rule is part of the metric definition, so a second session on the same day
 * can never silently overwrite the first one.
 */
function series(
  exercise_id: string,
  name: string,
  unit: MetricUnit,
  aggregation: Aggregation,
  load_reference: LoadReference | null,
  samples: readonly { date: string; value: number }[],
  excluded: readonly AnalyticsReason[] = [],
): Series {
  const byDate = new Map<string, number[]>();
  for (const sample of samples) {
    const bucket = byDate.get(sample.date);
    if (bucket) bucket.push(sample.value);
    else byDate.set(sample.date, [sample.value]);
  }
  const points = [...byDate.entries()]
    .sort(([a], [b]) => compareDate(a, b))
    .flatMap(([date, values]) => {
      const value =
        aggregation === "max"
          ? Math.max(...values)
          : aggregation === "sum"
            ? values.reduce((total, entry) => total + entry, 0)
            : aggregation === "mean"
              ? values.reduce((total, entry) => total + entry, 0) /
                values.length
              : values[values.length - 1];
      return Number.isFinite(value)
        ? [Object.freeze({ date, value: round(value) })]
        : [];
    });
  // A chart must not look complete when contributions were left out: the
  // series carries the same status and reasons as the matching aggregate.
  const reasons = freezeReasons(
    points.length ? excluded : [...excluded, "no_computable_sets"],
  );
  return Object.freeze({
    exercise_id,
    metric: name,
    unit,
    load_reference,
    aggregation,
    status: !points.length
      ? ("not_available" as const)
      : excluded.length
        ? ("partial" as const)
        : ("valid" as const),
    reasons,
    points: Object.freeze(points),
  });
}

/** Reasons of the contributions a series had to drop. */
function droppedReasons(
  analyses: readonly SetLoadAnalysis[],
  usable: (analysis: SetLoadAnalysis) => boolean,
  of: (analysis: SetLoadAnalysis) => readonly AnalyticsReason[],
): readonly AnalyticsReason[] {
  return freezeReasons(
    analyses.flatMap((analysis) => (usable(analysis) ? [] : [...of(analysis)])),
  );
}

type Variant = {
  comparability: Comparability;
  load_reference: LoadReference;
  analyses: SetLoadAnalysis[];
};

/**
 * The variant with the most working sets represents the exercise in the headline
 * figures and in the load charts. Comparing a dumbbell load per implement with a
 * barbell total would be meaningless, so the other variants stay in `variants`.
 */
function dominant(variants: readonly Variant[]): Variant | null {
  return (
    [...variants].sort((a, b) => {
      if (a.analyses.length !== b.analyses.length)
        return b.analyses.length - a.analyses.length;
      const maxOf = (variant: Variant) =>
        Math.max(
          ...variant.analyses.map(
            (analysis) => analysis.comparable_load_kg ?? 0,
          ),
          0,
        );
      if (maxOf(a) !== maxOf(b)) return maxOf(b) - maxOf(a);
      return a.comparability.key < b.comparability.key ? -1 : 1;
    })[0] ?? null
  );
}

function progressFor(
  exercise_id: string,
  input: PreparedInput,
  analyses: readonly SetLoadAnalysis[],
  includeSeries: boolean,
): ExerciseProgress {
  const exercise = input.exercisesById.get(exercise_id);
  const working = analyses.filter((analysis) => analysis.bucket === "working");
  const warmup = analyses.filter((analysis) => analysis.bucket === "warmup");
  const dates = [...new Set(analyses.map((analysis) => analysis.date))].sort(
    compareDate,
  );
  const variantMap = new Map<string, Variant>();
  for (const analysis of working) {
    const entry = variantMap.get(analysis.comparability.key);
    if (entry) entry.analyses.push(analysis);
    else
      variantMap.set(analysis.comparability.key, {
        comparability: analysis.comparability,
        load_reference: analysis.load_reference,
        analyses: [analysis],
      });
  }
  const variants = [...variantMap.values()].sort((a, b) =>
    a.comparability.key < b.comparability.key ? -1 : 1,
  );
  const lead = dominant(variants);

  const maxLoadOf = (variant: Variant) => {
    const values = variant.analyses
      .map((analysis) => analysis.comparable_load_kg)
      .filter((value): value is number => value !== null);
    return values.length ? Math.max(...values) : null;
  };
  const bestOneRmOf = (variant: Variant) => {
    const values = variant.analyses
      .filter((analysis) => analysis.one_rm_status === "valid")
      .map((analysis) => analysis.one_rm_kg)
      .filter((value): value is number => value !== null);
    return values.length ? Math.max(...values) : null;
  };

  const lastDocumented = [...working]
    .reverse()
    .find((analysis) => analysis.comparable_load_kg !== null);
  const leadMaxLoad = lead ? maxLoadOf(lead) : null;
  const leadOneRm = lead ? bestOneRmOf(lead) : null;
  const noSets: AnalyticsReason[] = analyses.length ? [] : ["no_eligible_sets"];
  const noWorking: AnalyticsReason[] = working.length
    ? []
    : analyses.length
      ? ["set_type_not_working"]
      : ["no_eligible_sets"];

  return Object.freeze({
    exercise_id,
    exercise_known: exercise !== undefined,
    name_de: exercise?.name_de ?? null,
    status: analyses.length ? ("valid" as const) : ("not_available" as const),
    reasons: freezeReasons(noSets),
    first_training_date: dates[0] ?? null,
    last_training_date: dates.at(-1) ?? null,
    workouts: exact(
      "exercise_workouts",
      new Set(analyses.map((analysis) => analysis.set.workout_id)).size,
      "workouts",
    ),
    working_sets: exact("exercise_working_sets", working.length, "sets"),
    warmup_sets: exact("exercise_warmup_sets", warmup.length, "sets"),
    last_working_load: lastDocumented
      ? exact(
          "last_working_load",
          lastDocumented.comparable_load_kg as number,
          "kg",
        )
      : unavailable("last_working_load", "kg", [
          ...noWorking,
          ...(working.length
            ? (["bodyweight_total_load_unavailable"] as const)
            : []),
        ]),
    last_working_load_reference: lastDocumented?.load_reference ?? null,
    max_comparable_load:
      leadMaxLoad === null
        ? unavailable("max_comparable_load", "kg", [
            ...noWorking,
            ...(working.length
              ? (["bodyweight_total_load_unavailable"] as const)
              : []),
          ])
        : exact("max_comparable_load", leadMaxLoad, "kg"),
    max_comparable_load_comparability:
      leadMaxLoad === null ? null : (lead?.comparability ?? null),
    best_estimated_1rm:
      leadOneRm === null
        ? unavailable("best_estimated_1rm", "kg", [
            ...noWorking,
            ...(working.length
              ? (["load_basis_not_one_rm_comparable"] as const)
              : []),
          ])
        : metric(
            "best_estimated_1rm",
            leadOneRm,
            "kg",
            "valid",
            lead?.load_reference === "per_implement"
              ? ["value_is_per_implement"]
              : lead?.load_reference === "machine_display"
                ? ["value_is_machine_specific"]
                : [],
          ),
    best_estimated_1rm_comparability:
      leadOneRm === null ? null : (lead?.comparability ?? null),
    nominal_volume: coveredSum(
      "exercise_nominal_volume",
      "kg",
      analyses.map((analysis) => analysis.nominal_volume_kg),
      analyses.flatMap((analysis) =>
        analysis.nominal_volume_kg === null ? [...analysis.volume_reasons] : [],
      ),
    ),
    variants: Object.freeze(
      variants.map((variant) =>
        Object.freeze({
          comparability: variant.comparability,
          load_reference: variant.load_reference,
          working_sets: variant.analyses.length,
          max_load:
            maxLoadOf(variant) === null
              ? unavailable("max_load", "kg", [
                  "bodyweight_total_load_unavailable",
                ])
              : exact("max_load", maxLoadOf(variant) as number, "kg"),
          best_estimated_1rm:
            bestOneRmOf(variant) === null
              ? unavailable("best_estimated_1rm", "kg", [
                  "load_basis_not_one_rm_comparable",
                ])
              : exact(
                  "best_estimated_1rm",
                  bestOneRmOf(variant) as number,
                  "kg",
                ),
        }),
      ),
    ),
    series: Object.freeze(
      includeSeries
        ? [
            series(
              exercise_id,
              "max_load",
              "kg",
              "max",
              lead?.load_reference ?? null,
              (lead?.analyses ?? []).flatMap((analysis) =>
                analysis.comparable_load_kg === null
                  ? []
                  : [
                      {
                        date: analysis.date,
                        value: analysis.comparable_load_kg,
                      },
                    ],
              ),
              droppedReasons(
                lead?.analyses ?? [],
                (analysis) => analysis.comparable_load_kg !== null,
                (analysis) => analysis.volume_reasons,
              ),
            ),
            series(
              exercise_id,
              "estimated_1rm",
              "kg",
              "max",
              lead?.load_reference ?? null,
              (lead?.analyses ?? []).flatMap((analysis) =>
                analysis.one_rm_kg === null ||
                analysis.one_rm_status !== "valid"
                  ? []
                  : [{ date: analysis.date, value: analysis.one_rm_kg }],
              ),
              // Only sets that were actually skipped explain themselves here.
              droppedReasons(
                lead?.analyses ?? [],
                (analysis) =>
                  analysis.one_rm_kg !== null &&
                  analysis.one_rm_status === "valid",
                (analysis) => analysis.one_rm_reasons,
              ),
            ),
            series(
              exercise_id,
              "nominal_volume",
              "kg",
              "sum",
              null,
              analyses.flatMap((analysis) =>
                analysis.nominal_volume_kg === null
                  ? []
                  : [
                      {
                        date: analysis.date,
                        value: analysis.nominal_volume_kg,
                      },
                    ],
              ),
              droppedReasons(
                analyses,
                (analysis) => analysis.nominal_volume_kg !== null,
                (analysis) => analysis.volume_reasons,
              ),
            ),
            series(
              exercise_id,
              "total_reps",
              "reps",
              "sum",
              null,
              working.flatMap((analysis) =>
                analysis.total_reps === null
                  ? []
                  : [{ date: analysis.date, value: analysis.total_reps }],
              ),
              droppedReasons(
                working,
                (analysis) => analysis.total_reps !== null,
                (analysis) => analysis.volume_reasons,
              ),
            ),
            series(
              exercise_id,
              "mean_reps_per_working_set",
              "reps",
              "mean",
              null,
              working.flatMap((analysis) =>
                analysis.total_reps === null
                  ? []
                  : [{ date: analysis.date, value: analysis.total_reps }],
              ),
              droppedReasons(
                working,
                (analysis) => analysis.total_reps !== null,
                (analysis) => analysis.volume_reasons,
              ),
            ),
          ]
        : [],
    ),
  });
}

/**
 * Per-exercise history. Grouping is by `exercise_id` alone, so an exercise keeps
 * one continuous history even when it moved between splits, sessions or plan
 * versions. Load comparability is handled by the variant split, not by the plan.
 */
export function computeExerciseProgress(
  input: PreparedInput,
  exerciseIds: readonly string[] | null = null,
  includeSeries = true,
): readonly ExerciseProgress[] {
  const byExercise = new Map<string, SetLoadAnalysis[]>();
  for (const id of exerciseIds ?? []) byExercise.set(id, []);
  for (const analysis of input.analyses) {
    const id = analysis.set.exercise_id;
    if (exerciseIds && !byExercise.has(id)) continue;
    const bucket = byExercise.get(id);
    if (bucket) bucket.push(analysis);
    else byExercise.set(id, [analysis]);
  }
  return Object.freeze(
    [...byExercise.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([exercise_id, analyses]) =>
        progressFor(exercise_id, input, analyses, includeSeries),
      ),
  );
}
