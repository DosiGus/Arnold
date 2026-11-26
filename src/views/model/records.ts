/**
 * Arnold's records (dashboard `home.records_by_exercise`) → the records
 * screen: the newest record of every exercise, newest first.
 *
 * Mapping only: which set is a record is decided by the records engine
 * (`src/analytics/records.ts` via `src/analytics/home.ts`). Nothing here is
 * computed; the card only picks, sorts by date and formats.
 */
import type { ArnoldHome } from "../../shared/arnold-view.js";
import type { DashboardData } from "../demo/dashboard.js";
import { records } from "./dashboard.js";

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
