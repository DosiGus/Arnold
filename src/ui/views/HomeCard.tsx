import { Check, Play, Trophy } from "lucide-react";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import { ArnoldCard, CardActions } from "../components/cards";
import {
  FlameBadge,
  ProgressBar,
  StreakDot,
  TileHead,
  goalValue,
} from "../components/home";
import { dateLabel, formatNumber } from "../format";
import type { CardId } from "../cards";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Hallo";
  return "Guten Abend";
}

/** "3. Nov." relative to today: "heute", "gestern" or the date. */
function when(date: string, today: string) {
  if (date === today) return "heute";
  if (date === addDays(today, -1)) return "gestern";
  return dateLabel(date);
}

/**
 * The start screen: what Arnold shows when someone opens it. Four tiles, each a
 * summary and a way into the full view: training, progress, goals, records.
 */
export function HomeCard({
  view,
  canWrite,
  onOpen,
}: {
  view: ArnoldDashboardView;
  canWrite: boolean;
  onOpen: (card: CardId) => void;
}) {
  const home = view.home;
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const week =
    view.weeks.find((w) => w.is_current_week) ??
    view.weeks[view.weeks.length - 1];
  const trained = new Set(week?.trained_dates ?? []);
  const weekStart = week?.week_start ?? home.streak.weeks.at(-1)?.week_start;
  const goal = home.streak.weekly_goal;
  const daysThisWeek = home.streak.current_week_training_days;
  const next = home.next_session;
  const records = home.records.slice(0, 3);
  const goals = home.goals.slice(0, 2);
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

  return (
    <ArnoldCard
      className="ac-home"
      label={`Arnold · ${new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "short" }).format(new Date())}`}
      title={greeting()}
      subtitle={
        empty
          ? "Dein erstes Training ist der Anfang."
          : goal
            ? `Diese Woche ${daysThisWeek} von ${goal} Trainingstagen geschafft`
            : `Diese Woche ${daysThisWeek} ${daysThisWeek === 1 ? "Trainingstag" : "Trainingstage"}`
      }
    >
      <div className="ac-tile wide">
        <button
          type="button"
          className="ac-tile-hit"
          onClick={() => onOpen("week")}
          aria-label={`Training: Woche ansehen. Trainiert an ${trained.size} ${trained.size === 1 ? "Tag" : "Tagen"}.${next ? ` Als Nächstes ${next.session_name}.` : ""}`}
        >
          <TileHead>Training</TileHead>
          {weekStart && (
            <span className="ac-week compact" aria-hidden="true">
              {DAYS.map((day, i) => {
                const date = addDays(weekStart, i);
                const done = trained.has(date);
                return (
                  <span key={day} className={date === today ? "today" : ""}>
                    <i className={done ? "done" : ""}>
                      {done && (
                        <Check size={14} strokeWidth={3} aria-hidden="true" />
                      )}
                    </i>
                    {day}
                  </span>
                );
              })}
            </span>
          )}
          {next ? (
            <span className="ac-tile-next">
              <small>Als Nächstes</small>
              <strong>
                {next.session_name}{" "}
                <span className="ac-text">
                  · {next.exercise_count}{" "}
                  {next.exercise_count === 1 ? "Übung" : "Übungen"}
                </span>
              </strong>
            </span>
          ) : (
            <span className="ac-tile-next">
              <small>Noch kein Plan</small>
              <strong>Freies Training</strong>
            </span>
          )}
        </button>
        {canWrite && (
          <div className="ac-tile-action">
            <button
              type="button"
              className="ac-btn primary"
              onClick={() => onOpen("today")}
            >
              <Play size={14} fill="currentColor" aria-hidden="true" />
              {next ? `${next.session_name} starten` : "Training starten"}
            </button>
          </div>
        )}
      </div>

      <div className="ac-tile-pair">
        <button
          type="button"
          className="ac-tile"
          onClick={() => onOpen("stats")}
          aria-label={`Fortschritt: ${home.streak.current ?? 0} Wochen am Stück trainiert`}
        >
          <TileHead>Fortschritt</TileHead>
          <span className="ac-tile-number">
            <FlameBadge size="small" />
            <strong>{home.streak.current ?? 0}</strong>
            <span>{home.streak.current === 1 ? "Woche" : "Wochen"}</span>
          </span>
          <span className="ac-text">
            {goal ? "am Stück trainiert" : "Serie ab Wochenziel im Plan"}
          </span>
          <span className="ac-streak-row small" aria-hidden="true">
            {home.streak.weeks.map((w) => (
              <StreakDot key={w.week_start} week={w} goal={goal} size="small" />
            ))}
          </span>
          <span className="ac-text">
            {home.workouts_this_year}{" "}
            {home.workouts_this_year === 1 ? "Einheit" : "Einheiten"} in{" "}
            {home.year}
          </span>
        </button>

        <button
          type="button"
          className="ac-tile"
          onClick={() => onOpen("goals")}
          aria-label={`Ziele ansehen. ${goals.map((g) => `${g.name} ${g.progress === null ? "" : `${Math.round(g.progress * 100)} Prozent`}`).join(", ")}`}
        >
          <TileHead>Ziele</TileHead>
          {goals.length ? (
            goals.map((g) => (
              <span className="ac-tile-goal" key={g.goal_id}>
                <span>
                  <strong>{g.name}</strong>
                  <span className="ac-text">
                    {g.progress === null
                      ? "–"
                      : `${Math.round(g.progress * 100)} %`}
                  </span>
                </span>
                <ProgressBar
                  value={g.progress}
                  label={`${g.name} Fortschritt`}
                />
                <small className="ac-text">
                  {goalValue(g, g.current_value)} →{" "}
                  {goalValue(g, g.target_value)}
                </small>
              </span>
            ))
          ) : (
            <span className="ac-text">
              Setz dir ein Ziel, etwa ein Zielgewicht oder 100 kg Bankdrücken.
            </span>
          )}
          {home.goals.length > 2 && (
            <small className="ac-text">+ {home.goals.length - 2} weitere</small>
          )}
        </button>
      </div>

      <button
        type="button"
        className="ac-tile wide"
        onClick={() => onOpen("records")}
        aria-label={`Alle Rekorde ansehen. ${records.map((r) => `${r.exercise_name} ${recordValue(r)}`).join(", ")}`}
      >
        <TileHead>
          Rekorde
          {home.records.length > 0 && (
            <span className="ac-tile-count"> · {home.records.length}</span>
          )}
        </TileHead>
        {records.length ? (
          <span className="ac-tile-records">
            {records.map((r, i) => (
              <span className="ac-tile-record" key={r.key}>
                <span className={`ac-medal ${i === 0 ? "fresh" : ""}`}>
                  <Trophy size={15} aria-hidden="true" />
                </span>
                <span>
                  <strong>{r.exercise_name}</strong>
                  <small className="ac-text">
                    {when(r.achieved_on, today)}
                  </small>
                </span>
                <strong>{recordValue(r)}</strong>
              </span>
            ))}
          </span>
        ) : (
          <span className="ac-text">
            Mehr Gewicht oder mehr Wiederholungen als bisher: Rekorde erscheinen
            hier.
          </span>
        )}
      </button>

      {empty && canWrite && (
        <CardActions
          primary={{
            label: "Erstes Training starten",
            onClick: () => onOpen("today"),
          }}
        />
      )}
    </ArnoldCard>
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
