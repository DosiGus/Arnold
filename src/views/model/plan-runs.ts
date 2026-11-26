/**
 * The plan screen's run days with what Arnold's run week says about them
 * (`get_run_week`): the next planned run, else Arnold's unsaved proposal.
 * Only values the server gives; without them the day stays as it was.
 */
import type { RunWeekResponse } from "../../shared/run-contract.js";
import type { Plan } from "../demo/model.js";
import { kmText, weekdayDate } from "./dashboard.js";

type Run = RunWeekResponse["suggestions"][number];

const minutes = (run: Run) =>
  run.minutes === null || run.minutes_reserved
    ? null
    : `${Math.round(run.minutes)} Min.`;

/** One line per run session that Arnold has something to say about. */
export function runLines(week: RunWeekResponse): Map<string, string> {
  const lines = new Map<string, string>();
  const planned = week.days
    .flatMap((d) => d.runs.map((run) => ({ ...run, date: d.date })))
    .filter((r) => r.status === "planned" && r.date >= week.today);
  const add = (run: Run, label: string) => {
    if (run.session_id === null || lines.has(run.session_id)) return;
    lines.set(
      run.session_id,
      [
        `${label} ${weekdayDate(run.date)}`,
        minutes(run),
        run.distance_m === null ? null : `${kmText(run.distance_m / 1000)} km`,
      ]
        .filter((p) => p !== null)
        .join(" · "),
    );
  };
  for (const run of planned) add(run, "Geplant:");
  for (const run of week.suggestions)
    add(run, "Vorschlag (noch nicht gespeichert):");
  return lines;
}

export function withRunWeek(plan: Plan, week: RunWeekResponse): Plan {
  const lines = runLines(week);
  return {
    ...plan,
    days: plan.days.map((day) => {
      const line = day.kind === "run" ? lines.get(day.id) : undefined;
      return line === undefined
        ? day
        : {
            ...day,
            exercises: day.exercises.map((e) => ({ ...e, detail: line })),
          };
    }),
  };
}
