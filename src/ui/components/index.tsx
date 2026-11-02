/**
 * Reusable presentational components for the v2 dashboard.
 *
 * They receive finished view data and render it. None of them knows about MCP,
 * stored rows or metric arithmetic, and none interprets a load basis on
 * its own — weight wording always comes from `format.ts`.
 */
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Dumbbell,
  Info,
  LoaderCircle,
  RefreshCw,
  Trophy,
} from "lucide-react";
import type {
  ViewExerciseOption,
  ViewMetric,
  ViewNotice,
  ViewRecord,
  ViewSet,
  ViewWorkoutSummary,
} from "../../shared/arnold-view";
import {
  dateLabel,
  formatExecution,
  formatLoad,
  formatNumber,
  formatReps,
  LOAD_BASIS_LABEL,
  metricAriaLabel,
  metricDisplay,
  SET_TYPE_LABEL,
  UNKNOWN,
} from "../format";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}

/**
 * One KPI. An unknown value shows the placeholder plus its reason, so a gap in
 * the data is visible as a gap rather than as a confident zero.
 */
export function MetricCard({
  metric,
  label,
  tone = "green",
  icon: Icon,
}: {
  metric: ViewMetric;
  label?: string;
  tone?: string;
  icon?: typeof Dumbbell;
}) {
  const shown = metricDisplay(metric);
  // A load without its convention is ambiguous, so the basis is shown right at
  // the number rather than only in a table further down the page.
  const basis =
    metric.load_basis && metric.load_basis !== "total"
      ? LOAD_BASIS_LABEL[metric.load_basis]
      : null;
  return (
    <Card className={`stat-card ${shown.known ? "" : "metric-unknown"}`}>
      <div className="stat-top">
        <span>{label ?? metric.label}</span>
        {Icon && (
          <span className={`stat-icon ${tone}`} aria-hidden="true">
            <Icon size={18} />
          </span>
        )}
      </div>
      <div className="stat-value" aria-label={metricAriaLabel(metric)}>
        {shown.value}
        {shown.unit && <span>{shown.unit}</span>}
      </div>
      {basis && shown.known && <div className="stat-basis">{basis}</div>}
      {!shown.known && (
        <div className="stat-detail">{metric.note ?? metric.detail}</div>
      )}
      {/* A caveat can accompany a correctly computed value — a per-implement
          load is `valid` and still must not be read as a total — so the note is
          shown whenever the engine attached one. */}
      {shown.known && metric.note && (
        <div className="stat-caveat">{metric.note}</div>
      )}
    </Card>
  );
}

/** An informational or warning banner derived from a server-side notice. */
export function StatusNotice({ notice }: { notice: ViewNotice }) {
  const Icon = notice.severity === "warning" ? AlertTriangle : Info;
  return (
    <div
      className={`status-notice ${notice.severity}`}
      role={notice.severity === "warning" ? "alert" : "status"}
    >
      <Icon size={17} aria-hidden="true" />
      <div>
        <strong>{notice.title}</strong>
        <p>{notice.message}</p>
      </div>
    </div>
  );
}

export function LoadingState({ text = "Daten werden geladen …" }) {
  return (
    <div className="empty" role="status" aria-live="polite">
      <LoaderCircle className="spin" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

export function EmptyState({
  title = "Noch keine Daten",
  text,
  children,
}: {
  title?: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Dumbbell size={26} aria-hidden="true" />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

/** An error with an explicit retry, because a failed read is recoverable. */
export function ErrorState({
  message,
  onRetry,
  retryable = true,
}: {
  message: string;
  onRetry?: () => void;
  retryable?: boolean;
}) {
  return (
    <div className="error-message" role="alert">
      <AlertTriangle size={17} aria-hidden="true" />
      <div>
        <p>{message}</p>
        {onRetry && retryable && (
          <button className="secondary" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            Erneut laden
          </button>
        )}
      </div>
    </div>
  );
}

export type PeriodValue = { from?: string; to?: string };

/**
 * Period filter with presets. Bounds are sent to the server, which does the
 * narrowing, so a filter change costs one bounded request.
 */
export function PeriodFilter({
  value,
  onChange,
  anchor,
  idPrefix = "period",
  scopeLabel = "Zeitraum",
}: {
  value: PeriodValue;
  onChange: (next: PeriodValue) => void;
  /** Latest known training date; presets count back from it. */
  anchor: string | null;
  idPrefix?: string;
  /** Prefixes the field names, so two period filters never share a name. */
  scopeLabel?: string;
}) {
  const preset = (days: number) => {
    if (!anchor) return;
    const end = new Date(`${anchor}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    onChange({
      from: start.toISOString().slice(0, 10),
      to: anchor,
    });
  };
  const active = !value.from && !value.to;
  return (
    <div className="period-filter">
      <div
        className="segmented"
        role="group"
        aria-label={`Zeitraum ${scopeLabel}`}
      >
        <button
          className={active ? "selected" : ""}
          aria-pressed={active}
          onClick={() => onChange({})}
        >
          Gesamter Verlauf
        </button>
        <button onClick={() => preset(28)} disabled={!anchor}>
          Letzte 28 Tage
        </button>
        <button onClick={() => preset(91)} disabled={!anchor}>
          Letzte 13 Wochen
        </button>
      </div>
      <div className="date-filters">
        <label htmlFor={`${idPrefix}-from`}>
          Von
          <input
            id={`${idPrefix}-from`}
            type="date"
            aria-label={`${scopeLabel} von`}
            value={value.from ?? ""}
            onChange={(e) =>
              onChange({ ...value, from: e.target.value || undefined })
            }
          />
        </label>
        <label htmlFor={`${idPrefix}-to`}>
          Bis
          <input
            id={`${idPrefix}-to`}
            type="date"
            aria-label={`${scopeLabel} bis`}
            value={value.to ?? ""}
            onChange={(e) =>
              onChange({ ...value, to: e.target.value || undefined })
            }
          />
        </label>
      </div>
    </div>
  );
}

/**
 * Plan selector over the whole plan history, not just the active version, so an
 * archived plan stays selectable for its own workouts.
 */
export function PlanSelector({
  plans,
  value,
  onChange,
  id = "plan-filter",
}: {
  plans: readonly {
    plan_version_id: string;
    name: string;
    version_no: number;
    status: string;
    workouts: number;
  }[];
  value?: string;
  onChange: (next: string | undefined) => void;
  id?: string;
}) {
  return (
    <label htmlFor={id}>
      Trainingsplan
      <select
        id={id}
        aria-label="Trainingsplan"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">Alle Pläne</option>
        {plans.map((plan) => (
          <option key={plan.plan_version_id} value={plan.plan_version_id}>
            {plan.name} · v{plan.version_no}
            {plan.status === "archived" ? " (archiviert)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Session-name filter; names come from history, so any split works. */
export function SessionSelector({
  sessions,
  value,
  onChange,
  id = "session-filter",
}: {
  sessions: readonly string[];
  value?: string;
  onChange: (next: string | undefined) => void;
  id?: string;
}) {
  return (
    <label htmlFor={id}>
      Trainingseinheit
      <select
        id={id}
        aria-label="Trainingseinheit"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">Alle Einheiten</option>
        {sessions.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Exercise selector. History-only and retired exercises stay selectable and are
 * labelled, so a progress chart does not disappear when a plan changes.
 */
export function ExerciseSelector({
  exercises,
  value,
  onChange,
  id = "exercise-select",
  label = "Übung",
}: {
  exercises: readonly ViewExerciseOption[];
  value: string;
  onChange: (next: string) => void;
  id?: string;
  label?: string;
}) {
  return (
    <label htmlFor={id}>
      {label}
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {exercises.map((exercise) => (
          <option key={exercise.exercise_id} value={exercise.exercise_id}>
            {exercise.name}
            {exercise.retired ? " · beendet" : ""}
            {!exercise.in_current_catalog ? " · nur Historie" : ""}
            {exercise.logged_sets === 0 ? " · ohne Training" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Row in the overview and the history list. */
export function WorkoutCard({
  workout,
  selected = false,
  onSelect,
}: {
  workout: ViewWorkoutSummary;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const volume =
    workout.nominal_volume === null
      ? UNKNOWN
      : formatNumber(workout.nominal_volume, 0);
  return (
    <button
      className={`history-row ${selected ? "selected" : ""} ${
        workout.counts_towards_metrics ? "" : "not-counted"
      }`}
      onClick={() => onSelect?.(workout.workout_id)}
      aria-pressed={selected}
      aria-label={`${workout.title} am ${dateLabel(workout.date, true)}, ${workout.exercise_count} Übungen, ${workout.set_count} Sätze`}
    >
      <span className="workout-icon" aria-hidden="true">
        <Dumbbell size={18} />
      </span>
      <span className="workout-info">
        <strong>{workout.title}</strong>
        <small>
          {dateLabel(workout.date, true)} · {workout.exercise_count} Übungen ·{" "}
          {workout.set_count} Sätze
          {workout.plan_name ? ` · ${workout.plan_name}` : ""}
        </small>
      </span>
      {!workout.counts_towards_metrics && (
        <span className="set-flag">{workout.status_label}</span>
      )}
      <span className="history-volume">
        {volume}
        <small>{workout.nominal_volume === null ? "kein Volumen" : "kg"}</small>
      </span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
  );
}

/**
 * The sets of one exercise inside one workout.
 *
 * Each row shows what was entered: its own load convention, its reps basis and,
 * for unilateral work, the side. Nothing is summed across incompatible rows.
 */
export function SetList({ sets }: { sets: readonly ViewSet[] }) {
  return (
    <table className="set-list">
      <caption className="visually-hidden">
        Sätze dieser Übung mit Gewicht, Wiederholungen und Ausführung
      </caption>
      <thead>
        <tr>
          <th scope="col">Satz</th>
          <th scope="col">Gewicht</th>
          <th scope="col">Wdh.</th>
          <th scope="col">Ausführung</th>
          <th scope="col">RPE</th>
        </tr>
      </thead>
      <tbody>
        {sets.map((set) => {
          const execution = formatExecution(set);
          return (
            <tr key={set.set_id} className={set.voided ? "voided" : ""}>
              <th scope="row">
                <span className="set-number">{set.set_number}</span>
                {set.set_type !== "working" && (
                  <span className="set-flag">
                    {SET_TYPE_LABEL[set.set_type]}
                  </span>
                )}
                {set.voided && <span className="set-flag">Verworfen</span>}
              </th>
              <td>{formatLoad(set)}</td>
              <td>{formatReps(set.reps, set.reps_basis)}</td>
              <td>{execution ?? "Beidseitig"}</td>
              <td>{set.rpe === null ? UNKNOWN : formatNumber(set.rpe, 1)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * A personal record. The load convention is always named, so a dumbbell record
 * can never be read as a total-weight record.
 */
export function RecordRow({ record }: { record: ViewRecord }) {
  const basis = record.load_basis ? LOAD_BASIS_LABEL[record.load_basis] : null;
  const execution =
    record.execution_mode && record.side
      ? formatExecution({
          execution_mode: record.execution_mode,
          side: record.side,
        })
      : null;
  return (
    <div className="record-row">
      <span className="record-dot" aria-hidden="true">
        <Trophy size={15} />
      </span>
      <span>
        <strong>{record.exercise_name}</strong>
        <small>
          {record.metric_label}
          {record.reps !== null ? ` · ${record.reps} Wdh.` : ""}
          {execution ? ` · ${execution}` : ""} · {dateLabel(record.achieved_on)}
        </small>
      </span>
      <strong className="record-value">
        {formatNumber(record.value, 1)}
        <small>
          {" "}
          {record.unit === "kg" ? "kg" : record.unit}
          {basis && record.load_basis !== "total" ? ` · ${basis}` : ""}
        </small>
      </strong>
    </div>
  );
}
