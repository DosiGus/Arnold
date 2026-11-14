import { ChevronRight } from "lucide-react";
import type { RunCard } from "../../shared/run-card-contract";
import type { RunWeekResponse } from "../../shared/run-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { dateLabel } from "../format";
import { RUN_TYPE_LABEL, minutesLabel } from "../run/format";
import { browserZone, useRunData } from "../run/shared";

/**
 * The next run on the start screen. The week comes from `get_run_week`; this
 * only picks the first stored, still planned run from today on and writes it
 * out. Nothing is computed. Without a planned run the start screen is exactly
 * what it was before; a failed read shows a notice and no figure.
 */
export type NextRun = {
  workout_id: string | null;
  name: string;
  run_type: RunWeekResponse["days"][number]["runs"][number]["run_type"];
  minutes: number | null;
  minutes_reserved: boolean;
  date: string;
  is_today: boolean;
};

export function nextPlannedRun(week: RunWeekResponse): NextRun | undefined {
  return week.days
    .filter((d) => d.date >= week.today)
    .flatMap((d) =>
      d.runs.map((run) => ({ ...run, date: d.date, is_today: d.is_today })),
    )
    .find((r) => r.workout_id && r.status === "planned");
}

export function HomeNextRun({
  client,
  onOpenRun,
}: {
  client: ArnoldMcpClient;
  onOpenRun: (card: RunCard) => void;
}) {
  const zone = browserZone();
  const state = useRunData(async () => {
    const week = await client.runWeek({ timezone: zone });
    return nextPlannedRun(week) ?? null;
  }, [client, zone]);
  if (state.loading && state.data === undefined) return null;
  if (state.data === undefined)
    return (
      <p className="ac-caption ac-home-run-note" role="status">
        Deinen nächsten Lauf konnten wir gerade nicht laden.{" "}
        <button type="button" className="ac-link" onClick={state.reload}>
          Erneut versuchen
        </button>
      </p>
    );
  const run = state.data;
  if (!run) return null;
  const title = run.name || RUN_TYPE_LABEL[run.run_type];
  const when = run.is_today ? "Heute" : dateLabel(run.date, true);
  const duration = `${minutesLabel(run.minutes)}${run.minutes_reserved ? " (Platz reserviert)" : ""}`;
  return (
    <button
      type="button"
      className="ac-home-run"
      onClick={() => onOpenRun(run.is_today ? "run_today" : "run_week")}
    >
      <span className="ac-home-run-text">
        <span className="ac-caption">Nächster Lauf</span>
        <strong>{title}</strong>
        <span className="ac-home-run-meta">
          {when} · {duration}
        </span>
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}
