import { useEffect, useState } from "react";
import { DataLLM } from "skybridge/web";
import {
  ArnoldExerciseProgressViewSchema,
  type ArnoldDashboardView,
  type ArnoldExerciseProgressView,
} from "../../shared/arnold-view.js";
import { useArnoldTool } from "../arnold-client.js";
import type { OnboardingView } from "../demo/model.js";
import {
  exerciseSeries,
  rangeStart,
  statsExercise,
  weeklySeries,
  type StatsRange,
} from "../model/stats.js";
import { StatsScreen } from "../onboarding/screens.js";

/**
 * The progress screen on Arnold's history: weekly figures from the dashboard
 * answer, the strength curve of the most trained exercise from
 * `get_arnold_exercise_progress` for the chosen range (estimated 1RM).
 */
export function LiveStatsScreen({
  view,
  source,
  onBack,
}: {
  view: OnboardingView;
  source: ArnoldDashboardView;
  onBack: () => void;
}) {
  const [range, setRange] = useState<StatsRange>("12");
  const { call } = useArnoldTool(
    "get_arnold_exercise_progress",
    ArnoldExerciseProgressViewSchema,
  );
  const [progress, setProgress] = useState<ArnoldExerciseProgressView | null>(
    null,
  );
  const exercise = statsExercise(source);
  const exerciseId = exercise?.id ?? null;
  const from = rangeStart(source, range);
  useEffect(() => {
    if (!exerciseId) return;
    let live = true;
    call({
      exercise_id: exerciseId,
      metric: "estimated_1rm",
      ...(from ? { from } : {}),
    })
      .then((p) => live && setProgress(p))
      .catch(() => live && setProgress(null));
    return () => {
      live = false;
    };
  }, [call, exerciseId, from]);

  const weekly = weeklySeries(source, range);
  const series = [
    ...(progress && !progress.empty ? [exerciseSeries(progress)] : []),
    ...weekly,
  ];
  return (
    <DataLLM
      content={`Entwicklungs-Karte: ${series.map((s) => s.label).join(", ") || "noch keine Daten"}, letzte ${range} Wochen.`}
    >
      <StatsScreen
        view={view}
        onBack={onBack}
        live={{ series, range, onRange: setRange }}
      />
    </DataLLM>
  );
}
