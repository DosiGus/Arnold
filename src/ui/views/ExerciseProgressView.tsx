/**
 * Exercise progress.
 *
 * The user picks an exercise, a period and a metric; the backend does the whole
 * calculation and returns real measurement points. This view adds no
 * interpolation, no zero filling and no comparison across execution variants.
 */
import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import type {
  ArnoldDashboardView,
  ProgressMetricKey,
} from "../../shared/arnold-view";
import { PROGRESS_METRICS } from "../../shared/arnold-view";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useExerciseProgress } from "../hooks";
import {
  Card,
  EmptyState,
  ErrorState,
  ExerciseSelector,
  LoadingState,
  MetricCard,
  RecordRow,
  StatusNotice,
} from "../components";
import { ProgressChart } from "../components/TrendChart";
import {
  dateLabel,
  EXECUTION_MODE_LABEL,
  formatNumber,
  LOAD_BASIS_LABEL,
  SIDE_LABEL,
  UNKNOWN,
} from "../format";

export function ExerciseProgressView({
  client,
  dashboard,
}: {
  client: ArnoldMcpClient;
  dashboard: ArnoldDashboardView;
}) {
  // Prefer an exercise that actually has training logged, so the first view is
  // informative rather than an empty chart.
  const [exerciseId, setExerciseId] = useState(
    () =>
      dashboard.exercises.find((e) => e.logged_sets > 0)?.exercise_id ??
      dashboard.exercises[0]?.exercise_id ??
      "",
  );
  const [metric, setMetric] = useState<ProgressMetricKey>("max_load");

  // The catalog can change under a reload; keep the selection valid.
  useEffect(() => {
    if (
      exerciseId &&
      !dashboard.exercises.some((e) => e.exercise_id === exerciseId)
    )
      setExerciseId(dashboard.exercises[0]?.exercise_id ?? "");
  }, [dashboard.exercises, exerciseId]);

  const progress = useExerciseProgress(client, exerciseId, metric, {});
  const view = progress.data;
  const selectedMeta = PROGRESS_METRICS.find((m) => m.key === metric)!;
  // The engine states which convention the plotted series follows; a total load
  // needs no label, anything else does.
  const seriesBasis = (() => {
    const reference = view?.selected_series?.load_reference ?? null;
    if (!reference || reference === "total") return null;
    const map: Record<string, string> = {
      per_implement: LOAD_BASIS_LABEL.per_implement,
      machine_display: LOAD_BASIS_LABEL.machine_display,
      added_external: LOAD_BASIS_LABEL.added,
      assistance: LOAD_BASIS_LABEL.assistance,
      bodyweight: LOAD_BASIS_LABEL.bodyweight_only,
    };
    return map[reference] ?? null;
  })();

  if (!dashboard.exercises.length)
    return (
      <EmptyState
        title="Noch keine Übungen vorhanden"
        text="Sobald ein Übungskatalog vorliegt, kannst du hier den Fortschritt auswerten."
      />
    );

  return (
    <>
      <div className="progress-toolbar">
        <ExerciseSelector
          exercises={dashboard.exercises}
          value={exerciseId}
          onChange={setExerciseId}
        />
        <div className="segmented" role="group" aria-label="Kennzahl">
          {(
            [
              { key: "max_load", label: "Kraft" },
              { key: "estimated_1rm", label: "1RM" },
              { key: "nominal_volume", label: "Volumen" },
              { key: "total_reps", label: "Wdh." },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              className={metric === item.key ? "selected" : ""}
              aria-pressed={metric === item.key}
              onClick={() => setMetric(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {progress.error && (
        <ErrorState message={progress.error} onRetry={progress.reload} />
      )}
      {view?.notices
        .filter((notice) => notice.severity === "warning")
        .map((notice) => (
          <StatusNotice key={notice.code} notice={notice} />
        ))}

      {view && (
        <div className="stats-grid" aria-busy={progress.loading}>
          {view.kpis.slice(0, 4).map((kpi) => (
            <MetricCard key={kpi.key} metric={kpi} />
          ))}
        </div>
      )}

      <Card className="progress-chart-card">
        <div className="card-heading">
          <div>
            <h2>{view?.exercise_name ?? "Übungsverlauf"}</h2>
            <p>
              {selectedMeta.label}
              {view?.first_training_date && view.last_training_date
                ? ` · ${dateLabel(view.first_training_date)} – ${dateLabel(view.last_training_date)}`
                : ""}
            </p>
          </div>
          <span className="soft-icon" aria-hidden="true">
            <TrendingUp size={20} />
          </span>
        </div>

        {progress.loading && !view ? (
          <LoadingState text="Übungsfortschritt wird geladen …" />
        ) : progress.error ? (
          <EmptyState
            title="Fortschritt nicht geladen"
            text="Bitte erneut laden oder die Filter prüfen."
          />
        ) : view && !view.empty && view.selected_series ? (
          <>
            <ProgressChart
              points={view.selected_series.points}
              label={selectedMeta.label}
              unit={selectedMeta.unit}
              loadBasisLabel={seriesBasis}
            />
            <div className="chart-caption">
              <span className="legend-dot" aria-hidden="true" />
              {selectedMeta.label}
              {seriesBasis ? ` · ${seriesBasis}` : ""}
              <span>{view.selected_series.points.length} Messpunkte</span>
            </div>
          </>
        ) : (
          <EmptyState
            title="Noch kein Verlauf"
            text={
              view?.notices[0]?.message ??
              "Für diese Übung liegen im gewählten Zeitraum keine Messpunkte vor."
            }
          />
        )}
      </Card>

      {dashboard.records.length > 0 && (
        <Card className="progress-records">
          <div className="card-heading">
            <h2>Deine Rekorde</h2>
          </div>
          {dashboard.records.map((record) => (
            <RecordRow
              key={`${record.metric}-${record.exercise_id}-${record.achieved_on}`}
              record={record}
            />
          ))}
        </Card>
      )}

      {view && view.variants.length > 0 && (
        <details className="card progress-details">
          <summary>Ausführungsarten</summary>
          <div className="table-scroll">
            <table className="set-list">
              <caption className="visually-hidden">
                Geloggte Ausführungsarten dieser Übung
              </caption>
              <thead>
                <tr>
                  <th scope="col">Ausführung</th>
                  <th scope="col">Gewichtsdefinition</th>
                  <th scope="col">Arbeitssätze</th>
                  <th scope="col">Max. Last</th>
                </tr>
              </thead>
              <tbody>
                {view.variants.map((variant) => {
                  const max =
                    variant.max_load.value === null
                      ? UNKNOWN
                      : `${formatNumber(variant.max_load.value, 1)} kg`;
                  return (
                    <tr key={variant.comparability.key}>
                      <th scope="row">
                        {variant.comparability.side &&
                        variant.comparability.execution_mode === "unilateral"
                          ? SIDE_LABEL[variant.comparability.side]
                          : EXECUTION_MODE_LABEL[
                              variant.comparability.execution_mode
                            ]}
                        {variant.comparability.implement_count > 1 && (
                          <small>
                            {" "}
                            · {variant.comparability.implement_count} Hanteln
                          </small>
                        )}
                      </th>
                      <td>
                        {LOAD_BASIS_LABEL[variant.comparability.load_basis]}
                      </td>
                      <td>{formatNumber(variant.working_sets, 0)}</td>
                      <td>{max}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
