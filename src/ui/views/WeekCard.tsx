import { Check, Trophy } from "lucide-react";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import {
  ArnoldCard,
  CardActions,
  CardNote,
  StatGrid,
} from "../components/cards";
import { dateLabel, formatNumber, UNKNOWN } from "../format";
import type { CardId } from "../cards";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * "Wie war meine Woche?" — the current week in one card. All numbers come from
 * the engine's week row; the strip only marks the days that have a workout.
 */
export function WeekCard({
  view,
  canWrite,
  onOpen,
}: {
  view: ArnoldDashboardView;
  canWrite: boolean;
  onOpen: (card: CardId) => void;
}) {
  if (view.state === "master_template")
    return (
      <ArnoldCard
        label="Master-Vorlage"
        title="Platz für deinen Fortschritt"
        subtitle="Diese Vorlage enthält keine persönlichen Trainingsdaten."
      />
    );
  if (view.state === "empty_history" || view.state === "empty_catalog")
    return (
      <ArnoldCard
        label="Dein Anfang"
        title="Willkommen bei Arnold"
        subtitle="Dein erstes Training ist der Anfang."
      >
        {canWrite && (
          <CardActions
            primary={{
              label: "Training starten",
              onClick: () => onOpen("today"),
            }}
          />
        )}
      </ArnoldCard>
    );

  const week =
    view.weeks.find((w) => w.is_current_week) ??
    view.weeks[view.weeks.length - 1];
  const trained = new Set(
    view.recent_workouts
      .filter((w) => w.status === "completed")
      .map((w) => w.date),
  );
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const goal = view.active_plan?.days_per_week ?? null;
  const last = view.recent_workouts.find((w) => w.status === "completed");
  const record = [...view.records]
    .filter((r) => r.kind === "improvement")
    .sort((a, b) => b.achieved_on.localeCompare(a.achieved_on))[0];
  const warnings = view.notices.filter((n) => n.severity === "warning");
  const workouts = week?.workouts ?? 0;

  return (
    <ArnoldCard
      label={
        week?.is_current_week ? "Diese Woche" : `Woche ${week?.label ?? ""}`
      }
      title={
        goal
          ? `${workouts} von ${goal} Trainings`
          : `${workouts} ${workouts === 1 ? "Training" : "Trainings"}`
      }
      subtitle={
        last ? `Zuletzt: ${last.title} · ${dateLabel(last.date)}` : undefined
      }
    >
      {week && (
        <ol className="ac-week" aria-label="Trainingstage dieser Woche">
          {DAYS.map((day, i) => {
            const date = addDays(week.week_start, i);
            const done = trained.has(date);
            return (
              <li
                key={day}
                className={date === today ? "today" : ""}
                aria-label={`${day}${done ? ", trainiert" : ""}`}
              >
                <i className={done ? "done" : ""}>
                  {done && <Check size={14} aria-hidden="true" />}
                </i>
                {day}
              </li>
            );
          })}
        </ol>
      )}
      {week && (
        <StatGrid
          items={[
            { label: "Arbeitssätze", value: week.working_sets },
            {
              label: "kg Volumen",
              value:
                week.nominal_volume === null
                  ? UNKNOWN
                  : formatNumber(week.nominal_volume, 0),
            },
          ]}
        />
      )}
      {record && (
        <div className="ac-highlight">
          <span className="ac-medal">
            <Trophy size={16} aria-hidden="true" />
          </span>
          <span>
            <strong>
              {record.exercise_name} · {formatNumber(record.value, 1)}{" "}
              {record.unit === "reps" ? "Wdh." : record.unit}
            </strong>
            <br />
            <span className="ac-text">
              Letzter Rekord · {dateLabel(record.achieved_on)}
            </span>
          </span>
        </div>
      )}
      {warnings.map((notice) => (
        <CardNote key={notice.code}>{notice.title}</CardNote>
      ))}
      <CardActions
        primary={{ label: "Fortschritt", onClick: () => onOpen("progress") }}
        secondary={{ label: "Verlauf", onClick: () => onOpen("history") }}
      />
    </ArnoldCard>
  );
}
