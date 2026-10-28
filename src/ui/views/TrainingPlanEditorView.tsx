/**
 * The interactive training plan editor.
 *
 * This is one screen for the whole plan lifecycle: look at the active plan,
 * open a new version of it, restructure it, review the difference, confirm, and
 * see the history. The user never has to navigate between pages to finish a
 * change, which is the main reason it is a single view with local panels rather
 * than a wizard.
 *
 * It is written so the onboarding (Task 006) can mount it unchanged: every
 * behaviour is driven by `usePlanEditor` plus the server state, and nothing
 * here assumes a plan already exists. `embedded` adapts it to a hosting flow —
 * it suppresses the history section, which has nothing to show on a first run,
 * and the draft lifecycle controls, because the hosting flow owns when a draft
 * is released. Editing itself is unchanged in both modes.
 *
 * The editor never computes a plan rule. Every mutation is a typed edit sent to
 * `update_plan_draft`; the server decides what is legal, and the screen shows
 * what the server stored.
 */
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Trash2,
} from "lucide-react";
import type {
  PlanExerciseOption,
  PlannedExercise,
} from "../../shared/plan-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { PLAN_STATE_TEXT, usePlanEditor } from "../hooks/usePlanEditor";
import {
  ExercisePicker,
  ExerciseSettingsPanel,
  PlanActivationDialog,
  PlanChangeSummary,
  PlanDialog,
  PlanOverview,
  PlanValidationPanel,
  PlanVersionHistory,
  TrainingSessionCard,
  targetsFromDraft,
  type SessionActions,
  type TargetDraft,
} from "../components/plan";
import { EmptyState, LoadingState } from "../components";

/**
 * Starting targets offered in the editor when a new exercise is added.
 *
 * These are form defaults the user sees and can change before saving, not
 * server-side guesses: the backend stores `null` for anything unstated, so
 * Arnold never invents a prescription behind the user's back.
 */
const SUGGESTED_TARGETS = {
  target_sets: 3,
  rep_min: 8,
  rep_max: 12,
  rest_seconds: 120,
};

/** Which dialog is open, if any. */
type Panel =
  | { kind: "add_exercise"; sessionId: string; localName?: string }
  | { kind: "replace_exercise"; exercise: PlannedExercise }
  | { kind: "settings"; exercise: PlannedExercise }
  | { kind: "add_session" }
  /** New plan family: collect the names, then the first exercise. */
  | { kind: "create_plan" }
  | { kind: "create_plan_exercise"; name: string; session_name: string };

export function TrainingPlanEditorView({
  client,
  onChanged,
  embedded = false,
}: {
  client: ArnoldMcpClient;
  onChanged: () => void;
  /** True when hosted inside another flow, e.g. the future onboarding. */
  embedded?: boolean;
}) {
  const editor = usePlanEditor(client, onChanged);
  const [panel, setPanel] = useState<Panel>();
  const [newSessionName, setNewSessionName] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const { context, plan, sessions, state, busy, canWrite } = editor;
  const validation = context?.validation ?? null;
  const editable = plan?.status === "draft";
  const close = () => setPanel(undefined);

  /** Sends one edit and closes whatever panel triggered it. */
  async function send(edit: Record<string, unknown>) {
    close();
    await editor.applyEdits([edit]);
  }

  const sessionActions = (
    sessionId: string,
    persisted: boolean,
  ): SessionActions => ({
    onRename: (session_name) =>
      void (persisted
        ? send({ type: "rename_session", session_id: sessionId, session_name })
        : editor.renameLocalSession(sessionId, session_name)),
    onMove: (direction) => {
      const order = sessions
        .filter((session) => session.persisted)
        .map((session) => session.session_id);
      const index = order.indexOf(sessionId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target], order[index]];
      void send({ type: "reorder_sessions", session_ids: order });
    },
    onDuplicate: () =>
      void send({ type: "duplicate_session", session_id: sessionId }),
    onRemove: () =>
      void (persisted
        ? send({ type: "remove_session", session_id: sessionId })
        : editor.removeLocalSession(sessionId)),
    onAddExercise: () =>
      setPanel({
        kind: "add_exercise",
        sessionId,
        localName: persisted
          ? undefined
          : sessions.find((session) => session.session_id === sessionId)
              ?.session_name,
      }),
    exerciseActions: (exercise) => ({
      onMove: (direction) => {
        const session = sessions.find((item) => item.session_id === sessionId);
        const order = (session?.exercises ?? [])
          .filter((item) => item.status === "active")
          .map((item) => item.plan_item_id);
        const index = order.indexOf(exercise.plan_item_id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= order.length) return;
        [order[index], order[target]] = [order[target], order[index]];
        void send({
          type: "reorder_plan_exercises",
          session_id: sessionId,
          plan_item_ids: order,
        });
      },
      onReplace: () => setPanel({ kind: "replace_exercise", exercise }),
      onRemove: () =>
        void send({
          type: "remove_plan_exercise",
          plan_item_id: exercise.plan_item_id,
        }),
      onSettings: () => setPanel({ kind: "settings", exercise }),
      onQuickSave: (draft: TargetDraft) =>
        void send({
          type: "update_plan_exercise_targets",
          plan_item_id: exercise.plan_item_id,
          targets: targetsFromDraft(draft),
        }),
    }),
  });

  /** A newly picked exercise, with the catalog defaults plus visible suggestions. */
  const pickedExercise = (option: PlanExerciseOption) => ({
    exercise_id: option.exercise_id,
    ...SUGGESTED_TARGETS,
    ...(option.default_load_basis === "bodyweight_only"
      ? { target_load_kg: null }
      : {}),
  });

  if (!context && !editor.error)
    return <LoadingState text="Trainingsplan wird geladen …" />;

  return (
    <div className="plan-editor">
      {/* The status line is the single place that reports what the screen is
          doing, so a saved change is never implied by the UI alone. */}
      <div className="plan-statusbar" role="status" aria-live="polite">
        <span className={`plan-state-chip ${state.toLowerCase()}`}>
          {state === "ACTIVATION_CONFIRMED" ? (
            <CheckCircle2 size={14} aria-hidden="true" />
          ) : state === "CONFLICT" ||
            state === "ERROR" ||
            state === "DRAFT_INVALID" ? (
            <AlertTriangle size={14} aria-hidden="true" />
          ) : (
            <Info size={14} aria-hidden="true" />
          )}
          {PLAN_STATE_TEXT[state]}
        </span>
        {plan && (
          <span className="plan-hint">
            {plan.name} · Version {plan.version_no} · Revision{" "}
            {plan.row_revision}
          </span>
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => editor.reload()}
        >
          <RefreshCw
            size={14}
            className={busy ? "spin" : ""}
            aria-hidden="true"
          />
          Neu laden
        </button>
      </div>

      {editor.message && (
        <p className="plan-notice success" role="status">
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>{editor.message}</span>
        </p>
      )}
      {editor.error && (
        <p className="plan-notice warning" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{editor.error}</span>
        </p>
      )}
      {editor.pending && (
        <div className="plan-notice warning" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <div>
            <strong>Unbestätigter Vorgang</strong>
            <p>
              Deine Eingaben bleiben erhalten. Der Vorgang wird mit derselben
              Operations-ID geprüft, damit nichts doppelt gespeichert wird.
            </p>
            <div className="plan-actions">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void editor.retry()}
              >
                Vorgang prüfen
              </button>
              <button
                type="button"
                className="secondary"
                onClick={editor.dismissPending}
              >
                Verwerfen
              </button>
            </div>
          </div>
        </div>
      )}

      {!canWrite && (
        <p className="plan-notice info" role="status">
          <Info size={15} aria-hidden="true" />
          <span>
            Planänderungen sind in dieser Verbindung deaktiviert. Du kannst
            deinen Trainingsplan ansehen, aber nicht bearbeiten.
          </span>
        </p>
      )}

      {/* The explanation the task asks for, shown before the first edit. */}
      {canWrite && plan && !editable && !editor.explained && (
        <div className="plan-notice info" role="status">
          <Info size={15} aria-hidden="true" />
          <div>
            <strong>
              Du bearbeitest eine neue Version deines Trainingsplans.
            </strong>
            <p>
              Deine bisherigen Trainingsdaten bleiben erhalten. Der aktive Plan
              bleibt unverändert, bis du die neue Version ausdrücklich
              bestätigst.
            </p>
          </div>
        </div>
      )}

      {!plan ? (
        <EmptyState
          title="Noch kein Trainingsplan"
          text="Lege deinen ersten Trainingsplan an. Du bestimmst die Trainingstage und die Übungen – jede Struktur ist möglich."
        >
          {canWrite && (
            <button
              type="button"
              className="primary"
              onClick={() => setPanel({ kind: "create_plan" })}
            >
              <Plus size={15} aria-hidden="true" />
              Trainingsplan anlegen
            </button>
          )}
        </EmptyState>
      ) : (
        <>
          <PlanOverview plan={plan} isActive={plan.status === "active"}>
            <div className="plan-actions">
              {canWrite && !editable && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void editor.beginEditing()}
                >
                  <Pencil size={15} aria-hidden="true" />
                  {context?.drafts.length
                    ? "Entwurf weiter bearbeiten"
                    : "Plan bearbeiten"}
                </button>
              )}
              {editable && (
                <>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => void editor.review()}
                  >
                    Änderungen prüfen
                  </button>
                  {/* The draft lifecycle belongs to whoever hosts the editor.
                      Inside the onboarding the setup owns it: its own
                      confirmation releases the plan, and activating or
                      discarding here would make the draft non-editable or
                      remove the version the setup still refers to. */}
                  {!embedded && (
                    <>
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          busy ||
                          !validation?.activatable ||
                          editor.hasUnsavedLocal
                        }
                        onClick={editor.openConfirmation}
                        title={
                          validation?.activatable
                            ? "Entwurf bestätigen und aktivieren"
                            : "Erst nach erfolgreicher Prüfung möglich"
                        }
                      >
                        <Rocket size={15} aria-hidden="true" />
                        Bestätigen und aktivieren
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void editor.discard()}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        Entwurf verwerfen
                      </button>
                    </>
                  )}
                </>
              )}
              {!embedded && (
                <>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShowHistory((value) => !value)}
                    aria-expanded={showHistory}
                  >
                    {showHistory ? "Historie ausblenden" : "Frühere Versionen"}
                  </button>
                  {canWrite && !editable && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setPanel({ kind: "create_plan" })}
                    >
                      <Plus size={14} aria-hidden="true" />
                      Weiteren Trainingsplan anlegen
                    </button>
                  )}
                </>
              )}
            </div>
          </PlanOverview>

          {context?.drafts.length && !editable ? (
            <p className="plan-notice info" role="status">
              <Info size={15} aria-hidden="true" />
              <span>
                Es gibt{" "}
                {context.drafts.length === 1
                  ? "einen offenen Entwurf"
                  : `${context.drafts.length} offene Entwürfe`}
                . Über „Entwurf weiter bearbeiten" geht es dort weiter.
              </span>
            </p>
          ) : null}

          <div className="plan-sessions">
            {sessions.map((session, index) => (
              <TrainingSessionCard
                key={session.session_id}
                session={session}
                position={index + 1}
                total={sessions.length}
                editable={!!editable && canWrite}
                busy={busy}
                validation={validation}
                actions={sessionActions(session.session_id, session.persisted)}
              />
            ))}
            {editable && canWrite && (
              <button
                type="button"
                className="plan-add-button plan-add-session"
                disabled={busy}
                onClick={() => setPanel({ kind: "add_session" })}
              >
                <Plus size={16} aria-hidden="true" />
                Trainingstag hinzufügen
              </button>
            )}
          </div>

          {validation && editable && (
            <PlanValidationPanel
              validation={validation}
              hasUnsavedLocal={editor.hasUnsavedLocal}
            />
          )}
          {editor.comparison && (
            <PlanChangeSummary comparison={editor.comparison} />
          )}

          {showHistory && context && (
            <PlanVersionHistory
              families={context.families}
              activePlanVersionId={context.active_plan_version_id}
              currentPlanVersionId={plan.plan_version_id}
              busy={busy}
              onView={(id) => void editor.select(id)}
              onReuse={(id) =>
                void editor.applyReuse(id).then(() => setShowHistory(false))
              }
            />
          )}
        </>
      )}

      {/* ----------------------------------------------------------- panels */}

      {panel?.kind === "add_session" && (
        <PlanDialog
          title="Trainingstag hinzufügen"
          description="Der Name ist frei wählbar – etwa Push, Oberkörper A oder Training 1."
          onClose={close}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = newSessionName.trim();
              if (!name) return;
              // The session is held locally until it has its first exercise:
              // the data model cannot store an empty training day.
              editor.addLocalSession(name);
              setNewSessionName("");
              close();
            }}
          >
            {/* The hint is a description, not part of the field's name. */}
            <label>
              Name der Trainingseinheit
              <input
                required
                maxLength={120}
                value={newSessionName}
                placeholder="z. B. Oberkörper A"
                aria-describedby="new-session-hint"
                onChange={(event) => setNewSessionName(event.target.value)}
              />
            </label>
            <p id="new-session-hint" className="plan-hint">
              Die Einheit wird gespeichert, sobald du ihr die erste Übung
              hinzufügst.
            </p>
            <div className="plan-actions">
              <button type="submit" className="primary">
                <Plus size={14} aria-hidden="true" />
                Hinzufügen
              </button>
              <button type="button" className="secondary" onClick={close}>
                Abbrechen
              </button>
            </div>
          </form>
        </PlanDialog>
      )}

      {panel?.kind === "create_plan" && (
        <PlanDialog
          title="Neuen Trainingsplan anlegen"
          description="Du bestimmst die Struktur. Es gibt keine Vorgabe für Split oder Anzahl der Trainingstage."
          onClose={close}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const name = String(form.get("plan_name") ?? "").trim();
              const session_name = String(
                form.get("session_name") ?? "",
              ).trim();
              if (!name || !session_name) return;
              // The first exercise comes next: a training day without one
              // cannot be stored, so the plan is created in one go.
              setPanel({ kind: "create_plan_exercise", name, session_name });
            }}
          >
            <label>
              Name des Trainingsplans
              <input
                name="plan_name"
                required
                maxLength={120}
                placeholder="z. B. Push Pull Legs"
                autoFocus
              />
            </label>
            <label>
              Erste Trainingseinheit
              <input
                name="session_name"
                required
                maxLength={120}
                placeholder="z. B. Push"
                aria-describedby="first-session-hint"
              />
            </label>
            <p id="first-session-hint" className="plan-hint">
              Weitere Trainingstage fügst du danach im Editor hinzu – beliebig
              viele.
            </p>
            <div className="plan-actions">
              <button type="submit" className="primary">
                Weiter: erste Übung wählen
              </button>
              <button type="button" className="secondary" onClick={close}>
                Abbrechen
              </button>
            </div>
          </form>
        </PlanDialog>
      )}

      {panel?.kind === "create_plan_exercise" && context && (
        <ExercisePicker
          exercises={context.exercises}
          title={`Erste Übung für „${panel.session_name}"`}
          busy={busy}
          onClose={close}
          onPick={(option) => {
            const target = panel;
            close();
            void editor.createPlan({
              name: target.name,
              session_name: target.session_name,
              exercise: pickedExercise(option),
            });
          }}
        />
      )}

      {panel?.kind === "add_exercise" && context && (
        <ExercisePicker
          exercises={context.exercises}
          title="Übung hinzufügen"
          busy={busy}
          onClose={close}
          onPick={(option) => {
            const target = panel;
            close();
            // A local session becomes real with its first exercise; an existing
            // one just gains a position.
            void (target.localName
              ? editor.persistLocalSession(
                  target.sessionId,
                  pickedExercise(option),
                )
              : editor.applyEdits([
                  {
                    type: "add_plan_exercise",
                    session_id: target.sessionId,
                    ...pickedExercise(option),
                  },
                ]));
          }}
        />
      )}

      {panel?.kind === "replace_exercise" && context && (
        <ExercisePicker
          exercises={context.exercises.filter(
            (option) => option.exercise_id !== panel.exercise.exercise_id,
          )}
          title={`„${panel.exercise.exercise_name}" austauschen`}
          busy={busy}
          onClose={close}
          onPick={(option) => {
            const replaced = panel.exercise;
            close();
            void editor.applyEdits([
              {
                type: "replace_plan_exercise",
                plan_item_id: replaced.plan_item_id,
                new_exercise_id: option.exercise_id,
                target_sets: replaced.target_sets,
                rep_min: replaced.rep_min,
                rep_max: replaced.rep_max,
                rest_seconds: replaced.rest_seconds,
              },
            ]);
          }}
        />
      )}

      {panel?.kind === "settings" && (
        <ExerciseSettingsPanel
          exercise={panel.exercise}
          busy={busy}
          onClose={close}
          onSave={(draft) => {
            const item = panel.exercise;
            close();
            void editor.applyEdits([
              {
                type: "update_plan_exercise_targets",
                plan_item_id: item.plan_item_id,
                targets: targetsFromDraft(draft),
              },
            ]);
          }}
        />
      )}

      {editor.confirming && plan && (
        <PlanActivationDialog
          plan={plan}
          comparison={editor.comparison}
          busy={busy}
          onClose={editor.closeConfirmation}
          onConfirm={() => void editor.activate()}
        />
      )}
    </div>
  );
}
