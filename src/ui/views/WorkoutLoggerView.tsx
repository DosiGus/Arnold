import { useEffect, useState, type FormEvent } from "react";
import type { ArnoldSet } from "../../shared/arnold-schema-v1";
import { LOAD_BASIS_LABEL, formatSetLine } from "../../shared/arnold-format";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useWorkoutLogger } from "../hooks/useWorkoutLogger";

export function WorkoutLoggerView({
  client,
  onChanged,
}: {
  client: ArnoldMcpClient;
  onChanged: () => void;
}) {
  const logger = useWorkoutLogger(client, onChanged);
  const [session, setSession] = useState(""),
    [date, setDate] = useState(
      new Intl.DateTimeFormat("en-CA").format(new Date()),
    );
  const [exerciseId, setExerciseId] = useState("");
  const [kg, setKg] = useState(""),
    [reps, setReps] = useState("");
  const [load, setLoad] = useState<ArnoldSet["load_basis"]>("total");
  const [execution, setExecution] = useState<ArnoldSet["execution_mode"]>(
    "bilateral_simultaneous",
  );
  const [side, setSide] = useState<ArnoldSet["side"] | "">("both");
  const [basis, setBasis] = useState<ArnoldSet["reps_basis"]>("total"),
    [count, setCount] = useState("1");
  const [type, setType] = useState<ArnoldSet["set_type"]>("working"),
    [rpe, setRpe] = useState(""),
    [rir, setRir] = useState("");
  const [edit, setEdit] = useState<ArnoldSet>(),
    [reason, setReason] = useState("");
  const data = logger.data,
    workout = data?.workout;
  const closed = workout?.status === "completed";
  const disabled = logger.busy || !!logger.pending;
  const items =
    data?.plan_items.filter(
      (i) =>
        i.plan_version_id === workout?.plan_version_id &&
        i.session_id === workout?.session_id &&
        i.status === "active",
    ) ?? [];
  const activeItem = items.filter((i) => i.exercise_id === exerciseId);
  function choose(id: string) {
    setExerciseId(id);
    setEdit(undefined);
    const exercise = data?.exercises.find((e) => e.exercise_id === id);
    const candidates = items.filter((i) => i.exercise_id === id),
      item = candidates.length === 1 ? candidates[0] : undefined;
    if (!exercise) return;
    const mode = item?.target_execution_mode ?? exercise.default_execution_mode;
    setLoad(item?.target_load_basis ?? exercise.default_load_basis);
    setExecution(mode);
    setCount(
      String(item?.target_implement_count ?? exercise.default_implement_count),
    );
    setSide(
      mode === "bilateral_simultaneous"
        ? "both"
        : mode === "alternating"
          ? "alternating"
          : "",
    );
    setBasis("total");
    if (item?.target_load_kg !== null && item?.target_load_kg !== undefined)
      setKg(String(item.target_load_kg));
  }
  useEffect(() => {
    if (data && !exerciseId && data.exercises[0])
      choose(data.exercises[0].exercise_id);
  }, [data]);
  useEffect(() => {
    const pending = logger.pending;
    if (!pending) return;
    const input = pending.input;
    if (pending.operation === "start_workout") {
      setSession(String(input.session_name));
      setDate(String(input.workout_date_local));
    }
    const spec =
      pending.operation === "log_workout_sets"
        ? (input.sets as Record<string, unknown>[])?.[0]
        : pending.operation === "update_set"
          ? (input.changes as Record<string, unknown>)
          : undefined;
    if (!spec) return;
    if (spec.exercise_id) setExerciseId(String(spec.exercise_id));
    setKg(spec.load_kg === null ? "" : String(spec.load_kg));
    setReps(String(spec.reps));
    setLoad(spec.load_basis as ArnoldSet["load_basis"]);
    setExecution(spec.execution_mode as ArnoldSet["execution_mode"]);
    setCount(String(spec.implement_count));
    setSide(spec.side as ArnoldSet["side"]);
    setBasis(spec.reps_basis as ArnoldSet["reps_basis"]);
  }, [logger.pending]);
  function start(event: FormEvent) {
    event.preventDefault();
    void logger.write("start_workout", {
      workout_date_local: date,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      session_name: session,
      source: "ui",
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const fields = {
      set_type: type,
      reps: Number(reps),
      reps_basis: basis,
      load_kg: load === "bodyweight_only" && kg === "" ? null : Number(kg),
      load_basis: load,
      implement_count: Number(count),
      execution_mode: execution,
      side,
      rpe: rpe === "" ? null : Number(rpe),
      rir: rir === "" ? null : Number(rir),
    };
    const response = edit
      ? await logger.write("update_set", {
          set_id: edit.set_id,
          expected_row_revision: edit.row_revision,
          changes: fields,
          ...(closed
            ? { correct_completed: true, correction_reason: reason }
            : {}),
        })
      : await logger.write("log_workout_sets", {
          workout_id: workout!.workout_id,
          sets: [
            {
              ...fields,
              exercise_id: exerciseId,
              plan_item_id:
                activeItem.length === 1 ? activeItem[0].plan_item_id : null,
            },
          ],
          source: "ui",
        });
    if (response?.ok) {
      setEdit(undefined);
      setReps("");
    }
  }
  function correct(set: ArnoldSet) {
    setEdit(set);
    setExerciseId(set.exercise_id);
    setKg(set.load_kg === null ? "" : String(set.load_kg));
    setReps(String(set.reps));
    setLoad(set.load_basis);
    setExecution(set.execution_mode);
    setSide(set.side);
    setBasis(set.reps_basis);
    setCount(String(set.implement_count));
    setType(set.set_type);
    setRpe(set.rpe === null ? "" : String(set.rpe));
    setRir(set.rir === null ? "" : String(set.rir));
  }
  return (
    <div className="logger-grid workout-logger">
      <section className="card logger-card">
        <h2>Training starten</h2>
        {logger.error && <p role="alert">{logger.error}</p>}
        {logger.message && <p role="status">{logger.message}</p>}
        {logger.pending && (
          <button
            className="secondary"
            disabled={logger.busy}
            onClick={() => void logger.retry()}
          >
            Vorgang prüfen / erneut versuchen
          </button>
        )}
        {!data ? (
          <p>Workout wird geladen …</p>
        ) : !data.can_write ? (
          <p>Schreibfunktionen sind deaktiviert.</p>
        ) : (
          <>
            {data.workouts.length > 0 && (
              <label>
                Offenes Workout
                <select
                  disabled={disabled}
                  value={workout?.workout_id ?? ""}
                  onChange={(e) => void logger.select(e.target.value)}
                >
                  <option value="" disabled>
                    Workout auswählen
                  </option>
                  {data.workouts.map((w) => (
                    <option key={w.workout_id} value={w.workout_id}>
                      {w.session_name_snapshot} · {w.workout_date_local}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!workout && (
              <form onSubmit={start}>
                <fieldset disabled={disabled}>
                  <label>
                    Trainingseinheit
                    <input
                      required
                      placeholder="Name deiner Trainingseinheit"
                      value={session}
                      onChange={(e) => setSession(e.target.value)}
                    />
                  </label>
                  <label>
                    Trainingsdatum
                    <input
                      required
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <button className="primary" type="submit">
                    Workout starten
                  </button>
                </fieldset>
              </form>
            )}
            {workout && (
              <>
                <p>
                  <strong>{workout.session_name_snapshot}</strong> ·{" "}
                  {workout.workout_date_local} ·{" "}
                  {closed
                    ? "Abgeschlossen"
                    : workout.status === "cancelled"
                      ? "Abgebrochen"
                      : "Läuft"}
                </p>
                {(workout.status === "in_progress" ||
                  (closed && edit && data.can_correct_completed)) && (
                  <form onSubmit={save}>
                    <fieldset disabled={disabled}>
                      <label>
                        Übung
                        <select
                          required
                          disabled={!!edit}
                          value={exerciseId}
                          onChange={(e) => choose(e.target.value)}
                        >
                          {data.exercises.map((e) => (
                            <option key={e.exercise_id} value={e.exercise_id}>
                              {e.name_de}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="form-row">
                        <label>
                          Gewicht (kg)
                          <input
                            required={load !== "bodyweight_only"}
                            type="number"
                            min="0"
                            step="any"
                            value={kg}
                            onChange={(e) => setKg(e.target.value)}
                          />
                        </label>
                        <label>
                          Wiederholungen
                          <input
                            required
                            type="number"
                            min="0"
                            step="1"
                            value={reps}
                            onChange={(e) => setReps(e.target.value)}
                          />
                        </label>
                      </div>
                      <label>
                        Gewichtsdefinition
                        <select
                          value={load}
                          onChange={(e) =>
                            setLoad(e.target.value as typeof load)
                          }
                        >
                          {Object.entries(LOAD_BASIS_LABEL).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <div className="form-row">
                        <label>
                          Ausführung
                          <select
                            value={execution}
                            onChange={(e) => {
                              const mode = e.target.value as typeof execution;
                              setExecution(mode);
                              setSide(
                                mode === "unilateral"
                                  ? ""
                                  : mode === "alternating"
                                    ? "alternating"
                                    : "both",
                              );
                            }}
                          >
                            <option value="bilateral_simultaneous">
                              Beidseitig
                            </option>
                            <option value="unilateral">Einseitig</option>
                            <option value="alternating">Abwechselnd</option>
                          </select>
                        </label>
                        <label>
                          Anzahl Geräte
                          <input
                            required
                            type="number"
                            min="1"
                            step="1"
                            value={count}
                            onChange={(e) => setCount(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="form-row">
                        <label>
                          Seite
                          <select
                            required
                            value={side}
                            onChange={(e) =>
                              setSide(e.target.value as typeof side)
                            }
                          >
                            <option value="" disabled>
                              Seite wählen
                            </option>
                            <option value="both">Beide</option>
                            <option value="left">Links</option>
                            <option value="right">Rechts</option>
                            <option value="alternating">Abwechselnd</option>
                          </select>
                        </label>
                        <label>
                          Wiederholungsbasis
                          <select
                            value={basis}
                            onChange={(e) =>
                              setBasis(e.target.value as typeof basis)
                            }
                          >
                            <option value="total">Gesamt</option>
                            <option value="per_side">Pro Seite</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        Satztyp
                        <select
                          value={type}
                          onChange={(e) =>
                            setType(e.target.value as typeof type)
                          }
                        >
                          <option value="working">Arbeitssatz</option>
                          <option value="warmup">Aufwärmsatz</option>
                          <option value="drop">Dropsatz</option>
                          <option value="failure">Bis zum Versagen</option>
                          <option value="other">Sonstiger Satz</option>
                        </select>
                      </label>
                      <div className="form-row">
                        <label>
                          RPE (optional)
                          <input
                            type="number"
                            min="1"
                            max="10"
                            step="0.5"
                            value={rpe}
                            onChange={(e) => setRpe(e.target.value)}
                          />
                        </label>
                        <label>
                          RIR (optional)
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={rir}
                            onChange={(e) => setRir(e.target.value)}
                          />
                        </label>
                      </div>
                      {closed && (
                        <label>
                          Korrekturbegründung
                          <input
                            required
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </label>
                      )}
                      <button className="primary save-button" type="submit">
                        {logger.busy
                          ? "Wird geprüft …"
                          : edit
                            ? "Korrektur speichern"
                            : "Satz speichern"}
                      </button>
                      {edit && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setEdit(undefined)}
                        >
                          Korrektur verwerfen
                        </button>
                      )}
                    </fieldset>
                  </form>
                )}
                {workout.status === "in_progress" && (
                  <div className="logger-actions">
                    <button
                      className="primary"
                      disabled={disabled}
                      onClick={() =>
                        void logger.write("complete_workout", {
                          workout_id: workout.workout_id,
                          expected_row_revision: workout.row_revision,
                        })
                      }
                    >
                      Training abschließen
                    </button>
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() =>
                        void logger.write("cancel_workout", {
                          workout_id: workout.workout_id,
                          expected_row_revision: workout.row_revision,
                        })
                      }
                    >
                      Training abbrechen
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
      <section className="card logger-card">
        <h2>Deine Sätze</h2>
        {!data?.sets.length ? (
          <p>Noch keine Sätze.</p>
        ) : (
          <ol className="confirmed-sets">
            {data.sets.map((set) => (
              <li key={set.set_id}>
                <strong>{set.exercise_name_snapshot}</strong>
                <p>
                  {formatSetLine(set)}
                  {set.status === "voided" ? " · storniert" : ""}
                </p>
                {set.status === "active" &&
                  (workout?.status === "in_progress" ||
                    (closed && data.can_correct_completed)) && (
                    <>
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() => correct(set)}
                      >
                        Satz {set.set_number} korrigieren
                      </button>
                      {!closed && (
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={() =>
                            void logger.write("void_set", {
                              set_id: set.set_id,
                              expected_row_revision: set.row_revision,
                            })
                          }
                        >
                          Satz {set.set_number} stornieren
                        </button>
                      )}
                    </>
                  )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
