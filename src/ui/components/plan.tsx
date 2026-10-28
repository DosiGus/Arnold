/**
 * Reusable building blocks of the training plan editor.
 *
 * These components render finished server data and raise intent upwards. None
 * of them computes a plan rule, versions anything, or decides what is valid:
 * that all lives in `TrainingPlanService`, so the editor and a ChatGPT turn can
 * never disagree about what a plan is.
 *
 * Three UI rules are enforced here rather than left to each call site:
 *   - a technical id is never a primary label; it appears only as fine print;
 *   - a planned weight is always named as a target and always carries its load
 *     convention, so "70 kg" can never be mistaken for a logged lift;
 *   - every action is a real `<button>` inside a list with an accessible name,
 *     so the whole editor is reachable by keyboard and screen reader.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Dumbbell,
  History,
  Info,
  Lightbulb,
  Pencil,
  Plus,
  Replace,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  EXECUTION_MODE_LABEL,
  LOAD_BASIS_LABEL,
  formatLoad,
  formatNumber,
} from "../../shared/arnold-format";
import type {
  PlanChange,
  PlanExerciseOption,
  PlannedExercise,
  PlanValidationIssue,
  PlanValidationResult,
  PlanVersionComparison,
  TrainingPlan,
  TrainingPlanVersion,
  TrainingSession,
} from "../../shared/plan-contract";
import { dateLabel } from "../format";

export const PLAN_STATUS_LABEL = {
  draft: "Entwurf",
  active: "Aktiv",
  archived: "Archiviert",
} as const;

/**
 * A planned target weight, always with its convention and never bare.
 *
 * The wording comes from `formatLoad`, the one place allowed to turn a load
 * basis into text. Reassembling it here is how "20 kg pro Hantel" would turn
 * into "20 kg kg pro Hantel" — or worse, lose the convention entirely.
 */
export function targetLoadText(exercise: {
  target_load_kg: number | null;
  target_load_basis: PlannedExercise["target_load_basis"];
}): string | null {
  if (exercise.target_load_basis === "bodyweight_only") return "Körpergewicht";
  if (exercise.target_load_kg === null) return null;
  if (exercise.target_load_basis === null)
    return `Ziel ${formatNumber(exercise.target_load_kg, 2)} kg · Gewichtsdefinition fehlt`;
  return `Ziel ${formatLoad({
    load_kg: exercise.target_load_kg,
    load_basis: exercise.target_load_basis,
  })}`;
}

/** The one-line target summary shown under an exercise name. */
export function targetSummary(exercise: PlannedExercise): string {
  const parts: string[] = [];
  if (exercise.target_sets !== null)
    parts.push(
      `${exercise.target_sets} ${exercise.target_sets === 1 ? "Satz" : "Sätze"}`,
    );
  if (exercise.rep_min !== null || exercise.rep_max !== null)
    parts.push(
      exercise.rep_min !== null && exercise.rep_max !== null
        ? exercise.rep_min === exercise.rep_max
          ? `${exercise.rep_min} Wdh.`
          : `${exercise.rep_min}–${exercise.rep_max} Wdh.`
        : `${exercise.rep_min ?? exercise.rep_max} Wdh.`,
    );
  const load = targetLoadText(exercise);
  if (load) parts.push(load);
  if (
    exercise.target_execution_mode &&
    exercise.target_execution_mode !== "bilateral_simultaneous"
  )
    parts.push(EXECUTION_MODE_LABEL[exercise.target_execution_mode]);
  if (exercise.rest_seconds !== null)
    parts.push(`${exercise.rest_seconds} s Pause`);
  return parts.length ? parts.join(" · ") : "Noch keine Zielwerte";
}

/* ------------------------------------------------------------ small pieces */

function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      className={`plan-icon-button ${tone ?? ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

/** A modal panel. Focus moves in on open and Escape always closes it. */
export function PlanDialog({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = panel.current;
    // Focus the first field the dialog is actually about — the search box, the
    // first input — and only fall back to a button when it has none. Landing on
    // the close button would make every dialog open on "cancel".
    const focusable = () =>
      [
        ...(dialog?.querySelectorAll<HTMLElement>(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
        ) ?? []),
      ].filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
    (
      dialog?.querySelector<HTMLElement>(
        ".plan-dialog-body input:not([disabled]), .plan-dialog-body select:not([disabled]), .plan-dialog-body textarea:not([disabled])",
      ) ?? focusable()[0]
    )?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // `aria-modal` promises the rest of the page is inert, so Tab must stay
      // inside the dialog rather than walking into the editor behind it.
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!dialog?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="plan-dialog-backdrop" onClick={onClose}>
      <div
        className="plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="plan-dialog-head">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="Dialog schließen" icon={X} onClick={onClose} />
        </div>
        <div className="plan-dialog-body">{children}</div>
        {footer && <div className="plan-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ ExercisePicker */

/**
 * Catalog search.
 *
 * Deliberately never auto-selects on an ambiguous match: if a name matches
 * several variants, the user picks the variant. Guessing between a barbell and
 * a dumbbell bench press would silently change what the plan prescribes.
 */
export function ExercisePicker({
  exercises,
  title,
  onPick,
  onClose,
  busy,
}: {
  exercises: readonly PlanExerciseOption[];
  title: string;
  onPick: (exercise: PlanExerciseOption) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const normalized = query
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
  const matches = useMemo(
    () =>
      exercises.filter((exercise) =>
        !normalized
          ? true
          : [
              exercise.name_de,
              exercise.name_en ?? "",
              exercise.equipment,
              exercise.primary_muscle,
            ]
              .join(" ")
              .normalize("NFKD")
              .replace(/\p{M}/gu, "")
              .toLowerCase()
              .includes(normalized),
      ),
    [exercises, normalized],
  );
  return (
    <PlanDialog
      title={title}
      description="Such nach Name, Gerät oder Muskelgruppe. Die Ausführung wird aus dem Übungskatalog übernommen."
      onClose={onClose}
    >
      <label>
        Übung suchen
        <input
          type="search"
          value={query}
          placeholder="z. B. Bankdrücken, Kurzhantel, Rücken"
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby="picker-count"
        />
      </label>
      <p id="picker-count" className="plan-hint" role="status">
        {matches.length === 0
          ? "Keine passende Übung gefunden."
          : `${matches.length} ${matches.length === 1 ? "Übung" : "Übungen"} gefunden.`}
      </p>
      <ul className="plan-picker-list">
        {matches.map((exercise) => (
          <li key={exercise.exercise_id}>
            <button
              type="button"
              className="plan-picker-item"
              disabled={busy}
              onClick={() => onPick(exercise)}
            >
              <span className="plan-picker-name">
                <strong>{exercise.name_de}</strong>
                <small>
                  {exercise.primary_muscle} · {exercise.equipment} ·{" "}
                  {LOAD_BASIS_LABEL[exercise.default_load_basis]}
                  {exercise.default_execution_mode !== "bilateral_simultaneous"
                    ? ` · ${EXECUTION_MODE_LABEL[exercise.default_execution_mode]}`
                    : ""}
                </small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </PlanDialog>
  );
}

/* ----------------------------------------------------- ExerciseSettingsPanel */

export type TargetDraft = {
  target_sets: string;
  rep_min: string;
  rep_max: string;
  target_load_kg: string;
  target_load_basis: string;
  target_execution_mode: string;
  target_implement_count: string;
  rest_seconds: string;
  notes: string;
};

export const draftFromExercise = (exercise: PlannedExercise): TargetDraft => ({
  target_sets:
    exercise.target_sets === null ? "" : String(exercise.target_sets),
  rep_min: exercise.rep_min === null ? "" : String(exercise.rep_min),
  rep_max: exercise.rep_max === null ? "" : String(exercise.rep_max),
  target_load_kg:
    exercise.target_load_kg === null ? "" : String(exercise.target_load_kg),
  target_load_basis: exercise.target_load_basis ?? "",
  target_execution_mode: exercise.target_execution_mode ?? "",
  target_implement_count:
    exercise.target_implement_count === null
      ? ""
      : String(exercise.target_implement_count),
  rest_seconds:
    exercise.rest_seconds === null ? "" : String(exercise.rest_seconds),
  notes: exercise.notes ?? "",
});

/** Turns the form strings back into the typed target payload. */
export function targetsFromDraft(draft: TargetDraft) {
  const number = (value: string) =>
    value.trim() === "" ? null : Number(value);
  return {
    target_sets: number(draft.target_sets),
    rep_min: number(draft.rep_min),
    rep_max: number(draft.rep_max),
    target_load_kg: number(draft.target_load_kg),
    target_load_basis:
      draft.target_load_basis === "" ? null : draft.target_load_basis,
    target_execution_mode:
      draft.target_execution_mode === "" ? null : draft.target_execution_mode,
    target_implement_count: number(draft.target_implement_count),
    rest_seconds: number(draft.rest_seconds),
    notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
  };
}

/**
 * The full settings of one planned exercise.
 *
 * Shown as a dialog because these are the rarer decisions; sets, reps and the
 * target weight are also editable inline on the card itself.
 */
export function ExerciseSettingsPanel({
  exercise,
  busy,
  onSave,
  onClose,
}: {
  exercise: PlannedExercise;
  busy?: boolean;
  onSave: (draft: TargetDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TargetDraft>(() =>
    draftFromExercise(exercise),
  );
  const set = <K extends keyof TargetDraft>(key: K, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const bodyweight = draft.target_load_basis === "bodyweight_only";
  return (
    <PlanDialog
      title={exercise.exercise_name}
      description="Zielwerte und Ausführung dieser Planposition. Geplante Werte, nicht tatsächlich geloggte Sätze."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onSave(draft)}
          >
            <Check size={14} aria-hidden="true" />
            {busy ? "Wird gespeichert …" : "Übernehmen"}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label>
          Zielsätze
          <input
            type="number"
            min="1"
            max="50"
            step="1"
            value={draft.target_sets}
            onChange={(event) => set("target_sets", event.target.value)}
          />
        </label>
        <label>
          Pause (Sekunden)
          <input
            type="number"
            min="0"
            step="5"
            value={draft.rest_seconds}
            onChange={(event) => set("rest_seconds", event.target.value)}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Wiederholungen von
          <input
            type="number"
            min="0"
            step="1"
            value={draft.rep_min}
            onChange={(event) => set("rep_min", event.target.value)}
          />
        </label>
        <label>
          Wiederholungen bis
          <input
            type="number"
            min="0"
            step="1"
            value={draft.rep_max}
            onChange={(event) => set("rep_max", event.target.value)}
          />
        </label>
      </div>
      {/* Hints are descriptions, so the accessible name of each field stays
          exactly its label. */}
      <label>
        Gewichtsdefinition
        <select
          value={draft.target_load_basis}
          aria-describedby="load-basis-hint"
          onChange={(event) => set("target_load_basis", event.target.value)}
        >
          <option value="">Keine Angabe</option>
          {Object.entries(LOAD_BASIS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p id="load-basis-hint" className="plan-hint">
        Legt fest, wie das Zielgewicht zu lesen ist – etwa gesamt oder pro
        Hantel.
      </p>
      <label>
        Zielgewicht (kg)
        <input
          type="number"
          min="0"
          step="any"
          value={bodyweight ? "" : draft.target_load_kg}
          disabled={bodyweight}
          aria-describedby="target-load-hint"
          onChange={(event) => set("target_load_kg", event.target.value)}
        />
      </label>
      <p id="target-load-hint" className="plan-hint">
        {bodyweight
          ? 'Bei "Körpergewicht" ist kein Zielgewicht vorgesehen. Für Zusatzlast die Definition "Zusatzgewicht" wählen.'
          : "Optional. Ohne Angabe bleibt das Ziel offen."}
      </p>
      <div className="form-row">
        <label>
          Ausführung
          <select
            value={draft.target_execution_mode}
            onChange={(event) =>
              set("target_execution_mode", event.target.value)
            }
          >
            <option value="">Keine Angabe</option>
            {Object.entries(EXECUTION_MODE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Anzahl Geräte
          <input
            type="number"
            min="1"
            step="1"
            value={draft.target_implement_count}
            onChange={(event) =>
              set("target_implement_count", event.target.value)
            }
          />
        </label>
      </div>
      <label>
        Notiz
        <input
          type="text"
          value={draft.notes}
          placeholder="z. B. langsam ablassen"
          onChange={(event) => set("notes", event.target.value)}
        />
      </label>
      <p className="plan-hint">
        Planposition {exercise.plan_item_id} · Revision {exercise.row_revision}
      </p>
    </PlanDialog>
  );
}

/* -------------------------------------------------------- PlannedExerciseRow */

export type ExerciseRowActions = {
  onMove: (direction: -1 | 1) => void;
  onReplace: () => void;
  onRemove: () => void;
  onSettings: () => void;
  onQuickSave: (draft: TargetDraft) => void;
};

/**
 * One exercise inside a session card.
 *
 * Read-only in overview mode. In edit mode the common decisions (sets, reps,
 * target weight) open inline on the card, so the frequent edits need no dialog
 * and no page change.
 */
export function PlannedExerciseRow({
  exercise,
  position,
  total,
  editable,
  busy,
  issues,
  actions,
}: {
  exercise: PlannedExercise;
  position: number;
  total: number;
  editable: boolean;
  busy?: boolean;
  issues?: readonly PlanValidationIssue[];
  actions?: ExerciseRowActions;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TargetDraft>(() =>
    draftFromExercise(exercise),
  );
  useEffect(() => setDraft(draftFromExercise(exercise)), [exercise]);
  const blocking = (issues ?? []).filter((issue) => issue.severity === "error");
  const advisory = (issues ?? []).filter((issue) => issue.severity !== "error");
  const bodyweight = draft.target_load_basis === "bodyweight_only";
  return (
    <li className={`plan-exercise ${blocking.length ? "has-error" : ""}`}>
      <div className="plan-exercise-main">
        <span className="plan-exercise-index" aria-hidden="true">
          {position}
        </span>
        <div className="plan-exercise-text">
          <strong>
            {exercise.exercise_name}
            {!exercise.exercise_active && (
              <span className="plan-tag warning">Ausgemustert</span>
            )}
          </strong>
          <small>{targetSummary(exercise)}</small>
          {blocking.map((issue) => (
            <small
              key={issue.code + issue.field}
              className="plan-issue error"
              role="alert"
            >
              <AlertTriangle size={12} aria-hidden="true" /> {issue.message}
            </small>
          ))}
          {advisory.map((issue) => (
            <small key={issue.code + issue.field} className="plan-issue">
              <Info size={12} aria-hidden="true" /> {issue.message}
            </small>
          ))}
        </div>
        {editable && actions && (
          <div className="plan-exercise-actions">
            <IconButton
              label={`${exercise.exercise_name} nach oben verschieben`}
              icon={ArrowUp}
              disabled={busy || position === 1}
              onClick={() => actions.onMove(-1)}
            />
            <IconButton
              label={`${exercise.exercise_name} nach unten verschieben`}
              icon={ArrowDown}
              disabled={busy || position === total}
              onClick={() => actions.onMove(1)}
            />
            <IconButton
              label={`Zielwerte von ${exercise.exercise_name} bearbeiten`}
              icon={Pencil}
              disabled={busy}
              onClick={() => setOpen((value) => !value)}
            />
            <IconButton
              label={`${exercise.exercise_name} austauschen`}
              icon={Replace}
              disabled={busy}
              onClick={actions.onReplace}
            />
            <IconButton
              label={`Weitere Einstellungen für ${exercise.exercise_name}`}
              icon={Settings2}
              disabled={busy}
              onClick={actions.onSettings}
            />
            <IconButton
              label={`${exercise.exercise_name} aus dem Entwurf entfernen`}
              icon={Trash2}
              tone="danger"
              disabled={busy}
              onClick={actions.onRemove}
            />
          </div>
        )}
      </div>
      {editable && actions && open && (
        <form
          className="plan-quick-edit"
          onSubmit={(event) => {
            event.preventDefault();
            actions.onQuickSave(draft);
            setOpen(false);
          }}
        >
          <fieldset disabled={busy}>
            <div className="plan-quick-grid">
              <label>
                Sätze
                <input
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  value={draft.target_sets}
                  onChange={(event) =>
                    setDraft({ ...draft, target_sets: event.target.value })
                  }
                />
              </label>
              <label>
                Wdh. von
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.rep_min}
                  onChange={(event) =>
                    setDraft({ ...draft, rep_min: event.target.value })
                  }
                />
              </label>
              <label>
                Wdh. bis
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.rep_max}
                  onChange={(event) =>
                    setDraft({ ...draft, rep_max: event.target.value })
                  }
                />
              </label>
              <label>
                Zielgewicht (kg)
                <input
                  type="number"
                  min="0"
                  step="any"
                  disabled={bodyweight}
                  value={bodyweight ? "" : draft.target_load_kg}
                  onChange={(event) =>
                    setDraft({ ...draft, target_load_kg: event.target.value })
                  }
                />
              </label>
            </div>
            <p className="plan-hint">
              {bodyweight
                ? "Diese Übung ist auf Körpergewicht eingestellt."
                : `Gewichtsdefinition: ${
                    draft.target_load_basis
                      ? LOAD_BASIS_LABEL[
                          draft.target_load_basis as keyof typeof LOAD_BASIS_LABEL
                        ]
                      : "keine Angabe"
                  }. Geplanter Zielwert, kein geloggtes Gewicht.`}
            </p>
            <div className="plan-quick-actions">
              <button type="submit" className="primary">
                <Check size={14} aria-hidden="true" />
                Zielwerte übernehmen
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDraft(draftFromExercise(exercise));
                  setOpen(false);
                }}
              >
                Abbrechen
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </li>
  );
}

/* --------------------------------------------------------- TrainingSessionCard */

export type SessionActions = {
  onRename: (name: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onAddExercise: () => void;
  exerciseActions: (exercise: PlannedExercise) => ExerciseRowActions;
};

/** One training day. Its name is free text and never derived from a split. */
export function TrainingSessionCard({
  session,
  position,
  total,
  editable,
  busy,
  validation,
  actions,
}: {
  session: TrainingSession;
  position: number;
  total: number;
  editable: boolean;
  busy?: boolean;
  validation?: PlanValidationResult | null;
  actions?: SessionActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.session_name);
  useEffect(() => setName(session.session_name), [session.session_name]);
  const active = session.exercises.filter(
    (exercise) => exercise.status === "active",
  );
  const issuesFor = (planItemId: string) =>
    [...(validation?.errors ?? []), ...(validation?.warnings ?? [])].filter(
      (issue) => issue.plan_item_id === planItemId,
    );
  const sessionIssues = [
    ...(validation?.errors ?? []),
    ...(validation?.warnings ?? []),
  ].filter(
    (issue) => issue.session_id === session.session_id && !issue.plan_item_id,
  );

  return (
    <section
      className="card plan-session"
      aria-label={`Trainingseinheit ${session.session_name}`}
    >
      <header className="plan-session-head">
        <div className="plan-session-title">
          <span className="plan-session-index" aria-hidden="true">
            {position}
          </span>
          {renaming ? (
            <form
              className="plan-rename"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = name.trim();
                if (trimmed && trimmed !== session.session_name)
                  actions?.onRename(trimmed);
                setRenaming(false);
              }}
            >
              <label>
                <span className="visually-hidden">
                  Name der Trainingseinheit
                </span>
                <input
                  value={name}
                  required
                  maxLength={120}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <button type="submit" className="primary" disabled={busy}>
                <Check size={14} aria-hidden="true" />
                Übernehmen
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setName(session.session_name);
                  setRenaming(false);
                }}
              >
                Abbrechen
              </button>
            </form>
          ) : (
            <div>
              <h2>{session.session_name}</h2>
              <p>
                {active.length} {active.length === 1 ? "Übung" : "Übungen"}
                {session.removed_exercise_count > 0 &&
                  ` · ${session.removed_exercise_count} entfernt`}
                {!session.persisted && (
                  <span className="plan-tag warning">
                    Noch nicht gespeichert
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
        {editable && actions && !renaming && (
          <div className="plan-session-actions">
            <IconButton
              label={`${session.session_name} umbenennen`}
              icon={Pencil}
              disabled={busy}
              onClick={() => setRenaming(true)}
            />
            <IconButton
              label={`${session.session_name} nach oben verschieben`}
              icon={ArrowUp}
              disabled={busy || position === 1 || !session.persisted}
              onClick={() => actions.onMove(-1)}
            />
            <IconButton
              label={`${session.session_name} nach unten verschieben`}
              icon={ArrowDown}
              disabled={busy || position === total || !session.persisted}
              onClick={() => actions.onMove(1)}
            />
            <IconButton
              label={`${session.session_name} duplizieren`}
              icon={Copy}
              disabled={busy || !session.persisted}
              onClick={actions.onDuplicate}
            />
            <IconButton
              label={`${session.session_name} aus dem Entwurf entfernen`}
              icon={Trash2}
              tone="danger"
              disabled={busy}
              onClick={actions.onRemove}
            />
          </div>
        )}
      </header>

      {!session.persisted && (
        <p className="plan-notice info" role="status">
          <Info size={15} aria-hidden="true" />
          <span>
            Diese Trainingseinheit ist erst gespeichert, wenn sie mindestens
            eine Übung enthält. Das Datenmodell kennt keine leere Einheit.
          </span>
        </p>
      )}
      {sessionIssues.map((issue) => (
        <p
          key={issue.code}
          className={`plan-notice ${issue.severity === "error" ? "warning" : "info"}`}
          role={issue.severity === "error" ? "alert" : "status"}
        >
          {issue.severity === "error" ? (
            <AlertTriangle size={15} aria-hidden="true" />
          ) : (
            <Info size={15} aria-hidden="true" />
          )}
          <span>{issue.message}</span>
        </p>
      ))}

      {active.length === 0 ? (
        <p className="plan-empty">Noch keine Übung in dieser Einheit.</p>
      ) : (
        <ol className="plan-exercise-list">
          {active.map((exercise, index) => (
            <PlannedExerciseRow
              key={exercise.plan_item_id}
              exercise={exercise}
              position={index + 1}
              total={active.length}
              editable={editable}
              busy={busy}
              issues={issuesFor(exercise.plan_item_id)}
              actions={actions?.exerciseActions(exercise)}
            />
          ))}
        </ol>
      )}

      {editable && actions && (
        <button
          type="button"
          className="plan-add-button"
          disabled={busy}
          onClick={actions.onAddExercise}
        >
          <Plus size={15} aria-hidden="true" />
          Übung hinzufügen
        </button>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- PlanOverview */

/** The read-only plan, as shown before editing starts. */
export function PlanOverview({
  plan,
  isActive,
  children,
}: {
  plan: TrainingPlanVersion;
  isActive: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="plan-overview">
      <div className="card plan-summary">
        <div className="plan-summary-head">
          <span className="logger-icon" aria-hidden="true">
            <Dumbbell size={18} />
          </span>
          <div>
            <h2>{plan.name}</h2>
            <p>
              <span className={`plan-tag ${plan.status}`}>
                {PLAN_STATUS_LABEL[plan.status]}
              </span>
              {` Version ${plan.version_no}`}
              {plan.split_key ? ` · ${plan.split_key}` : ""}
              {plan.days_per_week !== null
                ? ` · ${plan.days_per_week} ${plan.days_per_week === 1 ? "Trainingstag" : "Trainingstage"} pro Woche`
                : ""}
            </p>
          </div>
        </div>
        <dl className="plan-facts">
          <div>
            <dt>Trainingseinheiten</dt>
            <dd>{plan.session_count}</dd>
          </div>
          <div>
            <dt>Übungen</dt>
            <dd>{plan.exercise_count}</dd>
          </div>
          <div>
            <dt>Zugeordnete Trainings</dt>
            <dd>{plan.workout_count}</dd>
          </div>
          <div>
            <dt>{isActive ? "Aktiv seit" : "Stand"}</dt>
            <dd>
              {dateLabel(
                (isActive ? plan.activated_at_utc : plan.updated_at_utc)?.slice(
                  0,
                  10,
                ) ?? plan.created_at_utc.slice(0, 10),
              )}
            </dd>
          </div>
        </dl>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- PlanValidationPanel */

const SEVERITY = {
  error: { label: "Blockierende Fehler", icon: AlertTriangle, tone: "warning" },
  warning: { label: "Hinweise", icon: Info, tone: "info" },
  recommendation: { label: "Empfehlungen", icon: Lightbulb, tone: "info" },
} as const;

/**
 * The validation result.
 *
 * The three registers stay visually separate: only an error blocks activation,
 * and a training recommendation is never dressed up as a defect.
 */
export function PlanValidationPanel({
  validation,
  hasUnsavedLocal,
}: {
  validation: PlanValidationResult;
  hasUnsavedLocal?: boolean;
}) {
  const groups = [
    ["error", validation.errors],
    ["warning", validation.warnings],
    ["recommendation", validation.recommendations],
  ] as const;
  return (
    <section className="card plan-validation" aria-label="Prüfergebnis">
      <div className="plan-validation-head">
        {validation.valid ? (
          <CheckCircle2
            size={18}
            className="plan-valid-icon"
            aria-hidden="true"
          />
        ) : (
          <AlertTriangle size={18} aria-hidden="true" />
        )}
        <div>
          <h3>
            {validation.valid
              ? "Plan ist gültig"
              : "Plan ist noch nicht aktivierbar"}
          </h3>
          <p>
            {validation.valid
              ? "Alle Pflichtangaben sind vorhanden. Du kannst den Entwurf bestätigen."
              : `${validation.errors.length} ${validation.errors.length === 1 ? "Fehler muss" : "Fehler müssen"} behoben werden.`}
          </p>
        </div>
      </div>
      {hasUnsavedLocal && (
        <p className="plan-notice warning" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            Es gibt Trainingseinheiten ohne Übung, die noch nicht gespeichert
            sind. Füge eine Übung hinzu oder entferne die Einheit.
          </span>
        </p>
      )}
      {groups.map(([severity, issues]) =>
        issues.length === 0 ? null : (
          <div key={severity} className="plan-issue-group">
            <h4>
              {SEVERITY[severity].label} ({issues.length})
            </h4>
            <ul>
              {issues.map((issue, index) => (
                <li
                  key={`${issue.code}-${index}`}
                  className={SEVERITY[severity].tone}
                >
                  <span className="plan-issue-code">{issue.code}</span>
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
      {validation.valid &&
        !validation.warnings.length &&
        !validation.recommendations.length && (
          <p className="plan-hint">
            Keine Hinweise. Schema {validation.schema_version}.
          </p>
        )}
    </section>
  );
}

/* --------------------------------------------------------- PlanChangeSummary */

const CHANGE_GROUP: Record<PlanChange["kind"], string> = {
  plan_renamed: "Plan",
  plan_metadata_changed: "Plan",
  session_added: "Trainingseinheiten",
  session_removed: "Trainingseinheiten",
  session_renamed: "Trainingseinheiten",
  session_reordered: "Trainingseinheiten",
  exercise_added: "Übungen",
  exercise_removed: "Übungen",
  exercise_replaced: "Übungen",
  exercise_reordered: "Übungen",
  targets_changed: "Zielwerte",
  execution_changed: "Ausführung",
};

/** What changed against the currently active plan, grouped for review. */
export function PlanChangeSummary({
  comparison,
}: {
  comparison: PlanVersionComparison;
}) {
  const grouped = new Map<string, PlanChange[]>();
  for (const change of comparison.changes) {
    const key = CHANGE_GROUP[change.kind];
    const bucket = grouped.get(key);
    if (bucket) bucket.push(change);
    else grouped.set(key, [change]);
  }
  return (
    <section className="card plan-changes" aria-label="Änderungsübersicht">
      <h3>Das ändert sich</h3>
      <p>
        Vergleich von „{comparison.from.name}" (Version{" "}
        {comparison.from.version_no}) mit deinem Entwurf.
      </p>
      <p className="plan-headline">{comparison.headline.join(" · ")}</p>
      {comparison.changes.length === 0 ? (
        <p className="plan-empty">
          Keine inhaltlichen Unterschiede zum aktiven Plan.
        </p>
      ) : (
        [...grouped].map(([group, changes]) => (
          <div key={group} className="plan-issue-group">
            <h4>
              {group} ({changes.length})
            </h4>
            <ul>
              {changes.map((change, index) => (
                <li key={`${change.kind}-${index}`}>{change.label}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/* -------------------------------------------------------- PlanVersionHistory */

/** Earlier versions, with the option to reuse one as a new draft. */
export function PlanVersionHistory({
  families,
  activePlanVersionId,
  currentPlanVersionId,
  busy,
  onView,
  onReuse,
}: {
  families: readonly TrainingPlan[];
  activePlanVersionId: string | null;
  currentPlanVersionId?: string;
  busy?: boolean;
  onView: (planVersionId: string) => void;
  onReuse: (planVersionId: string) => void;
}) {
  return (
    <section className="card plan-history" aria-label="Planhistorie">
      <div className="plan-session-title">
        <span className="logger-icon" aria-hidden="true">
          <History size={17} />
        </span>
        <div>
          <h3>Deine Trainingspläne</h3>
          <p>Frühere Versionen bleiben unverändert erhalten.</p>
        </div>
      </div>
      {families.map((family) => (
        <div key={family.plan_family_id} className="plan-family">
          <h4>{family.name}</h4>
          <ul className="plan-version-list">
            {family.versions.map((version) => (
              <li
                key={version.plan_version_id}
                className={
                  version.plan_version_id === currentPlanVersionId
                    ? "is-current"
                    : ""
                }
              >
                <div className="plan-version-text">
                  <strong>
                    Version {version.version_no}
                    <span className={`plan-tag ${version.status}`}>
                      {PLAN_STATUS_LABEL[version.status]}
                    </span>
                  </strong>
                  <small>
                    {version.name} · {version.session_count}{" "}
                    {version.session_count === 1 ? "Einheit" : "Einheiten"} ·{" "}
                    {version.exercise_count} Übungen
                    {version.workout_count > 0
                      ? ` · ${version.workout_count} ${version.workout_count === 1 ? "Training" : "Trainings"}`
                      : ""}
                  </small>
                  <small>
                    {version.activated_at_utc
                      ? `Aktiv ab ${dateLabel(version.activated_at_utc.slice(0, 10))}`
                      : `Entwurf vom ${dateLabel(version.created_at_utc.slice(0, 10))}`}
                    {version.retired_at_utc
                      ? ` · archiviert am ${dateLabel(version.retired_at_utc.slice(0, 10))}`
                      : ""}
                  </small>
                </div>
                <div className="plan-version-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onView(version.plan_version_id)}
                  >
                    Ansehen
                  </button>
                  {version.plan_version_id !== activePlanVersionId &&
                    version.status !== "draft" && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => onReuse(version.plan_version_id)}
                      >
                        Wieder verwenden
                      </button>
                    )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------------------------------- PlanActivationDialog */

/**
 * The final confirmation.
 *
 * It names the exact version and revision being confirmed, because that pair is
 * what the server checks. Navigation alone can never activate a plan: only this
 * dialog's button sends the confirmation.
 */
export function PlanActivationDialog({
  plan,
  comparison,
  busy,
  onConfirm,
  onClose,
}: {
  plan: TrainingPlanVersion;
  comparison?: PlanVersionComparison;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <PlanDialog
      title="Trainingsplan aktivieren"
      description="Ab sofort trainierst du nach diesem Plan. Deine bisherigen Trainingsdaten bleiben vollständig erhalten."
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Zurück zum Entwurf
          </button>
          <button
            type="button"
            className="primary"
            onClick={onConfirm}
            disabled={busy}
          >
            <Check size={14} aria-hidden="true" />
            {busy ? "Wird aktiviert …" : "Bestätigen und aktivieren"}
          </button>
        </>
      }
    >
      <p>
        <strong>{plan.name}</strong> — Version {plan.version_no} mit{" "}
        {plan.session_count}{" "}
        {plan.session_count === 1 ? "Trainingseinheit" : "Trainingseinheiten"}{" "}
        und {plan.exercise_count} Übungen.
      </p>
      <ul className="plan-confirm-list">
        {plan.sessions.map((session) => (
          <li key={session.session_id}>
            <strong>{session.session_name}</strong>
            <small>
              {session.exercises
                .filter((exercise) => exercise.status === "active")
                .map((exercise) => exercise.exercise_name)
                .join(" · ")}
            </small>
          </li>
        ))}
      </ul>
      {comparison && comparison.changes.length > 0 && (
        <p className="plan-headline">{comparison.headline.join(" · ")}</p>
      )}
      <p className="plan-notice info">
        <Info size={15} aria-hidden="true" />
        <span>
          Die bisher aktive Version wird archiviert und bleibt lesbar. Bereits
          abgeschlossene und laufende Trainings behalten ihren ursprünglichen
          Plan.
        </span>
      </p>
      <p className="plan-hint">
        Bestätigt wird genau Planversion {plan.plan_version_id} in Revision{" "}
        {plan.row_revision}. Änderst du den Entwurf danach noch, ist eine neue
        Bestätigung nötig.
      </p>
    </PlanDialog>
  );
}
