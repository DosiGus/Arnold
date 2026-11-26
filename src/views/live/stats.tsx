import { useEffect, useState } from "react";
import { DataLLM } from "skybridge/web";
import {
  ArnoldExerciseProgressViewSchema,
  type ArnoldDashboardView,
  type ArnoldExerciseProgressView,
} from "../../shared/arnold-view.js";
import { useArnoldTool } from "../arnold-client.js";
import {
  exerciseSeries,
  rangeStart,
  statsExercises,
  weeklySeries,
  type StatsRange,
} from "../model/stats.js";
import { StatsScreen } from "../onboarding/screens.js";

/**
 * The progress screen on Arnold's history: weekly figures from the dashboard
 * answer, the strength curve of one exercise (at first the most trained one)
 * from `get_arnold_exercise_progress` for the chosen range (estimated 1RM).
 */
export function LiveStatsScreen({
  source,
  onBack,
}: {
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
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const exercises = statsExercises(source);
  const exerciseId = chosen ?? exercises[0]?.id ?? null;
  const from = rangeStart(source, range);
  useEffect(() => {
    if (!exerciseId) return;
    let live = true;
    setFailed(false);
    call({
      exercise_id: exerciseId,
      metric: "estimated_1rm",
      ...(from ? { from } : {}),
    })
      .then((p) => live && setProgress(p))
      .catch(() => {
        if (!live) return;
        setProgress(null);
        setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [call, exerciseId, from]);

  const weekly = weeklySeries(source, range);
  // An exercise without values in the range keeps its place, so another one
  // can still be chosen.
  const series = [...(progress ? [exerciseSeries(progress)] : []), ...weekly];
  return (
    <DataLLM
      content={`Entwicklungs-Karte: ${series.map((s) => s.label).join(", ") || "noch keine Daten"}, letzte ${range} Wochen.`}
    >
      <StatsScreen
        onBack={onBack}
        live={{
          series,
          range,
          onRange: setRange,
          curveFailed: failed,
          exercise:
            exerciseId && exercises.length > 1
              ? {
                  options: exercises.map((e) => ({
                    value: e.id,
                    label: e.name,
                  })),
                  value: exerciseId,
                  onChange: setChosen,
                }
              : null,
        }}
      />
    </DataLLM>
  );
}
