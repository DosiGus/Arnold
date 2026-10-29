import { ArrowRight, ArrowUpRight, Check, Play, Trophy } from "lucide-react";
import type { ArnoldDashboardView, ViewRecord } from "../../shared/arnold-view";
import { Card, EmptyState, MetricCard, StatusNotice } from "../components";
import { WeeklyActivityChart } from "../components/TrendChart";
import {
  dateLabel,
  formatExecution,
  formatNumber,
  LOAD_BASIS_LABEL,
} from "../format";
import strengthSculpture from "../assets/strength-sculpture.webp?inline";

const HOME_METRICS = [
  { key: "workouts", label: "Trainings" },
  { key: "working_sets", label: "Arbeitssätze" },
  { key: "nominal_volume", label: "Volumen" },
] as const;

/** Only drawing coordinates are scaled here. Values are the engine's real weeks;
 * nulls break the line, rather than becoming zero or interpolated observations. */
function MiniTrend({ values }: { values: readonly (number | null)[] }) {
  const points = values.slice(-9);
  if (!points.length || points.every((value) => value === null)) return null;
  const scale = Math.max(
    1,
    ...points.filter((value): value is number => value !== null),
  );
  const x = (index: number) =>
    3 + (index * 100) / Math.max(1, points.length - 1);
  const y = (value: number) => 33 - (value / scale) * 27;
  let path = "";
  let connected = false;
  points.forEach((value, index) => {
    if (value === null) {
      connected = false;
      return;
    }
    path += `${connected ? "L" : "M"}${x(index)},${y(value)} `;
    connected = true;
  });
  const last = points[points.length - 1];
  return (
    <svg
      className="metric-sparkline"
      viewBox="0 0 108 40"
      fill="none"
      aria-hidden="true"
    >
      <path d="M3 35H105" className="sparkline-baseline" />
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last !== null && (
        <circle
          cx={x(points.length - 1)}
          cy={y(last)}
          r="2.5"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

function RecordSpotlight({
  record,
  onOpen,
}: {
  record?: ViewRecord;
  onOpen: () => void;
}) {
  const basis =
    record?.load_basis && record.load_basis !== "total"
      ? LOAD_BASIS_LABEL[record.load_basis]
      : null;
  const execution =
    record?.execution_mode && record.side
      ? formatExecution({
          execution_mode: record.execution_mode,
          side: record.side,
        })
      : null;
  return (
    <Card className="record-spotlight">
      <div className="spotlight-head">
        <span className="section-label">Persönlicher Rekord</span>
        <span className="glass-medallion">
          <Trophy size={19} aria-hidden="true" />
        </span>
      </div>
      {record ? (
        <>
          <div className="spotlight-content">
            <span className="record-kind">{record.metric_label}</span>
            <div className="spotlight-value">
              {formatNumber(record.value, 1)}
              <span>{record.unit === "reps" ? "Wdh." : record.unit}</span>
            </div>
            <h2>{record.exercise_name}</h2>
            <div className="spotlight-context">
              {basis && <span>{basis}</span>}
              {execution && <span>{execution}</span>}
              {record.reps !== null && <span>{record.reps} Wdh.</span>}
              <span>{dateLabel(record.achieved_on)}</span>
            </div>
            {record.improvement !== null && record.improvement > 0 && (
              <span className="record-improvement">
                <ArrowUpRight size={13} aria-hidden="true" />+
                {formatNumber(record.improvement, 1)}{" "}
                {record.unit === "reps" ? "Wdh." : record.unit}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="spotlight-content spotlight-empty">
          <Trophy size={42} strokeWidth={1} aria-hidden="true" />
          <h2>
            Dein nächster
            <br />
            Meilenstein wartet.
          </h2>
        </div>
      )}
      <button className="spotlight-link" onClick={onOpen}>
        Rekorde ansehen
        <span className="round-arrow">
          <ArrowUpRight size={17} aria-hidden="true" />
        </span>
      </button>
    </Card>
  );
}

export function OverviewView({
  view,
  loading = false,
  onOpenWorkout,
  onOpenProgress,
  onOpenTraining,
  onOpenPlan,
}: {
  view: ArnoldDashboardView;
  loading?: boolean;
  onOpenWorkout: (workoutId: string) => void;
  onOpenProgress: () => void;
  onOpenTraining?: () => void;
  onOpenPlan?: () => void;
}) {
  if (view.state === "empty_history" || view.state === "master_template") {
    return (
      <Card className="welcome-card">
        <span className="section-label">
          {view.state === "master_template" ? "Master-Vorlage" : "Dein Anfang"}
        </span>
        <h2>
          {view.state === "master_template"
            ? "Platz für deinen Fortschritt."
            : "Willkommen bei Arnold"}
        </h2>
        <p>
          {view.state === "master_template"
            ? "Diese Vorlage enthält keine persönlichen Trainingsdaten."
            : "Dein erstes Training ist der Anfang."}
        </p>
        {view.state !== "master_template" && onOpenTraining && (
          <button className="primary" onClick={onOpenTraining}>
            <Play size={15} aria-hidden="true" />
            Training starten
          </button>
        )}
      </Card>
    );
  }
  const lastWorkout = view.recent_workouts.find(
    (workout) => workout.status === "completed",
  );
  const record =
    view.records.find((item) => item.metric === "max_load") ?? view.records[0];
  return (
    <>
      {view.notices
        .filter((notice) => notice.severity === "warning")
        .map((notice) => (
          <StatusNotice key={notice.code} notice={notice} />
        ))}
      <div className="overview-grid">
        <Card className="session-hero">
          <div className="hero-atmosphere" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <img
            className="strength-sculpture"
            src={strengthSculpture}
            alt=""
            draggable={false}
          />
          <div className="hero-copy">
            <span className="section-label">Dein Training. Dein Moment.</span>
            <h2>
              Heute
              <br />
              <span>zählt.</span>
            </h2>
            {onOpenTraining && (
              <button className="hero-start" onClick={onOpenTraining}>
                <span className="hero-play">
                  <Play size={16} aria-hidden="true" />
                </span>
                Training starten
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          {view.active_plan ? (
            <button
              className="hero-plan"
              onClick={onOpenPlan}
              disabled={!onOpenPlan}
            >
              <span className="plan-presence" aria-hidden="true">
                <Check size={12} />
              </span>
              <span className="hero-plan-name">{view.active_plan.name}</span>
              {view.active_plan.days_per_week !== null && (
                <span className="hero-plan-days">
                  {view.active_plan.days_per_week} Tage / Woche
                </span>
              )}
              {onOpenPlan && <ArrowUpRight size={15} aria-hidden="true" />}
            </button>
          ) : (
            <div className="hero-plan hero-plan-empty">
              <span>Dein Training beginnt mit dir.</span>
            </div>
          )}
        </Card>

        <RecordSpotlight record={record} onOpen={onOpenProgress} />

        <Card className="performance-strip">
          <div className="performance-cells" aria-busy={loading}>
            {HOME_METRICS.map(({ key, label }) => {
              const metric = view.kpis.find((item) => item.key === key);
              return metric ? (
                <div className="performance-cell" key={key}>
                  <MetricCard metric={metric} label={label} />
                  {metric.value !== null && (
                    <MiniTrend values={view.weeks.map((week) => week[key])} />
                  )}
                </div>
              ) : null;
            })}
          </div>
        </Card>

        <Card className="rhythm-card">
          <div className="card-heading">
            <div>
              <span className="section-label">Kontinuität</span>
              <h2>Dein Rhythmus.</h2>
            </div>
            <span className="chart-period-pill">Einheiten / Woche</span>
          </div>
          {view.weeks.length ? (
            <WeeklyActivityChart weeks={view.weeks} />
          ) : (
            <EmptyState title="Dein Rhythmus entsteht." />
          )}
        </Card>

        {lastWorkout ? (
          <button
            className="recent-session"
            onClick={() => onOpenWorkout(lastWorkout.workout_id)}
            aria-label={`${lastWorkout.title} am ${dateLabel(lastWorkout.date, true)}, ${lastWorkout.exercise_count} Übungen, ${lastWorkout.set_count} Sätze`}
          >
            <div className="recent-session-head">
              <span className="section-label">Zuletzt trainiert</span>
              <span className="round-arrow">
                <ArrowUpRight size={17} aria-hidden="true" />
              </span>
            </div>
            <div className="recent-session-body">
              <span className="recent-date">
                {dateLabel(lastWorkout.date, true)}
              </span>
              <h2>{lastWorkout.title}</h2>
            </div>
            <div className="recent-session-foot">
              <span>
                {lastWorkout.exercise_count}{" "}
                {lastWorkout.exercise_count === 1 ? "Übung" : "Übungen"}
                <i />
                {lastWorkout.set_count} Sätze
              </span>
              <span className="completed-mark">
                <Check size={12} aria-hidden="true" />
                Abgeschlossen
              </span>
            </div>
          </button>
        ) : (
          <Card className="recent-session recent-session-empty">
            <span className="section-label">Dein nächster Schritt</span>
            <h2>Einfach anfangen.</h2>
            {onOpenTraining && (
              <button className="text-button" onClick={onOpenTraining}>
                Training starten
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
