/**
 * Arnold's records (dashboard `home.records_by_exercise` and
 * `home.run_records`) → the records screen: the newest record of every
 * exercise, newest first, and the running records next to them.
 *
 * Mapping only: which set is a record is decided by the records engine
 * (`src/analytics/records.ts` via `src/analytics/home.ts`), the running
 * records by `src/analytics/run-records.ts`. Nothing here is computed; the
 * card only picks, sorts by date and formats.
 */
import type { ArnoldHome } from "../../shared/arnold-view.js";
import type { DashboardData } from "../demo/dashboard.js";
import {
  records,
  RUN_RECORD_LABEL,
  runRecordValue,
  shortDate,
} from "./dashboard.js";

export type RecordRow = DashboardData["records"][number];

export function recordsScreenModel(home: ArnoldHome): RecordRow[] {
  const latest = home.records_by_exercise
    .map((e) => e.latest)
    .sort(
      (a, b) =>
        b.achieved_on.localeCompare(a.achieved_on) ||
        a.exercise_name.localeCompare(b.exercise_name, "de"),
    );
  return records(latest);
}

/**
 * The running records: all five in a fixed order once at least one is known
 * (an unknown one shows "–", never 0), none at all for someone who never ran
 * with a measurement.
 */
export function runRecordsScreenModel(home: ArnoldHome): RecordRow[] {
  if (!home.run_records.some((r) => r.value !== null)) return [];
  return home.run_records.map((r) => ({
    exercise: RUN_RECORD_LABEL[r.key],
    value: runRecordValue(r),
    when: r.achieved_on ? shortDate(r.achieved_on) : "",
  }));
}
