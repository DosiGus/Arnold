/**
 * What the watch gets and sends for runs, as pure helpers: list entries from
 * stored prescriptions, the ETag of a prescription and the executed segments
 * of a result turned into rows. No I/O; the service reads and writes.
 */
import { createHash } from "node:crypto";
import {
  RUN_DURATION_TYPES,
  RUN_LIMITS,
  RUN_SEGMENT_KINDS,
  RUN_TARGET_TYPES,
  RunSegmentStatusSchema,
  type RunPrescription,
  type WatchRunRequest,
} from "../../shared/run-contract.js";
import type { ResultSegment } from "./result.js";
import { expandPrescription, plannedTotals } from "./views.js";

/** Short stable tag of a prescription (the ETag of `GET /runs/:id`). */
export function prescriptionTag(prescription: RunPrescription): string {
  return createHash("sha256")
    .update(JSON.stringify(prescription))
    .digest("base64url")
    .slice(0, 12);
}

/**
 * One list entry. Minutes or metres are given only when the whole run is set
 * by that measure; an open or mixed run has neither (honestly unknown).
 */
export function watchEntry(
  id: string,
  date: string | undefined,
  prescription: RunPrescription,
) {
  const totals = plannedTotals(prescription);
  return {
    id,
    ...(date ? { d: date } : {}),
    n: prescription.n,
    k: prescription.k,
    m:
      totals.total_s === null
        ? null
        : Math.min(600, Math.max(1, Math.round(totals.total_s / 60))),
    dm:
      totals.distance_m === null
        ? null
        : Math.min(RUN_LIMITS.maxMeters, totals.distance_m),
    e: prescription.e,
    tag: prescriptionTag(prescription),
  };
}

/**
 * The executed segments of a watch result as result segments. A segment is
 * matched with the prescription position of the same index only if kind and
 * repetition agree; otherwise it is kept as a lap without a target, so a run
 * is never lost because the prescription changed after it was downloaded.
 */
export function watchSegments(
  request: WatchRunRequest,
  prescription: RunPrescription | null,
  warnings: string[],
): ResultSegment[] {
  const expanded = prescription ? expandPrescription(prescription) : [];
  let mismatched = false;
  const out = request.segments.map((segment): ResultSegment => {
    const kind = RUN_SEGMENT_KINDS[segment.kind];
    const slot = expanded[segment.i];
    const matches =
      slot !== undefined &&
      RUN_SEGMENT_KINDS[slot.tuple[0]] === kind &&
      slot.repetition === segment.rep;
    if (prescription && !matches) mismatched = true;
    return {
      segment_index: segment.i,
      repetition: matches ? segment.rep : null,
      kind: matches ? kind : "lap",
      planned: matches
        ? {
            duration_type: RUN_DURATION_TYPES[slot.tuple[1]],
            duration_value: slot.tuple[2],
            target_type: RUN_TARGET_TYPES[slot.tuple[3]],
            target_low: slot.tuple[4],
            target_high: slot.tuple[5],
          }
        : null,
      timer_s: segment.t,
      distance_m: segment.dm,
      time_in_target_s: matches ? segment.tz : null,
      status: matches
        ? RunSegmentStatusSchema.options[segment.st]
        : "completed",
      hr: segment.hr ? [segment.hr[0], segment.hr[1]] : null,
    };
  });
  if (mismatched)
    warnings.push(
      "Einige Abschnitte passen nicht mehr zur Vorgabe und sind als Runden ohne Ziel gespeichert.",
    );
  return out;
}
