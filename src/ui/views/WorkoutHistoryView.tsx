import { useEffect, useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import type {
  ArnoldDashboardView,
  ViewWorkoutDetail,
} from "../../shared/arnold-view";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useAsync, useWorkoutHistory } from "../hooks";
import { useModelContext } from "../hooks/useModelContext";
import { ArnoldCard, CardSkeleton } from "../components/cards";
import { DetailHead } from "../components/home";
import { RecoveryCard } from "../components/recovery";
import { exerciseSummary } from "../workout-draft";

const PAGE = 12;
const WEEKDAY = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  timeZone: "UTC",
});
const DAY_MONTH = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const MONTH = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  timeZone: "UTC",
});

const at = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`);
function addDays(isoDate: string, days: number) {
  const date = at(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** The Monday of the calendar week a local date falls in. */
function weekOf(isoDate: string) {
  return addDays(isoDate, -((at(isoDate).getUTCDay() + 6) % 7));
}
function weekLabel(start: string, thisWeek: string) {
  if (start === thisWeek) return "Diese Woche";
  if (start === addDays(thisWeek, -7)) return "Letzte Woche";
  const end = addDays(start, 6);
  return start.slice(5, 7) === end.slice(5, 7)
    ? `${at(start).getUTCDate()}.–${at(end).getUTCDate()}. ${MONTH.format(at(end))}`
    : `${DAY_MONTH.format(at(start))}–${DAY_MONTH.format(at(end))}`;
}

/** One exercise of a saved workout as one line: "3 × 8 · 62,5 kg". */
function exerciseLine(block: ViewWorkoutDetail["exercises"][number]) {
  const sets = block.sets.filter((s) => !s.voided && s.set_type === "working");
  if (!sets.length) return undefined;
  const first = sets[0];
  const summary = exerciseSummary({
    conventions: {
      load_basis: first.load_basis,
      execution_mode: first.execution_mode,
      implement_count: first.implement_count,
      reps_basis: first.reps_basis,
    },
    sets: sets.map((s) => ({
      reps: s.reps,
      load_kg: s.load_basis === "bodyweight_only" ? null : s.load_kg,
      side: s.side,
    })),
  });
  return `${summary.volume} · ${summary.load}`;
}

/**
 * "Alle Einheiten": the saved workouts by calendar week, newest first. A row
 * opens in place to show its exercises; a record is marked where it was set.
 * Deliberately plain: no filters, more on request.
 */
export function WorkoutHistoryView({
  client,
  dashboard,
  initialWorkoutId,
  onBack,
}: {
  client: ArnoldMcpClient;
  dashboard: ArnoldDashboardView;
  initialWorkoutId?: string;
  onBack?: () => void;
}) {
  const home = dashboard.home;
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const thisWeek = weekOf(today);
  const [open, setOpen] = useState<string | undefined>(initialWorkoutId);
  // Opened on one workout (from a record): the list starts at its date.
  const direct = useAsync(
    () =>
      initialWorkoutId
        ? client.historyWorkout(initialWorkoutId)
        : Promise.resolve(undefined),
    [client, initialWorkoutId],
  );
  const anchor = direct.data?.workouts.find(
    (w) => w.workout_id === initialWorkoutId,
  )?.date;
  const [fromNewest, setFromNewest] = useState(false);
  const to = fromNewest ? undefined : anchor;
  const [offset, setOffset] = useState(0);
  const [shown, setShown] = useState<ViewWorkoutDetail[]>([]);
  const waiting = !!initialWorkoutId && direct.loading;
  const history = useWorkoutHistory(client, {
    ...(to ? { to } : {}),
    // A query that waits for the anchor would only be thrown away.
    ...(waiting ? { limit: 1 } : { limit: PAGE }),
    offset,
  });
  // Pages add up; a new starting point starts over.
  useEffect(() => {
    setOffset(0);
    setShown([]);
  }, [to]);
  useEffect(() => {
    const page = history.data?.workouts;
    if (!page || waiting) return;
    setShown((current) => {
      const known = new Set(current.map((w) => w.workout_id));
      return offset === 0
        ? page
        : [...current, ...page.filter((w) => !known.has(w.workout_id))];
    });
  }, [history.data, offset, waiting]);

  const recordWorkouts = new Set(home.records.map((r) => r.workout_id));
  const recordAt = (workoutId: string, exerciseId: string) =>
    home.records.some(
      (r) => r.workout_id === workoutId && r.exercise_id === exerciseId,
    );
  // The workout asked for is listed even when the list leaves it out (an
  // open or cancelled one), in its place by date.
  const asked = direct.data?.workouts.find(
    (w) => w.workout_id === initialWorkoutId,
  );
  const rows =
    asked &&
    !fromNewest &&
    !shown.some((w) => w.workout_id === asked.workout_id)
      ? [...shown, asked].sort((a, b) => b.date.localeCompare(a.date))
      : shown;
  const selected = rows.find((w) => w.workout_id === open);
  useModelContext(
    client,
    selected
      ? `Arnold zeigt im Verlauf das Training „${selected.title}“ am ${selected.date}, workout_id ${selected.workout_id}. Gespeicherte Sätze: ${JSON.stringify(selected.exercises.map((block) => ({ exercise: block.name, sets: block.sets })))}. Die Karte zeigt diese Werte bereits. Für Korrekturen aktuelle Revision mit get_workout lesen.`
      : `Arnold zeigt alle Einheiten nach Wochen${history.data ? `, ${history.data.total} insgesamt` : ""}. Der Nutzer kann eine Einheit aufklappen oder im Chat nach einem Datum fragen.`,
  );

  if (history.error)
    return (
      <RecoveryCard
        recovery={history.failure?.recovery ?? "retry_same_request"}
        onAction={history.reload}
      />
    );
  if (!history.data || waiting || (!shown.length && history.loading && !asked))
    return <CardSkeleton />;

  const weeks = new Map<string, ViewWorkoutDetail[]>();
  for (const workout of rows) {
    const start = weekOf(workout.date);
    weeks.set(start, [...(weeks.get(start) ?? []), workout]);
  }
  const goal = home.streak.weekly_goal;
  const weekCount = (start: string, rows: number) => {
    const days = home.streak.weeks.find(
      (w) => w.week_start === start,
    )?.training_days;
    if (days === undefined)
      return `${rows} ${rows === 1 ? "Einheit" : "Einheiten"}`;
    return goal
      ? `${days} von ${goal} Tagen`
      : `${days} ${days === 1 ? "Trainingstag" : "Trainingstage"}`;
  };
  const total = history.data.total;

  return (
    <ArnoldCard aria-label="Alle Einheiten" busy={history.loading}>
      <DetailHead crumb="Übersicht · Einheiten" onBack={onBack} />
      <div>
        <h2 className="ac-title">
          {total || rows.length ? "Deine Einheiten" : "Noch keine Einheiten"}
        </h2>
        <p className="ac-sub">
          {to
            ? `Ab ${DAY_MONTH.format(at(to))} zurück`
            : total
              ? `${total} ${total === 1 ? "Einheit" : "Einheiten"} gespeichert`
              : "Dein erstes gespeichertes Training erscheint hier."}
        </p>
      </div>
      {to && (
        <button
          type="button"
          className="ac-link ac-history-newest"
          onClick={() => setFromNewest(true)}
        >
          Neueste Einheiten zeigen
        </button>
      )}
      {[...weeks.entries()].map(([start, rows]) => (
        <section key={start} className="ac-history-week">
          <h3>
            <span>{weekLabel(start, thisWeek)}</span>
            <span>{weekCount(start, rows.length)}</span>
          </h3>
          <ul className="ac-history-list">
            {rows.map((workout) => {
              const expanded = open === workout.workout_id;
              const record = recordWorkouts.has(workout.workout_id);
              return (
                <li key={workout.workout_id}>
                  <button
                    type="button"
                    className="ac-history-row"
                    aria-expanded={expanded}
                    onClick={() =>
                      setOpen(expanded ? undefined : workout.workout_id)
                    }
                  >
                    <span className="ac-history-date" aria-hidden="true">
                      <small>{WEEKDAY.format(at(workout.date))}</small>
                      <b>{at(workout.date).getUTCDate()}</b>
                    </span>
                    <span className="ac-history-main">
                      <strong>
                        {workout.title}
                        {record && <span className="ac-pill">Rekord</span>}
                      </strong>
                      <small>
                        <span className="visually-hidden">
                          {DAY_MONTH.format(at(workout.date))} ·{" "}
                        </span>
                        {workout.exercise_count}{" "}
                        {workout.exercise_count === 1 ? "Übung" : "Übungen"} ·{" "}
                        {workout.working_set_count}{" "}
                        {workout.working_set_count === 1 ? "Satz" : "Sätze"}
                        {workout.status !== "completed" &&
                          ` · ${workout.status_label}`}
                      </small>
                    </span>
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className="ac-history-chev"
                    />
                  </button>
                  {expanded && (
                    <ul
                      className="ac-history-exercises"
                      aria-label={`Übungen ${workout.title}`}
                    >
                      {workout.exercises.map((block) => {
                        const line = exerciseLine(block);
                        if (!line) return null;
                        return (
                          <li key={`${block.exercise_order}`}>
                            <span>
                              {block.name}
                              {recordAt(
                                workout.workout_id,
                                block.exercise_id,
                              ) && (
                                <Trophy
                                  size={13}
                                  aria-label="Rekord"
                                  className="ac-history-trophy"
                                />
                              )}
                            </span>
                            <span>{line}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {history.data.has_more && (
        <button
          type="button"
          className="ac-btn secondary"
          disabled={history.loading}
          onClick={() => setOffset((n) => n + PAGE)}
        >
          Ältere Einheiten
        </button>
      )}
    </ArnoldCard>
  );
}
