import { useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Plus,
} from "lucide-react";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import type { WorkoutContext } from "../../shared/workout-contract";
import { ArnoldCard } from "../components/cards";
import { ProgressBar, goalValue } from "../components/home";
import { dateLabel, formatNumber } from "../format";
import { draftFromProposal, exerciseLine } from "../workout-draft";
import type { CardId } from "../cards";

export type HomeFocus = {
  fresh?: boolean;
  workout_id?: string;
  goal_id?: string;
  newGoal?: boolean;
};
const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function Widget({
  name,
  className = "",
  title,
  aside,
  children,
}: {
  name: string;
  className?: string;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`ac ac-widget ${className}`} aria-label={name}>
      <div className="ac-widget-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Real server data, with illustrative scores kept explicitly separate. */
export function HomeCard({
  view,
  canWrite,
  workoutContext,
  onOpen,
}: {
  view: ArnoldDashboardView;
  canWrite: boolean;
  workoutContext?: WorkoutContext | null;
  onOpen: (card: CardId, focus?: HomeFocus) => void;
}) {
  const [recordKey, setRecordKey] = useState<string>();
  const [scoreInfo, setScoreInfo] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);
  const home = view.home;
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const doneToday = view.recent_workouts.find(
    (w) => w.status === "completed" && w.date === today,
  );
  const week = view.weeks.find((w) => w.is_current_week);
  const weekStart =
    week?.week_start ??
    home.streak.weeks.find((w) => w.is_current_week)?.week_start;
  const trained = new Set(week?.trained_dates ?? []);
  const goal = home.streak.weekly_goal;
  const days = home.streak.current_week_training_days;
  const next = home.next_session;
  const proposal = workoutContext?.proposals.find(
    (p) => p.session_id === next?.session_id,
  );
  const preview = proposal ? draftFromProposal(proposal).exercises : [];
  const records = home.records.slice(0, 3);
  const recordIndex = Math.max(
    0,
    records.findIndex((r) => r.key === recordKey),
  );
  const record = records[recordIndex];
  const goals = home.goals.slice(0, 4);
  const empty =
    view.state === "empty_history" || view.state === "empty_catalog";
  const moveRecord = (direction: number) =>
    setRecordKey(
      records[(recordIndex + direction + records.length) % records.length]?.key,
    );
  if (view.state === "master_template")
    return (
      <ArnoldCard
        label="Master-Vorlage"
        title="Platz für deinen Fortschritt"
        subtitle="Diese Vorlage enthält keine persönlichen Trainingsdaten."
      />
    );

  return (
    <section className="ac-dashboard" aria-label="Dein Überblick">
      <header className="ac-dashboard-head">
        <div>
          <h2>Dein Überblick</h2>
          <p>
            {new Intl.DateTimeFormat("de-DE", {
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(new Date())}
          </p>
        </div>
        {view.source.synthetic && (
          <span className="ac-caption">Beispieldaten</span>
        )}
      </header>
      {empty && <p className="ac-text">Dein erstes Training ist der Anfang.</p>}
      <div className="ac-widget-grid">
        <Widget
          name="Dein Training"
          className="ac-widget-training"
          title={doneToday?.title ?? next?.session_name ?? "Dein Training"}
          aside={
            <span className="ac-pill muted">
              {doneToday ? "Gespeichert" : next ? "Als Nächstes" : "Ohne Plan"}
            </span>
          }
        >
          <p className="ac-text">
            {doneToday
              ? `${doneToday.exercise_count} Übungen · ${doneToday.working_set_count} Arbeitssätze`
              : next
                ? `${next.exercise_count} ${next.exercise_count === 1 ? "Übung" : "Übungen"}${proposal ? " · Arnolds Vorschlag" : ""}`
                : "Freies Training"}
          </p>
          {doneToday ? (
            <div className="ac-widget-saved">
              <Check size={19} aria-hidden="true" />
              <span>Training gespeichert</span>
            </div>
          ) : preview.length ? (
            <ul className="ac-widget-exercises" aria-label="Nächstes Training">
              {preview.slice(0, 4).map((e) => (
                <li key={e.key}>
                  <span>{e.exercise_name}</span>
                  <span>{exerciseLine(e)}</span>
                </li>
              ))}
              {preview.length > 4 && (
                <li className="ac-text">
                  + {preview.length - 4} weitere Übungen
                </li>
              )}
            </ul>
          ) : (
            <p className="ac-widget-empty ac-text">
              {next
                ? "Öffne dein Training für Übungen, Sätze und empfohlene Gewichte."
                : "Erstelle deinen Plan oder erfasse ein freies Training im Chat."}
            </p>
          )}
          <div className="ac-widget-training-actions">
            <button
              type="button"
              className="ac-btn primary"
              onClick={() => onOpen("today")}
            >
              {doneToday || !canWrite
                ? "Training ansehen"
                : next
                  ? "Training bearbeiten"
                  : "Erstes Training starten"}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ac-link"
              onClick={() => onOpen("plan")}
            >
              {!canWrite
                ? "Plan ansehen"
                : view.active_plan
                  ? "Plan bearbeiten"
                  : "Plan anlegen"}
            </button>
          </div>
          {doneToday && canWrite && (
            <button
              type="button"
              className="ac-link"
              onClick={() => onOpen("today", { fresh: true })}
            >
              Noch ein Training
            </button>
          )}
        </Widget>
        <Widget
          name="Deine Woche"
          className="ac-widget-week"
          title="Woche"
          aside={
            <button
              type="button"
              className="ac-widget-icon"
              aria-label="Trainingswoche aufklappen"
              aria-expanded={weekOpen}
              onClick={() => setWeekOpen((v) => !v)}
            >
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          }
        >
          <div className="ac-widget-week-total">
            <span
              className={`ac-widget-ring ${goal ? "" : "no-goal"}`}
              style={
                {
                  "--ring-angle": `${goal ? Math.min(1, days / goal) * 360 : 0}deg`,
                } as CSSProperties
              }
              aria-label={
                goal
                  ? `${days} von ${goal} Trainingstagen`
                  : `${days} Trainingstage`
              }
            >
              {days}
              {goal ? <span> / {goal}</span> : null}
            </span>
            <span className="ac-caption">
              {days === 1 && !goal ? "Trainingstag" : "Trainingstage"}
            </span>
          </div>
          {weekStart && (
            <div
              className="ac-widget-week-days"
              aria-label="Trainingstage dieser Woche"
            >
              {DAYS.map((day, i) => {
                const date = addDays(weekStart, i);
                return (
                  <span
                    key={date}
                    className={`${trained.has(date) ? "done" : ""} ${date === today ? "today" : ""}`}
                    aria-label={`${dateLabel(date)}${trained.has(date) ? ", trainiert" : ""}${date === today ? ", heute" : ""}`}
                  >
                    {day}
                    <i>{Number(date.slice(-2))}</i>
                  </span>
                );
              })}
            </div>
          )}
          {weekOpen && (
            <p className="ac-widget-week-detail ac-caption">
              {goal
                ? `${days} von ${goal} geplanten Trainingstagen erreicht.`
                : "Ein Wochenziel kannst du in deinem Plan festlegen."}{" "}
              {week?.workouts ?? 0}{" "}
              {(week?.workouts ?? 0) === 1 ? "Einheit" : "Einheiten"} diese
              Woche.
            </p>
          )}
          <button
            type="button"
            className="ac-widget-link"
            onClick={() => onOpen("history")}
          >
            Alle Einheiten
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </Widget>
        <Widget
          name="Demo-Scores"
          className="ac-widget-scores"
          title="Demo-Scores"
          aside={
            <button
              type="button"
              className="ac-widget-icon"
              aria-label="Über die Demo-Scores"
              aria-expanded={scoreInfo}
              onClick={() => setScoreInfo((v) => !v)}
            >
              <Info size={14} aria-hidden="true" />
            </button>
          }
        >
          <div className="ac-demo-scores">
            {[
              { name: "Konstanz", value: 92 },
              { name: "Recovery", value: 72 },
              { name: "Progress", value: 77 },
            ].map((s) => (
              <div className="ac-demo-score" key={s.name}>
                <span>{s.name}</span>
                <span
                  className="ac-widget-ring"
                  style={
                    { "--ring-angle": `${s.value * 3.6}deg` } as CSSProperties
                  }
                  role="img"
                  aria-label={`${s.name}: ${s.value} von 100, Demo-Wert`}
                >
                  {s.value}
                </span>
                <small>Demo</small>
              </div>
            ))}
          </div>
          {scoreInfo && (
            <p className="ac-caption">
              Alle drei Scores sind frei gewählte Demo-Werte. Ihre Berechnung
              folgt später. Es ist noch kein Health-Gerät angebunden.
            </p>
          )}
        </Widget>
        <Widget
          name="Deine Ziele"
          className="ac-widget-goals"
          title={
            <button
              type="button"
              className="ac-widget-heading-link"
              onClick={() => onOpen("goals")}
              aria-label="Alle Ziele ansehen"
            >
              Deine Ziele
            </button>
          }
          aside={
            home.goals.length ? (
              <span className="ac-caption">
                {home.goals.length} {home.goals.length === 1 ? "Ziel" : "Ziele"}
              </span>
            ) : undefined
          }
        >
          {goals.length ? (
            <div className="ac-widget-goal-list">
              {goals.map((g) => (
                <button
                  type="button"
                  className="ac-widget-goal"
                  key={g.goal_id}
                  onClick={() => onOpen("goals", { goal_id: g.goal_id })}
                  aria-label={`${g.name}: ${g.progress === null ? "noch kein Messwert" : `${Math.round(g.progress * 100)} Prozent`}. Details öffnen`}
                >
                  <span className="ac-widget-goal-head">
                    <strong>{g.name}</strong>
                    <span>
                      {goalValue(g, g.current_value, true)} /{" "}
                      {goalValue(g, g.target_value, true)}
                    </span>
                  </span>
                  <ProgressBar
                    value={g.progress}
                    label={`${g.name} Fortschritt`}
                  />
                  {g.achieved && (
                    <small className="ac-caption">Ziel erreicht</small>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="ac-widget-empty ac-text">
              Setz dir ein Ziel und verfolge deinen Fortschritt.
            </p>
          )}
          {home.goals.length > 4 && (
            <button
              type="button"
              className="ac-link"
              onClick={() => onOpen("goals")}
            >
              Alle {home.goals.length} Ziele ansehen
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              className="ac-widget-add"
              onClick={() => onOpen("goals", { newGoal: true })}
            >
              <Plus size={15} aria-hidden="true" />
              Ziel hinzufügen
            </button>
          )}
        </Widget>
        <Widget
          name="Deine Rekorde"
          className="ac-widget-record"
          title={
            <button
              type="button"
              className="ac-widget-heading-link"
              onClick={() => onOpen("records")}
              aria-label="Alle Rekorde ansehen"
            >
              Rekorde
            </button>
          }
          aside={
            records.length ? (
              <span className="ac-caption" aria-live="polite">
                {recordIndex + 1} / {records.length}
              </span>
            ) : undefined
          }
        >
          {record ? (
            <>
              <div
                className="ac-widget-record-body"
                aria-live="polite"
                aria-atomic="true"
              >
                <p className="ac-widget-record-name">{record.exercise_name}</p>
                <p
                  className="ac-widget-record-number"
                  aria-label={recordValue(record)}
                >
                  <strong>
                    {formatNumber(
                      record.metric === "max_load"
                        ? (record.load_kg ?? record.value)
                        : record.value,
                      2,
                    )}
                  </strong>
                  <span>
                    {record.metric === "max_load"
                      ? `kg${record.reps === null ? "" : ` × ${formatNumber(record.reps, 0)}`}`
                      : record.metric === "max_reps_bodyweight"
                        ? "Wdh."
                        : `Wdh. bei ${record.load_kg === null ? "–" : formatNumber(record.load_kg, 2)} kg`}
                  </span>
                </p>
                <p className="ac-caption">
                  {record.metric === "max_reps_bodyweight"
                    ? "Körpergewicht"
                    : record.load_basis === "per_implement"
                      ? "Gewicht pro Hantel"
                      : record.load_basis === "machine_display"
                        ? "Gewicht laut Anzeige"
                        : record.load_basis === "added"
                          ? "Zusatzgewicht"
                          : record.load_basis === "assistance"
                            ? "Unterstützung"
                            : "Gesamtgewicht"}
                </p>
                <p className="ac-caption">{dateLabel(record.achieved_on)}</p>
              </div>
              <div className="ac-widget-record-actions">
                <button
                  type="button"
                  className="ac-link"
                  onClick={() =>
                    onOpen("history", { workout_id: record.workout_id })
                  }
                >
                  Training ansehen
                </button>
                {records.length > 1 && (
                  <div className="ac-widget-record-nav">
                    <button
                      type="button"
                      className="ac-widget-icon"
                      aria-label="Vorheriger Rekord"
                      onClick={() => moveRecord(-1)}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ac-widget-icon"
                      aria-label="Nächster Rekord"
                      onClick={() => moveRecord(1)}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="ac-widget-empty ac-text">
              Deine persönlichen Bestwerte erscheinen hier, sobald du
              Fortschritte machst.
            </p>
          )}
        </Widget>
      </div>
      <button
        type="button"
        className="ac-link ac-dashboard-progress"
        onClick={() => onOpen("stats")}
      >
        Trainingsentwicklung ansehen
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>
    </section>
  );
}

/** "85 kg × 8", "24 kg pro Hantel × 12", "7 Wdh.". */
export function recordValue(record: {
  metric: string;
  value: number;
  load_kg: number | null;
  reps: number | null;
  load_basis: string;
}): string {
  if (record.metric === "max_reps_bodyweight")
    return `${formatNumber(record.value, 0)} Wdh.`;
  const load =
    record.load_kg === null ? "–" : `${formatNumber(record.load_kg, 2)} kg`;
  const basis = record.load_basis === "per_implement" ? " pro Hantel" : "";
  return record.reps === null
    ? `${load}${basis}`
    : `${load}${basis} × ${formatNumber(record.reps, 0)}`;
}
