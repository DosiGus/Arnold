/**
 * Exercise progress.
 *
 * The user picks an exercise, a period and a metric; the backend does the whole
 * calculation and returns real measurement points. This view adds no
 * interpolation, no zero filling and no comparison across execution variants.
 */
import { useEffect, useState } from "react";
import { Activity, TrendingUp } from "lucide-react";
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
  PeriodFilter,
  StatusNotice,
  type PeriodValue,
} from "../components";
import { ProgressChart } from "../components/TrendChart";
import {
  dateLabel,
  EXECUTION_MODE_LABEL,
  formatNumber,
  LOAD_BASIS_LABEL,
  metricDisplay,
  SIDE_LABEL,
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
  const [period, setPeriod] = useState<PeriodValue>({});

  // The catalog can change under a reload; keep the selection valid.
  useEffect(() => {
    if (
      exerciseId &&
      !dashboard.exercises.some((e) => e.exercise_id === exerciseId)
    )
      setExerciseId(dashboard.exercises[0]?.exercise_id ?? "");
  }, [dashboard.exercises, exerciseId]);

  const progress = useExerciseProgress(client, exerciseId, metric, period);
  const view = progress.data;
  const selectedMeta = PROGRESS_METRICS.find((m) => m.key === metric)!;

  if (!dashboard.exercises.length)
    return (
      <EmptyState
        title="Noch keine Übungen vorhanden"
        text="Sobald ein Übungskatalog vorliegt, kannst du hier den Fortschritt auswerten."
      />
    );

  return (
    <>
      <div className="filter-bar progress-filters">
        <div className="filter-selects">
          <ExerciseSelector
            exercises={dashboard.exercises}
            value={exerciseId}
            onChange={setExerciseId}
          />
          <label htmlFor="progress-metric">
            Kennzahl
            <select
              id="progress-metric"
              aria-label="Kennzahl"
              value={metric}
              onChange={(e) => setMetric(e.target.value as ProgressMetricKey)}
            >
              {PROGRESS_METRICS.map((entry) => {
                const available = view?.available_metrics.find(
                  (m) => m.key === entry.key,
                );
                return (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                    {available && available.point_count === 0
                      ? " · keine Messpunkte"
                      : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <PeriodFilter
          value={period}
          onChange={setPeriod}
          anchor={dashboard.period.to}
          idPrefix="progress"
          scopeLabel="Fortschritt"
        />
      </div>

      {progress.error && (
        <ErrorState message={progress.error} onRetry={progress.reload} />
      )}
      {view?.notices.map((notice) => (
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
            />
            <div className="chart-caption">
              <span className="legend-dot" aria-hidden="true" />
              {selectedMeta.label}
              <span>
                {view.selected_series.points.length} Messpunkte ·
                Zusammenfassung pro Tag:{" "}
                {
                  {
                    max: "Maximum",
                    sum: "Summe",
                    mean: "Mittelwert",
                    last: "letzter Wert",
                  }[view.selected_series.aggregation]
                }
              </span>
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

      {view && view.variants.length > 0 && (
        <Card>
          <div className="card-heading">
            <div>
              <h2>Ausführungsarten</h2>
              <p>Lasten werden nur innerhalb einer Ausführung verglichen</p>
            </div>
          </div>
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
                const max = metricDisplay({
                  ...variant.max_load,
                  key: "max",
                  label: "Max",
                  note: null,
                  detail: null,
                });
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
                    <td>
                      {max.value}
                      {max.unit ? ` ${max.unit}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <div className="info-note">
        <Activity size={18} aria-hidden="true" />
        <p>
          <strong>Eine Schätzung, keine Messung.</strong> Das geschätzte 1RM
          nutzt die Epley-Formel: Gewicht × (1 + Wiederholungen / 30). Bei einer
          Wiederholung entspricht es dem Gewicht. Hohe Wiederholungszahlen
          verringern die Aussagekraft. Werte pro Hantel und Maschinenanzeigen
          sind nicht mit Gesamtlasten vergleichbar.
        </p>
      </div>
    </>
  );
}
