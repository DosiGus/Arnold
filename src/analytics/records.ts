import type { PreparedInput } from "./eligibility.js";
import type { SetLoadAnalysis } from "./load.js";
import {
  addFinite,
  compareTuple,
  freezeReasons,
  round,
  safeCount,
  tupleKey,
} from "./validation.js";
import type {
  AnalyticsReason,
  Comparability,
  LoadReference,
  PersonalRecord,
  VolumeChannel,
} from "./types.js";

type Metric = PersonalRecord["metric"];

type Candidate = Readonly<{
  group: string;
  exercise_id: string;
  comparability: Comparability;
  load_reference: LoadReference;
  channel: VolumeChannel | null;
  value: number;
  at_load_kg: number | null;
  reps: number | null;
  achieved_on: string;
  workout_id: string;
  set_id: string | null;
  reasons: readonly AnalyticsReason[];
}>;

/**
 * Walks candidates in chronological order and keeps the best value per group.
 *
 * A record is only announced when a previous reference value was actually
 * beaten: the first valid value is reported as `initial`, a strictly higher one
 * as `improvement`. Repeating an existing record is not a new record; the
 * earliest occurrence keeps the date and the occurrence counter grows. Equal
 * values on the same calendar date are therefore resolved by the stable set
 * order (workout start, exercise order, set number, set id).
 */
function walk(
  metric: Metric,
  unit: PersonalRecord["unit"],
  candidates: readonly Candidate[],
) {
  const best = new Map<
    string,
    { record: PersonalRecord; occurrences: number }
  >();
  const events: PersonalRecord[] = [];
  for (const candidate of candidates) {
    const current = best.get(candidate.group);
    if (current && candidate.value <= current.record.value) {
      if (candidate.value === current.record.value) current.occurrences += 1;
      continue;
    }
    const previous = current?.record.value ?? null;
    const record: PersonalRecord = Object.freeze({
      metric,
      exercise_id: candidate.exercise_id,
      comparability: candidate.comparability,
      load_reference: candidate.load_reference,
      channel: candidate.channel,
      value: candidate.value,
      unit,
      at_load_kg: candidate.at_load_kg,
      reps: candidate.reps,
      achieved_on: candidate.achieved_on,
      workout_id: candidate.workout_id,
      set_id: candidate.set_id,
      previous_value: previous,
      improvement: previous === null ? null : round(candidate.value - previous),
      kind: previous === null ? "initial" : "improvement",
      occurrences: 1,
      status: "valid",
      reasons: candidate.reasons,
    });
    best.set(candidate.group, { record, occurrences: 1 });
    events.push(record);
  }
  const records = [...best.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, entry]) =>
      Object.freeze({ ...entry.record, occurrences: entry.occurrences }),
    );
  return { records: Object.freeze(records), events };
}

function workingCandidates(analyses: readonly SetLoadAnalysis[]) {
  return analyses.filter((analysis) => analysis.bucket === "working");
}

/**
 * Only a completed session can set a record. A cancelled or still running
 * workout stays out even when a `workout_statuses` filter selected it, because
 * a record is a claim about work that was actually finished.
 */
function completedAnalyses(input: PreparedInput): readonly SetLoadAnalysis[] {
  return input.completedWorkouts.flatMap((workout) => [...workout.analyses]);
}

/**
 * Personal records over the analysed selection. With a date filter the previous
 * reference values are taken from that window only; an all-time record needs an
 * unfiltered call.
 */
export function computeRecords(input: PreparedInput) {
  const working = workingCandidates(completedAnalyses(input));

  const maxLoad = walk(
    "max_load",
    "kg",
    working.flatMap((analysis) =>
      analysis.comparable_load_kg === null
        ? []
        : [
            {
              group: analysis.comparability.key,
              exercise_id: analysis.set.exercise_id,
              comparability: analysis.comparability,
              load_reference: analysis.load_reference,
              channel: analysis.channel,
              value: analysis.comparable_load_kg,
              at_load_kg: analysis.comparable_load_kg,
              reps: safeCount(analysis.one_rm_reps ?? analysis.total_reps),
              achieved_on: analysis.date,
              workout_id: analysis.set.workout_id,
              set_id: analysis.set.set_id,
              reasons: freezeReasons(
                analysis.load_reference === "per_implement"
                  ? ["value_is_per_implement"]
                  : analysis.load_reference === "machine_display"
                    ? [
                        "value_is_machine_specific",
                        "machine_load_not_free_weight_comparable",
                      ]
                    : [],
              ),
            } satisfies Candidate,
          ],
    ),
  );

  // A repetition record is only meaningful at a fixed, comparable load, and only
  // when the repetitions per limb are unambiguous.
  const maxReps = walk(
    "max_reps_at_load",
    "reps",
    working.flatMap((analysis) =>
      analysis.comparable_load_kg === null ||
      safeCount(analysis.one_rm_reps) === null ||
      analysis.one_rm_reps! < 1
        ? []
        : [
            {
              group: tupleKey([
                analysis.comparability.key,
                analysis.comparable_load_kg,
              ]),
              exercise_id: analysis.set.exercise_id,
              comparability: analysis.comparability,
              load_reference: analysis.load_reference,
              channel: analysis.channel,
              value: analysis.one_rm_reps!,
              at_load_kg: analysis.comparable_load_kg,
              reps: safeCount(analysis.one_rm_reps),
              achieved_on: analysis.date,
              workout_id: analysis.set.workout_id,
              set_id: analysis.set.set_id,
              reasons: freezeReasons([]),
            } satisfies Candidate,
          ],
    ),
  );

  const oneRm = walk(
    "estimated_1rm",
    "kg",
    working.flatMap((analysis) =>
      analysis.one_rm_kg === null || analysis.one_rm_status !== "valid"
        ? []
        : [
            {
              group: analysis.comparability.key,
              exercise_id: analysis.set.exercise_id,
              comparability: analysis.comparability,
              load_reference: analysis.load_reference,
              channel: analysis.channel,
              value: analysis.one_rm_kg,
              at_load_kg: analysis.comparable_load_kg,
              reps: safeCount(analysis.one_rm_reps),
              achieved_on: analysis.date,
              workout_id: analysis.set.workout_id,
              set_id: analysis.set.set_id,
              reasons: analysis.one_rm_reasons,
            } satisfies Candidate,
          ],
    ),
  );

  // Volume per session, grouped by the same comparability key as every other
  // record: a unilateral right-side volume must never count as an improvement
  // over a bilateral one. Warm-up sets stay out.
  const volumeCandidates: Candidate[] = [];
  for (const workout of input.completedWorkouts) {
    const sums = new Map<
      string,
      {
        value: number | null;
        comparability: Comparability;
        load_reference: LoadReference;
        channel: VolumeChannel;
      }
    >();
    for (const analysis of workout.analyses) {
      if (
        analysis.bucket === "warmup" ||
        analysis.channel === null ||
        analysis.nominal_volume_kg === null
      )
        continue;
      const key = analysis.comparability.key;
      const entry = sums.get(key);
      if (!entry)
        sums.set(key, {
          value: analysis.nominal_volume_kg,
          comparability: analysis.comparability,
          load_reference: analysis.load_reference,
          channel: analysis.channel,
        });
      else if (entry.value !== null)
        // A session total that overflows is not reportable as a record.
        entry.value = addFinite(entry.value, analysis.nominal_volume_kg);
    }
    for (const [group, entry] of [...sums].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      if (entry.value === null) continue;
      volumeCandidates.push({
        group,
        exercise_id: entry.comparability.exercise_id,
        comparability: entry.comparability,
        load_reference: entry.load_reference,
        channel: entry.channel,
        value: entry.value,
        at_load_kg: null,
        reps: null,
        achieved_on: workout.date,
        workout_id: workout.workout.workout_id,
        set_id: null,
        reasons: freezeReasons(
          entry.channel === "machine_display"
            ? ["machine_load_not_free_weight_comparable"]
            : entry.channel === "added_external"
              ? ["added_load_total_unavailable"]
              : entry.load_reference === "per_implement"
                ? ["value_is_per_implement"]
                : [],
        ),
      });
    }
  }
  const volume = walk("exercise_workout_volume", "kg", volumeCandidates);

  const reasons: AnalyticsReason[] = [];
  if (!input.completedWorkouts.length) reasons.push("no_eligible_workouts");
  else if (!working.length) reasons.push("no_eligible_sets");
  else if (
    !maxLoad.records.length &&
    !oneRm.records.length &&
    !volume.records.length
  )
    reasons.push("no_computable_sets");

  return Object.freeze({
    status: reasons.length ? ("not_available" as const) : ("valid" as const),
    reasons: freezeReasons(reasons),
    max_load: maxLoad.records,
    max_reps_at_load: maxReps.records,
    estimated_1rm: oneRm.records,
    exercise_workout_volume: volume.records,
    events_in_period: Object.freeze(
      [
        ...maxLoad.events,
        ...maxReps.events,
        ...oneRm.events,
        ...volume.events,
      ].sort((a, b) =>
        `${a.achieved_on}|${a.metric}|${a.exercise_id}` <
        `${b.achieved_on}|${b.metric}|${b.exercise_id}`
          ? -1
          : 1,
      ),
    ),
  });
}
