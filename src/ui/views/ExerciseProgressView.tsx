import { useEffect, useState } from "react";
import type {
  ArnoldDashboardView,
  ProgressMetricKey,
} from "../../shared/arnold-view";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useExerciseProgress } from "../hooks";
import { useModelContext } from "../hooks/useModelContext";
import {
  ArnoldCard,
  CardActions,
  CardNote,
  CardSkeleton,
  ChipGroup,
} from "../components/cards";
import { RecoveryCard } from "../components/recovery";
import { ProgressChart } from "../components/TrendChart";
import {
  dateLabel,
  formatNumber,
  metricDisplay,
  LOAD_BASIS_LABEL,
  SIDE_LABEL,
  EXECUTION_MODE_LABEL,
} from "../format";

const METRICS = [
  { value: "max_load", label: "Gewicht" },
  { value: "total_reps", label: "Wiederholungen" },
  { value: "estimated_1rm", label: "Geschätztes Maximum" },
  { value: "nominal_volume", label: "Trainingsvolumen" },
] as const;

export function ExerciseProgressView({
  client,
  dashboard,
}: {
  client: ArnoldMcpClient;
  dashboard: ArnoldDashboardView;
}) {
  const [exerciseId, setExerciseId] = useState(
    () =>
      dashboard.exercises.find((e) => e.logged_sets > 0)?.exercise_id ??
      dashboard.exercises[0]?.exercise_id ??
      "",
  );
  const [metric, setMetric] = useState<ProgressMetricKey>("max_load");
  const [choosing, setChoosing] = useState<"exercise" | "metric">();
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!dashboard.exercises.some((e) => e.exercise_id === exerciseId))
      setExerciseId(dashboard.exercises[0]?.exercise_id ?? "");
  }, [dashboard.exercises, exerciseId]);
  const progress = useExerciseProgress(client, exerciseId, metric, {});
  // A previous exercise's data must never be presented under the new selection.
  const view =
    progress.data?.exercise_id === exerciseId &&
    progress.data.selected_metric === metric
      ? progress.data
      : undefined;
  const comparable =
    metric === "estimated_1rm"
      ? view?.best_estimated_1rm_comparability
      : metric === "max_load"
        ? view?.max_comparable_load_comparability
        : undefined;
  const key =
    metric === "max_load"
      ? "max_comparable_load"
      : metric === "estimated_1rm"
        ? "best_estimated_1rm"
        : metric;
  const kpi = view?.kpis.find((item) => item.key === key);
  const lastPoint = view?.selected_series?.points.at(-1);
  const shown = kpi
    ? metricDisplay(kpi)
    : lastPoint
      ? { value: formatNumber(lastPoint.value, 0), unit: "Wdh.", known: true }
      : undefined;
  const comparison = comparable
    ? [
        LOAD_BASIS_LABEL[comparable.load_basis],
        EXECUTION_MODE_LABEL[comparable.execution_mode],
        comparable.side ? SIDE_LABEL[comparable.side] : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  // The engine supplies both the improvement and its comparability. No delta is computed here.
  const record =
    metric === "max_load" || metric === "estimated_1rm"
      ? dashboard.records
          .filter(
            (r) =>
              r.exercise_id === exerciseId &&
              r.metric ===
                (metric === "max_load" ? "max_load" : "estimated_1rm") &&
              r.comparability?.key === comparable?.key &&
              r.kind === "improvement",
          )
          .sort((a, b) => b.achieved_on.localeCompare(a.achieved_on))[0]
      : undefined;
  const dateRange =
    view?.first_training_date && view.last_training_date
      ? `${dateLabel(view.first_training_date)} – ${dateLabel(view.last_training_date)}`
      : undefined;
  useModelContext(
    client,
    view
      ? `Arnold zeigt den Fortschritt für „${view.exercise_name}“ (${view.exercise_id}): ${kpi?.label ?? "Wiederholungen beim letzten Training"}, ${shown?.known ? `${shown.value} ${shown.unit}` : "noch nicht verfügbar"}. ${comparison ?? ""}. Zeitraum: ${dateRange ?? "noch ohne Messpunkte"}. Die Karte zeigt die Werte bereits. Keine Ausführungen vermischen.`
      : undefined,
  );
  if (!dashboard.exercises.length)
    return (
      <ArnoldCard
        label="Fortschritt"
        title="Dein Fortschritt beginnt mit dem ersten Satz"
        subtitle="Starte ein Training. Danach kannst du deine Entwicklung hier verfolgen."
      >
        <CardActions
          primary={{
            label: "Training ansehen",
            onClick: () => void client.openDashboard(),
          }}
        />
      </ArnoldCard>
    );
  if (choosing)
    return (
      <ArnoldCard
        label="Fortschritt"
        title={
          choosing === "exercise"
            ? "Welche Übung möchtest du ansehen?"
            : "Was möchtest du verfolgen?"
        }
      >
        {choosing === "exercise" ? (
          <ChipGroup
            label="Übung auswählen"
            value={exerciseId}
            options={dashboard.exercises
              .slice(page * 6, page * 6 + 6)
              .map((e) => ({ value: e.exercise_id, label: e.name }))}
            onChange={(value) => {
              if (value) {
                setExerciseId(value);
                setChoosing(undefined);
              }
            }}
          />
        ) : (
          <ChipGroup
            label="Kennzahl auswählen"
            value={metric}
            options={METRICS}
            onChange={(value) => {
              if (value) {
                setMetric(value);
                setChoosing(undefined);
              }
            }}
          />
        )}
        {page > 0 && choosing === "exercise" && (
          <button className="ac-link" onClick={() => setPage((p) => p - 1)}>
            Vorherige Übungen
          </button>
        )}
        <CardActions
          primary={
            choosing === "exercise" &&
            (page + 1) * 6 < dashboard.exercises.length
              ? {
                  label: "Weitere Übungen",
                  onClick: () => setPage((p) => p + 1),
                }
              : undefined
          }
          secondary={{ label: "Zurück", onClick: () => setChoosing(undefined) }}
        />
      </ArnoldCard>
    );
  if (progress.error)
    return (
      <RecoveryCard
        recovery={progress.failure?.recovery ?? "retry_same_request"}
        onAction={progress.reload}
      />
    );
  if (!view) return <CardSkeleton />;
  return (
    <ArnoldCard
      label="Dein Fortschritt"
      title={view.exercise_name}
      subtitle={dateRange}
      busy={progress.loading}
    >
      {shown?.known ? (
        <div className="ac-progress-value">
          <p className="ac-caption">
            {kpi?.label ??
              `Wiederholungen am ${lastPoint ? dateLabel(lastPoint.date) : "letzten Trainingstag"}`}
          </p>
          <p className="ac-big">
            {shown.value}
            <small>{shown.unit}</small>
          </p>
        </div>
      ) : (
        <CardNote>
          {kpi?.note ??
            view.notices[0]?.message ??
            "Für diese Kennzahl liegen noch keine vergleichbaren Werte vor."}
        </CardNote>
      )}
      {comparison && <p className="ac-caption">{comparison}</p>}
      {kpi?.note && shown?.known && <p className="ac-caption">{kpi.note}</p>}
      {record?.improvement !== null && record?.improvement !== undefined && (
        <p className="ac-text">
          +{formatNumber(record.improvement, 1)} {shown?.unit} beim Rekord am{" "}
          {dateLabel(record.achieved_on)}
        </p>
      )}
      {metric === "estimated_1rm" && (
        <p className="ac-caption">
          Aus deinen Sätzen geschätzt. Kein getestetes Maximalgewicht.
        </p>
      )}
      {view.selected_series?.points.length ? (
        <ProgressChart
          points={view.selected_series.points}
          label={
            METRICS.find((m) => m.value === metric)?.label ?? "Fortschritt"
          }
          unit={metric === "total_reps" ? "Wdh." : "kg"}
          loadBasisLabel={comparison}
          compact
        />
      ) : (
        <p className="ac-text">
          Speichere weitere Sätze, um hier einen Verlauf zu sehen.
        </p>
      )}
      {view.notices
        .filter((n) => n.severity === "warning")
        .map((notice) => (
          <CardNote key={notice.code}>{notice.message}</CardNote>
        ))}
      <CardActions
        primary={{
          label: "Übung wechseln",
          onClick: () => {
            setPage(0);
            setChoosing("exercise");
          },
        }}
        secondary={{
          label: "Andere Kennzahl",
          onClick: () => setChoosing("metric"),
        }}
      />
    </ArnoldCard>
  );
}
