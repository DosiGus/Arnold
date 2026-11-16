import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronDown, Plus } from "lucide-react";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import type { WorkoutContext } from "../../shared/workout-contract";
import { ArnoldCard } from "../components/cards";
import { CardTag, SayHint } from "../components/conversation-cards";
import { ProgressBar, goalValue } from "../components/home";
import { HomeActions } from "../components/home-actions";
import { HomeNextRun } from "../components/home-run";
import { useNoRunProfile } from "../components/run-offer";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { dateLabel, formatNumber } from "../format";
import type { CardId } from "../cards";

export type HomeFocus = {
  fresh?: boolean;
  workout_id?: string;
  goal_id?: string;
  newGoal?: boolean;
};
export type HomeTile = "week" | "scores" | "goals" | "records";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DEMO_SCORES = [
  { name: "Konstanz", value: 92 },
  { name: "Recovery", value: 72 },
  { name: "Progress", value: 77 },
];
function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const basisLabel = (r: { metric: string; load_basis: string }): string =>
  r.metric === "max_reps_bodyweight"
    ? "Körpergewicht"
    : r.load_basis === "per_implement"
      ? "Gewicht pro Hantel"
      : r.load_basis === "machine_display"
        ? "Gewicht laut Anzeige"
        : r.load_basis === "added"
          ? "Zusatzgewicht"
          : r.load_basis === "assistance"
            ? "Unterstützung"
            : "Gesamtgewicht";

/** Real server data, with illustrative scores kept explicitly separate. */
export function HomeCard({
  view,
  canWrite,
  workoutContext,
  client,
  onOpen,
  defaultOpen,
}: {
  view: ArnoldDashboardView;
  canWrite: boolean;
  workoutContext?: WorkoutContext | null;
  /** Reads the next run and sends chat sentences; without it: strength only. */
  client?: ArnoldMcpClient;
  onOpen: (card: CardId, focus?: HomeFocus) => void;
  /** Tile whose detail starts open (tests and previews). */
  defaultOpen?: HomeTile;
}) {
  const [open, setOpen] = useState<HomeTile | undefined>(defaultOpen);
  const panelId = useId();
  const noRunProfile = useNoRunProfile(client);
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
  const hasProposal = Boolean(
    workoutContext?.proposals.some((p) => p.session_id === next?.session_id),
  );
  const records = home.records.slice(0, 3);
  const goals = home.goals.slice(0, 4);
  const empty =
    view.state === "empty_history" || view.state === "empty_catalog";
  if (view.state === "master_template")
    return (
      <ArnoldCard
        label="Master-Vorlage"
        title="Platz für deinen Fortschritt"
        subtitle="Diese Vorlage enthält keine persönlichen Trainingsdaten."
      />
    );

  const toggle = (tile: HomeTile) =>
    setOpen((current) => (current === tile ? undefined : tile));
  const tiles: {
    key: HomeTile;
    label: string;
    value: ReactNode;
    sub: ReactNode;
  }[] = [
    {
      key: "week",
      label: "Woche",
      value: (
        <span className="ac-widget-week-total">
          <span
            className={`ac-widget-ring ${goal ? "" : "no-goal"}`}
            style={
              {
                "--ring-angle": `${goal ? Math.min(1, days / goal) * 360 : 0}deg`,
              } as CSSProperties
            }
            role="img"
            aria-label={
              goal
                ? `${days} von ${goal} Trainingstagen`
                : `${days} Trainingstage`
            }
          >
            {days}
            {goal ? <span> / {goal}</span> : null}
          </span>
        </span>
      ),
      sub: days === 1 && !goal ? "Trainingstag" : "Trainingstage",
    },
    {
      key: "scores",
      label: "Scores",
      value: (
        <span className="ac-home-tile-figure">
          {DEMO_SCORES.map((s) => s.value).join(" · ")}
        </span>
      ),
      sub: "Demo-Werte",
    },
    {
      key: "goals",
      label: "Ziele",
      value: (
        <span className="ac-home-tile-figure">
          {home.goals.length ? home.goals.length : "–"}
        </span>
      ),
      sub: home.goals.length
        ? home.goals.length === 1
          ? "Ziel"
          : "Ziele"
        : "Noch keine Ziele",
    },
    {
      key: "records",
      label: "Rekorde",
      value: records[0] ? (
        <span className="ac-home-tile-figure small">
          {recordValue(records[0])}
        </span>
      ) : (
        <span className="ac-home-tile-figure">–</span>
      ),
      sub: records[0] ? records[0].exercise_name : "Noch keine Rekorde",
    },
  ];

  return (
    <section className="ac-dashboard" aria-label="Dein Überblick">
      <section className="ac ac-home">
        <header className="ac-dashboard-head">
          <h2>Dein Überblick</h2>
          {view.source.synthetic && (
            <span className="ac-caption">Beispieldaten</span>
          )}
        </header>
        {empty && (
          <p className="ac-text">Dein erstes Training ist der Anfang.</p>
        )}
        <section className="ac-home-next" aria-label="Dein Training">
          <CardTag>
            {doneToday
              ? doneToday.from_watch
                ? "Von der Uhr"
                : "Gespeichert"
              : next
                ? "Als Nächstes"
                : "Ohne Plan"}
          </CardTag>
          <h3>{doneToday?.title ?? next?.session_name ?? "Dein Training"}</h3>
          <p className="ac-caption">
            {doneToday
              ? `${doneToday.exercise_count} Übungen · ${doneToday.working_set_count} Arbeitssätze`
              : next
                ? `${next.exercise_count} ${next.exercise_count === 1 ? "Übung" : "Übungen"}${hasProposal ? " · Arnolds Vorschlag" : ""}`
                : "Erstelle deinen Plan oder erfasse ein freies Training im Chat."}
          </p>
          {doneToday && (
            <p className="ac-home-saved">
              <Check size={16} aria-hidden="true" />
              Training gespeichert
            </p>
          )}
          {client && (
            <HomeNextRun
              client={client}
              onOpenRun={(card) => void client.openRun(card).catch(() => {})}
            />
          )}
          <div className="ac-home-links">
            <button
              type="button"
              className="ac-link"
              onClick={() => onOpen("today")}
            >
              {doneToday || !canWrite
                ? "Training ansehen"
                : next
                  ? "Training bearbeiten"
                  : "Erstes Training starten"}
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
            {doneToday && canWrite && (
              <button
                type="button"
                className="ac-link"
                onClick={() => onOpen("today", { fresh: true })}
              >
                Noch ein Training
              </button>
            )}
          </div>
        </section>

        <div className="ac-home-tiles">
          {tiles.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`ac-home-tile ${open === t.key ? "open" : ""}`}
              aria-expanded={open === t.key}
              aria-controls={panelId}
              onClick={() => toggle(t.key)}
            >
              <span className="ac-home-tile-head">
                <span>{t.label}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </span>
              {t.value}
              <span className="ac-caption">{t.sub}</span>
            </button>
          ))}
        </div>
        <div id={panelId} className="ac-home-panel">
          {open === "week" && (
            <section className="ac-home-detail" aria-label="Woche im Detail">
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
              <p className="ac-text">
                {goal
                  ? `${days} von ${goal} geplanten Trainingstagen erreicht.`
                  : "Ein Wochenziel kannst du in deinem Plan festlegen."}{" "}
                {week?.workouts ?? 0}{" "}
                {(week?.workouts ?? 0) === 1 ? "Einheit" : "Einheiten"} diese
                Woche.
              </p>
              <SayHint>Zeig mir meine Einheiten dieser Woche.</SayHint>
              <button
                type="button"
                className="ac-link ac-home-deep"
                onClick={() => onOpen("history")}
              >
                Alle Einheiten
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            </section>
          )}
          {open === "scores" && (
            <section
              className="ac-home-detail"
              aria-label="Demo-Scores im Detail"
            >
              <div className="ac-demo-scores">
                {DEMO_SCORES.map((s) => (
                  <div className="ac-demo-score" key={s.name}>
                    <span>{s.name}</span>
                    <span
                      className="ac-widget-ring"
                      style={
                        {
                          "--ring-angle": `${s.value * 3.6}deg`,
                        } as CSSProperties
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
              <p className="ac-text">
                Alle drei Scores sind frei gewählte Demo-Werte. Ihre Berechnung
                folgt später. Es ist noch kein Health-Gerät angebunden.
              </p>
              <SayHint>Wie entwickelt sich mein Training?</SayHint>
              <button
                type="button"
                className="ac-link ac-home-deep"
                onClick={() => onOpen("stats")}
              >
                Trainingsentwicklung ansehen
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            </section>
          )}
          {open === "goals" && (
            <section className="ac-home-detail" aria-label="Ziele im Detail">
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
                <p className="ac-text">
                  Setz dir ein Ziel und verfolge deinen Fortschritt.
                </p>
              )}
              <SayHint>Ich möchte beim Bankdrücken auf 90 Kilo kommen.</SayHint>
              <div className="ac-home-links">
                <button
                  type="button"
                  className="ac-link ac-home-deep"
                  onClick={() => onOpen("goals")}
                >
                  {home.goals.length > 4
                    ? `Alle ${home.goals.length} Ziele ansehen`
                    : "Alle Ziele ansehen"}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
                {canWrite && (
                  <button
                    type="button"
                    className="ac-link ac-home-deep"
                    onClick={() => onOpen("goals", { newGoal: true })}
                  >
                    <Plus size={14} aria-hidden="true" />
                    Ziel hinzufügen
                  </button>
                )}
              </div>
            </section>
          )}
          {open === "records" && (
            <section className="ac-home-detail" aria-label="Rekorde im Detail">
              {records.length ? (
                <ul className="ac-home-records">
                  {records.map((r) => (
                    <li key={r.key}>
                      <span className="ac-widget-record-name">
                        {r.exercise_name}
                      </span>
                      <strong aria-label={recordValue(r)}>
                        {recordValue(r)}
                      </strong>
                      <span className="ac-caption">
                        {basisLabel(r)} · {dateLabel(r.achieved_on)}
                      </span>
                      <button
                        type="button"
                        className="ac-link"
                        aria-label={`Training ansehen: ${r.exercise_name}`}
                        onClick={() =>
                          onOpen("history", { workout_id: r.workout_id })
                        }
                      >
                        Training ansehen
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ac-text">
                  Noch keine Rekorde. Deine persönlichen Bestwerte erscheinen
                  hier, sobald du Fortschritte machst.
                </p>
              )}
              <SayHint>Zeig mir meine Rekorde beim Kniebeugen.</SayHint>
              <button
                type="button"
                className="ac-link ac-home-deep"
                onClick={() => onOpen("records")}
              >
                Alle Rekorde ansehen
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            </section>
          )}
        </div>
        <button
          type="button"
          className="ac-link ac-dashboard-progress"
          onClick={() => onOpen("stats")}
        >
          Trainingsentwicklung ansehen
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
        {client && noRunProfile && (
          <p className="ac-home-runoffer">
            <button
              type="button"
              className="ac-link"
              onClick={() => void client.openRun("run_setup")}
            >
              Ich will auch laufen
            </button>
          </p>
        )}
      </section>
      <HomeActions
        client={client}
        canWrite={canWrite}
        onFallback={(key) =>
          onOpen(key === "next" ? "today" : key === "plan" ? "plan" : "goals")
        }
      />
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
