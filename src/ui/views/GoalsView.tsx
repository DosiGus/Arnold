import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, TrendingUp } from "lucide-react";
import type { ArnoldDashboardView, HomeGoal } from "../../shared/arnold-view";
import type { ArnoldGoalKind } from "../../shared/arnold-schema-v1";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import {
  ArnoldCard,
  CardActions,
  CardNote,
  ChipGroup,
  Stepper,
} from "../components/cards";
import {
  DetailHead,
  GoalChart,
  ProgressBar,
  goalValue,
  isRunGoal,
} from "../components/home";
import { RecoveryNotice } from "../components/recovery";
import { useGoalWriter } from "../hooks/useGoalWriter";
import { dateLabel, formatNumber } from "../format";

type Phase =
  | { name: "list" }
  | { name: "detail"; goalId: string }
  | { name: "add"; step: "type" }
  | { name: "add"; step: "exercise" }
  | {
      name: "add";
      step: "target";
      kind: ArnoldGoalKind;
      exerciseId: string | null;
    };

type Edit = { mode: "weigh" | "target"; value: number } | null;

const localToday = () => new Intl.DateTimeFormat("en-CA").format(new Date());
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const roundTo = (value: number, step: number) =>
  Math.round(value / step) * step;

/**
 * "Ziele" behind the start screen tile: body weight and exercise goals with
 * progress bars, a detail view with the curve, and setting a new goal.
 *
 * Every write goes through the tools ChatGPT uses as well, so a goal set here
 * shows up in the chat and the other way round.
 */
export function GoalsView({
  client,
  view,
  canWrite,
  onBack,
  onChanged,
  onOpenProgress,
  initialGoalId,
  startAdding = false,
}: {
  client: ArnoldMcpClient;
  view: ArnoldDashboardView;
  canWrite: boolean;
  onBack?: () => void;
  onChanged: () => void;
  onOpenProgress: (exerciseId: string) => void;
  initialGoalId?: string;
  startAdding?: boolean;
}) {
  const home = view.home;
  const [phase, setPhase] = useState<Phase>(() =>
    initialGoalId
      ? { name: "detail", goalId: initialGoalId }
      : startAdding && canWrite
        ? { name: "add", step: "type" }
        : { name: "list" },
  );
  const [edit, setEdit] = useState<Edit>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [flash, setFlash] = useState("");
  const writer = useGoalWriter(client, onChanged);

  const exercises = useMemo(
    () =>
      new Map(
        view.exercises
          .filter((e) => e.in_current_catalog && !e.retired)
          .map((e) => [e.exercise_id, e]),
      ),
    [view.exercises],
  );
  const bests = useMemo(
    () => new Map(home.exercise_bests.map((b) => [b.exercise_id, b])),
    [home.exercise_bests],
  );

  const toList = () => {
    setPhase({ name: "list" });
    setEdit(null);
    setConfirmEnd(false);
    writer.dismiss();
  };

  const failure = writer.failure && (
    <RecoveryNotice
      recovery={writer.failure.recovery}
      code={writer.failure.code}
      message={writer.failure.message}
      onAction={writer.canRetry ? writer.retry : undefined}
      busy={writer.busy}
    />
  );

  /* ---------------------------------------------------------------- detail */
  if (phase.name === "detail") {
    const goal = home.goals.find((g) => g.goal_id === phase.goalId);
    if (!goal) {
      return (
        <ArnoldCard aria-label="Ziel">
          <DetailHead crumb="Ziele" onBack={toList} backLabel="Alle Ziele" />
          <CardNote>Dieses Ziel gibt es nicht mehr.</CardNote>
        </ArnoldCard>
      );
    }
    return (
      <GoalDetail
        goal={goal}
        edit={edit}
        setEdit={setEdit}
        canWrite={canWrite}
        busy={writer.busy}
        failure={failure}
        confirmEnd={confirmEnd}
        onBack={toList}
        onOpenProgress={onOpenProgress}
        onSaveWeight={async (weight) => {
          if (
            await writer.write("log_body_weight", {
              measured_on: localToday(),
              timezone: timezone(),
              weight_kg: weight,
              source: "ui",
            })
          )
            setEdit(null);
        }}
        onSaveTarget={async (target) => {
          if (
            await writer.write("update_training_goal", {
              goal_id: goal.goal_id,
              expected_row_revision: goal.row_revision,
              target_value: target,
            })
          )
            setEdit(null);
        }}
        onEnd={async () => {
          if (!confirmEnd) return setConfirmEnd(true);
          if (
            await writer.write("archive_training_goal", {
              goal_id: goal.goal_id,
              expected_row_revision: goal.row_revision,
            })
          ) {
            setFlash(`Ziel beendet: ${goal.name}`);
            toList();
          }
        }}
      />
    );
  }

  /* ------------------------------------------------------------------- add */
  if (phase.name === "add") {
    const hasBody = home.goals.some((g) => g.kind === "body_weight");
    const step = phase.step === "type" ? 0 : phase.step === "exercise" ? 1 : 2;
    const head = (
      <DetailHead
        crumb={
          <span className="ac-label-col">
            <span>Ziele · Neues Ziel</span>
            <span className="ac-progress" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <i key={i}>
                  <b style={{ width: i <= step ? "100%" : "0%" }} />
                </i>
              ))}
            </span>
          </span>
        }
        onBack={toList}
        backLabel="Zurück zu allen Zielen"
      />
    );

    if (phase.step === "type")
      return (
        <ArnoldCard aria-label="Neues Ziel">
          {head}
          <h2 className="ac-title">Was willst du erreichen?</h2>
          <div className="ac-options">
            <button
              type="button"
              className="ac-option"
              disabled={hasBody}
              onClick={() =>
                setPhase({
                  name: "add",
                  step: "target",
                  kind: "body_weight",
                  exerciseId: null,
                })
              }
            >
              <strong>Körpergewicht</strong>
              <span className="ac-text">
                {hasBody
                  ? "Hast du schon als Ziel"
                  : "Zielgewicht festlegen und regelmäßig eintragen"}
              </span>
            </button>
            <button
              type="button"
              className="ac-option"
              onClick={() => setPhase({ name: "add", step: "exercise" })}
            >
              <strong>Eine Übung</strong>
              <span className="ac-text">
                Zielgewicht oder Wiederholungen, z. B. 100 kg Bankdrücken
              </span>
            </button>
          </div>
        </ArnoldCard>
      );

    if (phase.step === "exercise") {
      const taken = new Set(
        home.goals.filter((g) => g.exercise_id).map((g) => g.exercise_id),
      );
      const trained = [...exercises.values()]
        .filter((e) => bests.has(e.exercise_id) && !taken.has(e.exercise_id))
        .sort((a, b) => a.name.localeCompare(b.name, "de"));
      const options = trained.length
        ? trained
        : [...exercises.values()]
            .filter((e) => !taken.has(e.exercise_id))
            .slice(0, 12);
      return (
        <ArnoldCard aria-label="Neues Ziel">
          {head}
          <h2 className="ac-title">Welche Übung?</h2>
          {options.length ? (
            <div className="ac-option-grid">
              {options.map((e) => {
                const best = bests.get(e.exercise_id);
                return (
                  <button
                    type="button"
                    key={e.exercise_id}
                    className="ac-option small"
                    onClick={() =>
                      setPhase({
                        name: "add",
                        step: "target",
                        kind:
                          e.default_load_basis === "bodyweight_only" ||
                          e.default_load_basis === "assistance"
                            ? "exercise_reps"
                            : "exercise_load",
                        exerciseId: e.exercise_id,
                      })
                    }
                  >
                    <strong>{e.name}</strong>
                    <span className="ac-text">
                      {best
                        ? `Bester Satz ${bestLine(best)}`
                        : "Noch nicht trainiert"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <CardNote>Für jede Übung gibt es schon ein Ziel.</CardNote>
          )}
        </ArnoldCard>
      );
    }

    return (
      <TargetStep
        key={`${phase.kind}-${phase.exerciseId}`}
        head={head}
        kind={phase.kind}
        exerciseId={phase.exerciseId}
        exerciseName={
          phase.exerciseId ? (exercises.get(phase.exerciseId)?.name ?? "") : ""
        }
        loadAllowed={
          phase.exerciseId !== null &&
          !["bodyweight_only", "assistance"].includes(
            exercises.get(phase.exerciseId)?.default_load_basis ?? "",
          )
        }
        perImplement={
          phase.exerciseId !== null &&
          exercises.get(phase.exerciseId)?.default_load_basis ===
            "per_implement"
        }
        best={phase.exerciseId ? bests.get(phase.exerciseId) : undefined}
        bodyWeight={home.latest_body_weight?.weight_kg ?? null}
        busy={writer.busy}
        failure={failure}
        onKind={(kind) =>
          setPhase({ ...phase, kind, step: "target", name: "add" })
        }
        onSave={async (kind, target) => {
          const ok = await writer.write("create_training_goal", {
            kind,
            ...(phase.exerciseId ? { exercise_id: phase.exerciseId } : {}),
            target_value: target,
            source: "ui",
          });
          if (ok) {
            const name =
              phase.exerciseId === null
                ? "Körpergewicht"
                : (exercises.get(phase.exerciseId)?.name ?? "");
            setFlash(
              `Ziel gespeichert: ${name} ${formatNumber(target, 1)} ${kind === "exercise_reps" ? "Wdh." : "kg"}`,
            );
            toList();
          }
        }}
      />
    );
  }

  /* ------------------------------------------------------------------ list */
  const onTrack = home.goals.filter(
    (g) => g.achieved || g.eta_weeks !== null || (g.progress ?? 0) >= 0.3,
  ).length;
  return (
    <ArnoldCard aria-label="Ziele">
      <DetailHead crumb="Übersicht · Ziele" onBack={onBack} />
      <div>
        <h2 className="ac-title">Deine Ziele</h2>
        <p className="ac-sub">
          {home.goals.length
            ? `${onTrack} von ${home.goals.length} auf gutem Weg`
            : "Ein Ziel macht Fortschritt sichtbar."}
        </p>
      </div>
      {flash && (
        <p className="ac-flash" role="status">
          {flash}
        </p>
      )}
      {home.goals.length > 0 && (
        <div className="ac-goal-list">
          {home.goals.map((g) => (
            <button
              type="button"
              key={g.goal_id}
              className="ac-goal-row"
              aria-label={`${g.name}: ${g.progress === null ? "noch kein Messwert" : `${Math.round(g.progress * 100)} Prozent`}. Details öffnen`}
              onClick={() => {
                setFlash("");
                setPhase({ name: "detail", goalId: g.goal_id });
              }}
            >
              <span className="ac-goal-row-head">
                <strong>{g.name}</strong>
                <span>
                  {g.achieved
                    ? "Erreicht"
                    : g.progress === null
                      ? "–"
                      : `${Math.round(g.progress * 100)} %`}
                  <ChevronRight size={14} aria-hidden="true" />
                </span>
              </span>
              <ProgressBar value={g.progress} label={`${g.name} Fortschritt`} />
              <span className="ac-goal-row-foot">
                <span>
                  Jetzt <b>{goalValue(g, g.current_value, true)}</b>
                </span>
                <span>
                  Ziel <b>{goalValue(g, g.target_value, true)}</b>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {home.latest_body_weight &&
        !home.goals.some((g) => g.kind === "body_weight") && (
          <p className="ac-text">
            Zuletzt gewogen:{" "}
            {formatNumber(home.latest_body_weight.weight_kg, 1)} kg am{" "}
            {dateLabel(home.latest_body_weight.date)}.
          </p>
        )}
      {canWrite && (
        <CardActions
          primary={{
            label: "Ziel hinzufügen",
            onClick: () => {
              setFlash("");
              setPhase({ name: "add", step: "type" });
            },
          }}
        />
      )}
    </ArnoldCard>
  );
}

function bestLine(best: {
  best_load_kg: number | null;
  best_load_reps: number | null;
  best_reps: number | null;
  load_basis: string;
}) {
  if (best.best_load_kg !== null)
    return `${formatNumber(best.best_load_kg, 2)} kg${best.load_basis === "per_implement" ? " pro Hantel" : ""}${best.best_load_reps !== null ? ` × ${best.best_load_reps}` : ""}`;
  if (best.best_reps !== null) return `${best.best_reps} Wdh.`;
  return "–";
}

function GoalDetail({
  goal,
  edit,
  setEdit,
  canWrite,
  busy,
  failure,
  confirmEnd,
  onBack,
  onOpenProgress,
  onSaveWeight,
  onSaveTarget,
  onEnd,
}: {
  goal: HomeGoal;
  edit: Edit;
  setEdit: (edit: Edit) => void;
  canWrite: boolean;
  busy: boolean;
  failure: ReactNode;
  confirmEnd: boolean;
  onBack: () => void;
  onOpenProgress: (exerciseId: string) => void;
  onSaveWeight: (weight: number) => void;
  onSaveTarget: (target: number) => void;
  onEnd: () => void;
}) {
  const body = goal.kind === "body_weight";
  const run = isRunGoal(goal);
  const left =
    goal.current_value === null
      ? null
      : Math.abs(goal.target_value - goal.current_value);
  const unit = goal.unit === "reps" ? "Wdh." : "kg";
  // A difference or a weekly rate: kg/Wdh. as before, seconds for a time.
  const amount = (value: number) =>
    goal.unit === "s"
      ? `${formatNumber(Math.abs(value), 0)} Sek.`
      : run
        ? goalValue(goal, Math.abs(value))
        : `${formatNumber(Math.abs(value), 1)} ${unit}`;
  const step =
    edit?.mode === "weigh" ? 0.1 : body ? 0.5 : goal.unit === "reps" ? 1 : 2.5;
  const metricLabel = run
    ? goal.kind === "run_distance"
      ? "Längster gemessener Lauf"
      : goal.kind === "run_duration"
        ? "Längste Laufzeit am Stück"
        : `Beste gemessene Zeit über ${formatNumber((goal.run_distance_m ?? 0) / 1000, 1)} km`
    : body
      ? goal.current_date
        ? `Körpergewicht · zuletzt ${dateLabel(goal.current_date)}`
        : "Körpergewicht"
      : goal.unit === "kg"
        ? `${goal.name} · schwerster Arbeitssatz${goal.load_basis === "per_implement" ? " pro Hantel" : ""}`
        : `${goal.name} · meiste Wiederholungen in einem Satz`;
  return (
    <ArnoldCard aria-label={`Ziel ${goal.name}`}>
      <DetailHead
        crumb={`Ziele · ${goal.name}`}
        onBack={onBack}
        backLabel="Zurück zu allen Zielen"
      />
      <div className="ac-goal-hero">
        <span className="ac-text">{metricLabel}</span>
        <span className="ac-goal-number">
          <strong>
            {goal.current_value === null
              ? "–"
              : run
                ? goalValue(goal, goal.current_value)
                : formatNumber(goal.current_value, 1)}
            {!run && <small> {unit}</small>}
          </strong>
          {goal.progress !== null && (
            <span className={`ac-pill ${goal.achieved ? "" : "muted"}`}>
              {goal.achieved
                ? "Erreicht"
                : `${Math.round(goal.progress * 100)} % geschafft`}
            </span>
          )}
        </span>
        <span className="ac-text">
          {goal.achieved
            ? "Ziel erreicht. Zeit für ein neues?"
            : left === null
              ? body
                ? "Trag dein Gewicht ein, dann siehst du deinen Weg zum Ziel."
                : run
                  ? "Sobald ein Lauf das misst, siehst du hier deinen Weg zum Ziel."
                  : "Sobald du die Übung trainierst, siehst du hier deinen Weg zum Ziel."
              : `Noch ${amount(left)} bis ${goalValue(goal, goal.target_value, true)}`}
        </span>
      </div>

      <GoalChart goal={goal} />

      <div className="ac-highlight">
        <span className="ac-medal quiet">
          <TrendingUp size={16} aria-hidden="true" />
        </span>
        <span>
          <strong>
            {goal.achieved
              ? "Geschafft"
              : goal.rate_per_week === null
                ? "Noch zu wenig Daten"
                : `Etwa ${goal.rate_per_week > 0 ? "+" : "−"}${amount(goal.rate_per_week)} pro Woche`}
          </strong>
          <br />
          <span className="ac-text">
            {goal.achieved
              ? "Du hast dein Ziel erreicht."
              : goal.eta_weeks !== null
                ? `So erreichst du dein Ziel in etwa ${goal.eta_weeks} ${goal.eta_weeks === 1 ? "Woche" : "Wochen"}.`
                : goal.rate_per_week === null
                  ? "Nach ein paar Einträgen zeigt Arnold eine Prognose."
                  : "Im Moment geht es nicht in Richtung Ziel."}
          </span>
        </span>
      </div>

      {failure}

      {edit ? (
        <div className="ac-edit-box">
          <Stepper
            label={
              edit.mode === "weigh"
                ? "Dein Gewicht heute"
                : `Neues Ziel für ${goal.name}`
            }
            value={edit.value}
            unit={goal.unit === "reps" ? "Wdh." : "kg"}
            step={step}
            min={goal.unit === "reps" ? 1 : edit.mode === "weigh" ? 20 : 0.5}
            max={edit.mode === "weigh" ? 400 : 1000}
            format={(v) => formatNumber(v, goal.unit === "reps" ? 0 : 1)}
            onChange={(value) => setEdit({ ...edit, value })}
            disabled={busy}
          />
          <CardActions
            primary={{
              label: busy ? "Wird gespeichert …" : "Speichern",
              disabled: busy,
              onClick: () =>
                edit.mode === "weigh"
                  ? onSaveWeight(edit.value)
                  : onSaveTarget(edit.value),
            }}
            secondary={{
              label: "Abbrechen",
              disabled: busy,
              onClick: () => setEdit(null),
            }}
          />
        </div>
      ) : canWrite && run ? (
        <span className="ac-text">
          Den Zielwert eines Laufziels änderst du im Chat.
        </span>
      ) : canWrite ? (
        <CardActions
          primary={
            body
              ? {
                  label: "Gewicht eintragen",
                  onClick: () =>
                    setEdit({
                      mode: "weigh",
                      value: goal.current_value ?? goal.target_value,
                    }),
                }
              : {
                  label: "Ziel ändern",
                  onClick: () =>
                    setEdit({ mode: "target", value: goal.target_value }),
                }
          }
          secondary={
            body
              ? {
                  label: "Ziel ändern",
                  onClick: () =>
                    setEdit({ mode: "target", value: goal.target_value }),
                }
              : {
                  label: "Übungsverlauf",
                  onClick: () => onOpenProgress(goal.exercise_id!),
                }
          }
        />
      ) : null}
      {canWrite && !edit && (
        <button
          type="button"
          className="ac-link"
          onClick={onEnd}
          disabled={busy}
        >
          {confirmEnd ? "Wirklich beenden? Nochmal tippen" : "Ziel beenden"}
        </button>
      )}
    </ArnoldCard>
  );
}

function TargetStep({
  head,
  kind,
  exerciseId,
  exerciseName,
  loadAllowed,
  perImplement,
  best,
  bodyWeight,
  busy,
  failure,
  onKind,
  onSave,
}: {
  head: ReactNode;
  kind: ArnoldGoalKind;
  exerciseId: string | null;
  exerciseName: string;
  loadAllowed: boolean;
  perImplement: boolean;
  best?: {
    best_load_kg: number | null;
    best_reps: number | null;
  };
  bodyWeight: number | null;
  busy: boolean;
  failure: ReactNode;
  onKind: (kind: ArnoldGoalKind) => void;
  onSave: (kind: ArnoldGoalKind, target: number) => void;
}) {
  const now =
    kind === "body_weight"
      ? bodyWeight
      : kind === "exercise_reps"
        ? (best?.best_reps ?? null)
        : (best?.best_load_kg ?? null);
  const step =
    kind === "body_weight" ? 0.5 : kind === "exercise_reps" ? 1 : 2.5;
  const [target, setTarget] = useState(() =>
    kind === "body_weight"
      ? roundTo(now ?? 75, 0.5)
      : kind === "exercise_reps"
        ? (now ?? 5) + 3
        : roundTo((now ?? 20) + 5, 2.5),
  );
  const unit = kind === "exercise_reps" ? "Wdh." : "kg";
  const delta = now === null ? null : target - now;
  return (
    <ArnoldCard aria-label="Neues Ziel">
      {head}
      <h2 className="ac-title">
        {kind === "body_weight"
          ? "Dein Zielgewicht"
          : `${exerciseName}: dein Ziel`}
      </h2>
      {exerciseId && loadAllowed && (
        <ChipGroup
          label="Zielart"
          options={[
            { value: "exercise_load" as const, label: "Gewicht" },
            { value: "exercise_reps" as const, label: "Wiederholungen" },
          ]}
          value={kind as "exercise_load" | "exercise_reps"}
          onChange={(next) => next && onKind(next)}
        />
      )}
      <div className="ac-edit-box">
        <span className="ac-text">
          {now === null
            ? "Noch kein Messwert"
            : `Jetzt ${formatNumber(now, 1)} ${unit}${perImplement && kind === "exercise_load" ? " pro Hantel" : ""}`}
        </span>
        <Stepper
          label="Zielwert"
          value={target}
          unit={unit === "kg" ? "kg" : "Wdh."}
          step={step}
          min={kind === "exercise_reps" ? 1 : kind === "body_weight" ? 20 : 0.5}
          max={kind === "body_weight" ? 400 : 1000}
          format={(v) => formatNumber(v, kind === "exercise_reps" ? 0 : 1)}
          onChange={setTarget}
          disabled={busy}
        />
        {delta !== null && (
          <span className="ac-text">
            {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
            {formatNumber(Math.abs(delta), 1)} {unit} gegenüber jetzt
          </span>
        )}
      </div>
      {failure}
      <CardActions
        primary={{
          label: busy ? "Wird gespeichert …" : "Ziel speichern",
          disabled: busy,
          onClick: () => onSave(kind, target),
        }}
      />
    </ArnoldCard>
  );
}
