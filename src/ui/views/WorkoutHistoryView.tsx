/**
 * Workout history for any split.
 *
 * Session names come from the stored snapshot, so the list works for
 * "Oberkörper A", for a spontaneous session and for a plan that changed three
 * times. Filtering and paging happen on the server; this view only states what
 * it wants.
 */
import { useEffect, useState } from "react";
import { Dumbbell, ListFilter } from "lucide-react";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useWorkoutHistory } from "../hooks";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PeriodFilter,
  PlanSelector,
  SessionSelector,
  SetList,
  StatusNotice,
  WorkoutCard,
  type PeriodValue,
} from "../components";
import { dateLabel, formatNumber, UNKNOWN } from "../format";

const PAGE_SIZE = 20;

export function WorkoutHistoryView({
  client,
  dashboard,
  initialWorkoutId,
}: {
  client: ArnoldMcpClient;
  dashboard: ArnoldDashboardView;
  initialWorkoutId?: string;
}) {
  const [period, setPeriod] = useState<PeriodValue>({});
  const [planId, setPlanId] = useState<string>();
  const [sessionName, setSessionName] = useState<string>();
  // Opening a specific session must find it whatever its status is: the
  // overview also lists cancelled sessions, and the default listing does not.
  const [includeAllStatuses, setIncludeAllStatuses] = useState(
    initialWorkoutId !== undefined,
  );
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState(initialWorkoutId);
  /** True while a specific session was asked for and has not been found yet. */
  const [requestedId, setRequestedId] = useState(initialWorkoutId);

  // A narrowed filter must start at the first page again.
  useEffect(() => {
    setOffset(0);
  }, [period.from, period.to, planId, sessionName, includeAllStatuses]);

  const history = useWorkoutHistory(client, {
    ...period,
    plan_version_ids: planId ? [planId] : undefined,
    session_name: sessionName,
    workout_statuses: includeAllStatuses
      ? ["completed", "cancelled", "in_progress", "planned"]
      : undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const workouts = history.data?.workouts ?? [];
  const found = workouts.find((workout) => workout.workout_id === selectedId);
  /**
   * No silent substitution. Falling back to `workouts[0]` meant that clicking a
   * cancelled session in the overview opened a *different* session and
   * presented it as the answer. A session that was explicitly requested is
   * either shown or reported as not in the current filter.
   */
  const selected = found ?? (requestedId ? undefined : workouts[0]);
  const requestedMissing =
    requestedId !== undefined && !found && !history.loading && !history.error;

  return (
    <>
      <details className="filter-disclosure">
        <summary>Zeitraum & Filter</summary>
        <div className="filter-bar history-filters">
          <PeriodFilter
            value={period}
            onChange={setPeriod}
            anchor={dashboard.period.to}
            idPrefix="history"
            scopeLabel="Workouts"
          />
          <div className="filter-selects">
            <PlanSelector
              plans={dashboard.plan_history}
              value={planId}
              onChange={setPlanId}
            />
            <SessionSelector
              sessions={dashboard.session_names}
              value={sessionName}
              onChange={setSessionName}
            />
            <label className="checkbox-field" htmlFor="history-all-statuses">
              <input
                id="history-all-statuses"
                type="checkbox"
                checked={includeAllStatuses}
                onChange={(e) => setIncludeAllStatuses(e.target.checked)}
              />
              Abgebrochene und offene Einheiten zeigen
            </label>
          </div>
        </div>
      </details>

      {history.error && (
        <ErrorState message={history.error} onRetry={history.reload} />
      )}
      {requestedMissing && (
        <StatusNotice
          notice={{
            code: "filter_empty",
            severity: "warning",
            title: "Angeforderte Trainingseinheit nicht in der Auswahl",
            message:
              "Die aufgerufene Einheit liegt außerhalb der aktuellen Filter. Zeitraum, Plan oder Einheit anpassen, um sie zu sehen.",
          }}
        />
      )}
      {history.data?.notices.map((notice) => (
        <StatusNotice key={notice.code} notice={notice} />
      ))}

      <div className="history-grid" aria-busy={history.loading}>
        <Card className="history-list">
          <div className="card-heading">
            <div>
              <h2>Trainings</h2>
              <p>
                {history.loading && !history.data
                  ? "Einheiten werden geladen …"
                  : `${history.data?.total ?? 0} Einheiten gefunden`}
              </p>
            </div>
          </div>
          {history.loading && !history.data ? (
            <LoadingState text="Trainingshistorie wird geladen …" />
          ) : workouts.length ? (
            <>
              {workouts.map((workout) => (
                <WorkoutCard
                  key={workout.workout_id}
                  workout={workout}
                  selected={selected?.workout_id === workout.workout_id}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setRequestedId(undefined);
                  }}
                />
              ))}
              {(offset > 0 || history.data?.has_more) && (
                <div className="pager">
                  <button
                    className="secondary"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    Neuere
                  </button>
                  <span>
                    {offset + 1}–{offset + workouts.length} von{" "}
                    {history.data?.total ?? 0}
                  </span>
                  <button
                    className="secondary"
                    disabled={!history.data?.has_more}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    Ältere
                  </button>
                </div>
              )}
            </>
          ) : (
            !history.error && (
              <EmptyState
                title="Keine Einheiten gefunden"
                text="Zeitraum, Plan oder Trainingseinheit anpassen."
              />
            )
          )}
        </Card>

        <Card className="workout-detail">
          {selected ? (
            <>
              <div className="card-heading">
                <div>
                  {!selected.counts_towards_metrics && (
                    <span className="set-flag">{selected.status_label}</span>
                  )}
                  <h2>{selected.title}</h2>
                  <p>
                    {dateLabel(selected.date, true)}
                    {selected.plan_name
                      ? ` · ${selected.plan_name} · v${selected.plan_version_no}`
                      : " · ohne Trainingsplan"}
                  </p>
                </div>
                <span className="detail-total">
                  <strong>
                    {selected.nominal_volume === null
                      ? UNKNOWN
                      : formatNumber(selected.nominal_volume, 0)}
                  </strong>{" "}
                  {selected.nominal_volume === null
                    ? "kein Volumen"
                    : "kg Volumen"}
                </span>
              </div>
              <div className="detail-chips">
                <span>
                  <Dumbbell size={14} aria-hidden="true" />
                  {selected.exercise_count} Übungen
                </span>
                <span>
                  <ListFilter size={14} aria-hidden="true" />
                  {selected.set_count} Sätze
                </span>
                <span>{selected.working_set_count} Arbeitssätze</span>
              </div>
              {selected.notes && (
                <p className="workout-notes">{selected.notes}</p>
              )}
              <div className="exercise-details">
                {selected.exercises.map((block) => (
                  <section key={block.exercise_id}>
                    <h3>
                      {block.name}
                      {block.retired && (
                        <span className="set-flag">Übung beendet</span>
                      )}
                      {!block.in_current_catalog && (
                        <span className="set-flag">nur in der Historie</span>
                      )}
                    </h3>
                    {block.mixed_load_basis && (
                      <p className="block-note">
                        Diese Übung enthält mehrere Gewichtsdefinitionen; die
                        Sätze werden nicht zusammengefasst.
                      </p>
                    )}
                    <SetList sets={block.sets} />
                  </section>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="Keine Einheit ausgewählt"
              text="Wähle links eine Trainingseinheit aus."
            />
          )}
        </Card>
      </div>
    </>
  );
}
