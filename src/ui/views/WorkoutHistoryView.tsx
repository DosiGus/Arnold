import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useAsync, useWorkoutHistory } from "../hooks";
import { useModelContext } from "../hooks/useModelContext";
import {
  ArnoldCard,
  CardActions,
  CardNote,
  CardSkeleton,
  ChipGroup,
} from "../components/cards";
import { RecoveryCard } from "../components/recovery";
import {
  dateLabel,
  formatSetLine,
  formatExecution,
  SET_TYPE_LABEL,
} from "../format";

export function WorkoutHistoryView({
  client,
  dashboard,
  initialWorkoutId,
}: {
  client: ArnoldMcpClient;
  dashboard: ArnoldDashboardView;
  initialWorkoutId?: string;
}) {
  const [expanded, setExpanded] = useState(Boolean(initialWorkoutId));
  const [selectedId, setSelectedId] = useState(initialWorkoutId);
  const [period, setPeriod] = useState<{ from?: string; to?: string }>({});
  const [planId, setPlanId] = useState<string>();
  const [sessionName, setSessionName] = useState<string>();
  const [includeAll, setIncludeAll] = useState(Boolean(initialWorkoutId));
  const [offset, setOffset] = useState(0);
  // Workouts in which the user set a record. Only the newest record is green;
  // older ones get a quiet trophy, so the list does not turn green throughout.
  const recordWorkouts = new Set(
    dashboard.home.records.map((r) => r.workout_id),
  );
  const newestRecordWorkout = dashboard.home.records[0]?.workout_id;
  const history = useWorkoutHistory(client, {
    ...period,
    plan_version_ids: planId ? [planId] : undefined,
    session_name: sessionName,
    workout_statuses: includeAll
      ? ["completed", "cancelled", "in_progress", "planned"]
      : undefined,
    limit: 8,
    offset,
  });
  const direct = useAsync(
    () =>
      initialWorkoutId
        ? client.historyWorkout(initialWorkoutId)
        : Promise.resolve(undefined),
    [client, initialWorkoutId],
  );
  useEffect(() => {
    if (initialWorkoutId) void client.displayMode("fullscreen");
  }, [client, initialWorkoutId]);
  const selected = (
    selectedId === initialWorkoutId && direct.data
      ? direct.data.workouts
      : history.data?.workouts
  )?.find((w) => w.workout_id === selectedId);
  const open = (id?: string) => {
    void client.displayMode("fullscreen");
    setExpanded(true);
    setSelectedId(id);
  };
  const close = () => {
    void client.displayMode("inline");
    setExpanded(false);
    setSelectedId(undefined);
    setPeriod({});
    setSessionName(undefined);
    setPlanId(undefined);
    setIncludeAll(false);
    setOffset(0);
  };
  const filter = (update: () => void) => {
    setOffset(0);
    setSelectedId(undefined);
    update();
  };
  useModelContext(
    client,
    selected
      ? `Arnold zeigt das Training „${selected.title}“ am ${selected.date}, workout_id ${selected.workout_id}, Status ${selected.status_label}. Gespeicherte Sätze: ${JSON.stringify(selected.exercises.map((block) => ({ exercise: block.name, sets: block.sets })))}. Die Karte zeigt diese Werte bereits. Für Korrekturen aktuelle Revision mit get_workout lesen.`
      : `Arnold zeigt den Trainingsverlauf${history.data ? ` mit ${history.data.total} Treffern` : ""}. Der Nutzer kann ein Training öffnen oder im Chat nach einem Datum fragen.`,
  );
  if (selectedId === initialWorkoutId && initialWorkoutId && direct.loading)
    return <CardSkeleton />;
  if (selectedId === initialWorkoutId && initialWorkoutId && direct.error)
    return (
      <RecoveryCard
        recovery={direct.failure?.recovery ?? "retry_same_request"}
        onAction={direct.reload}
      />
    );
  if (history.error)
    return (
      <RecoveryCard
        recovery={history.failure?.recovery ?? "retry_same_request"}
        onAction={history.reload}
      />
    );
  if (!history.data) return <CardSkeleton />;
  if (selectedId)
    return (
      <ArnoldCard
        className="ac-fullscreen workout-detail"
        label="Trainingsverlauf"
        title={selected?.title ?? "Training nicht in dieser Auswahl"}
        subtitle={
          selected
            ? `${dateLabel(selected.date, true)} · ${selected.status_label}`
            : "Passe die Auswahl an, um dieses Training zu finden."
        }
      >
        {selected?.notes && <p className="ac-text">{selected.notes}</p>}
        {selected?.exercises.map((block) => (
          <section className="ac-exercise-detail" key={block.exercise_id}>
            <h3 className="ac-section-title">{block.name}</h3>
            {block.retired && (
              <p className="ac-caption">Inzwischen ausgemustert</p>
            )}
            {block.mixed_load_basis && (
              <p className="ac-caption">
                Die Gewichtsangabe steht direkt an jedem Satz.
              </p>
            )}
            <ol className="ac-set-rows">
              {block.sets.map((set) => (
                <li
                  key={set.set_id}
                  className={set.voided ? "is-voided" : undefined}
                >
                  <span>
                    <strong>{formatSetLine(set)}</strong>
                    <small>
                      {SET_TYPE_LABEL[set.set_type]} {set.set_number}
                      {formatExecution(set) ? ` · ${formatExecution(set)}` : ""}
                      {set.voided ? " · Verworfen" : ""}
                      {set.rir !== null ? ` · RIR ${set.rir}` : ""}
                      {set.rpe !== null ? ` · RPE ${set.rpe}` : ""}
                    </small>
                    {set.notes && <small>{set.notes}</small>}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
        <CardActions
          primary={{
            label: "Zur Trainingsliste",
            onClick: () => setSelectedId(undefined),
          }}
          secondary={{ label: "Zurück zum Chat", onClick: close }}
        />
      </ArnoldCard>
    );
  return (
    <ArnoldCard
      className={expanded ? "ac-fullscreen" : ""}
      label="Dein Verlauf"
      title={
        history.data.total
          ? "Deine letzten Trainings"
          : "Hier beginnt dein Trainingsverlauf"
      }
      subtitle={
        history.data.total
          ? `${history.data.total} ${history.data.total === 1 ? "Training gefunden" : "Trainings gefunden"}`
          : "Dein erstes gespeichertes Training erscheint hier."
      }
      busy={history.loading}
    >
      {expanded && (
        <div className="ac-field">
          <ChipGroup
            label="Training auswählen"
            options={[
              { value: "all", label: "Alle Trainings" },
              ...dashboard.session_names.map((name) => ({
                value: name,
                label: name,
              })),
            ]}
            value={sessionName ?? "all"}
            onChange={(value) =>
              filter(() => setSessionName(value === "all" ? undefined : value))
            }
          />
          <ChipGroup
            label="Trainingsplan auswählen"
            value={planId ?? "all"}
            options={[
              { value: "all", label: "Alle Pläne" },
              ...dashboard.plan_history.map((plan) => ({
                value: plan.plan_version_id,
                label: `${plan.name} · Version ${plan.version_no}`,
              })),
            ]}
            onChange={(value) =>
              filter(() => setPlanId(value === "all" ? undefined : value))
            }
          />
          <div className="ac-date-range">
            <label>
              Von
              <input
                type="date"
                aria-label="Trainings von"
                value={period.from ?? ""}
                onChange={(e) =>
                  filter(() =>
                    setPeriod((p) => ({
                      ...p,
                      from: e.target.value || undefined,
                    })),
                  )
                }
              />
            </label>
            <label>
              Bis
              <input
                type="date"
                aria-label="Trainings bis"
                value={period.to ?? ""}
                onChange={(e) =>
                  filter(() =>
                    setPeriod((p) => ({
                      ...p,
                      to: e.target.value || undefined,
                    })),
                  )
                }
              />
            </label>
          </div>
          <button
            className="ac-switch"
            role="switch"
            aria-checked={includeAll}
            onClick={() => filter(() => setIncludeAll((v) => !v))}
          >
            <span>Offene und abgebrochene Trainings zeigen</span>
            <span className="ac-switch-track" aria-hidden="true">
              <i />
            </span>
          </button>
        </div>
      )}
      {history.data.workouts.length ? (
        <ul className="ac-training-list">
          {history.data.workouts.slice(0, expanded ? 8 : 4).map((workout) => (
            <li key={workout.workout_id}>
              <button
                type="button"
                className="ac-training-row"
                aria-label={`${workout.title} am ${dateLabel(workout.date, true)}${recordWorkouts.has(workout.workout_id) ? ", mit Rekord" : ""}`}
                onClick={() => open(workout.workout_id)}
              >
                <span>
                  <strong>
                    {workout.title}
                    {workout.workout_id === newestRecordWorkout ? (
                      <>
                        {" "}
                        <span className="ac-pill">Neuer Rekord</span>
                      </>
                    ) : (
                      recordWorkouts.has(workout.workout_id) && (
                        <>
                          {" "}
                          <span className="ac-record-mark" aria-hidden="true">
                            <Trophy size={13} />
                          </span>
                        </>
                      )
                    )}
                  </strong>
                  <small>
                    {dateLabel(workout.date)} · {workout.exercise_count}{" "}
                    {workout.exercise_count === 1 ? "Übung" : "Übungen"} ·{" "}
                    {workout.status_label}
                  </small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      ) : expanded ? (
        <CardNote>
          Keine Trainings in dieser Auswahl. Wähle einen anderen Zeitraum oder
          setze die Auswahl zurück.
        </CardNote>
      ) : null}
      {expanded &&
        (period.from || period.to || sessionName || planId || includeAll) && (
          <button
            className="ac-link"
            onClick={() =>
              filter(() => {
                setPeriod({});
                setSessionName(undefined);
                setPlanId(undefined);
                setIncludeAll(false);
              })
            }
          >
            Auswahl zurücksetzen
          </button>
        )}
      {expanded ? (
        <>
          <CardActions
            primary={
              history.data.has_more
                ? {
                    label: "Weitere Trainings",
                    onClick: () => setOffset((n) => n + 8),
                  }
                : undefined
            }
            secondary={
              offset > 0
                ? {
                    label: "Vorherige Trainings",
                    onClick: () => setOffset((n) => Math.max(0, n - 8)),
                  }
                : undefined
            }
          />
          <button type="button" className="ac-link" onClick={close}>
            Zurück zum Chat
          </button>
        </>
      ) : (
        <CardActions
          primary={
            history.data.total
              ? { label: "Alle Trainings ansehen", onClick: () => open() }
              : {
                  label: "Training ansehen",
                  onClick: () => void client.openDashboard(),
                }
          }
        />
      )}
    </ArnoldCard>
  );
}
