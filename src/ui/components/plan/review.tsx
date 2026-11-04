import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Info,
  Lightbulb,
} from "lucide-react";
import type {
  PlanChange,
  PlanValidationResult,
  PlanVersionComparison,
  TrainingPlanVersion,
} from "../../../shared/plan-contract";
import { PlanDialog } from "./dialog";

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
        Du bestätigst die angezeigte Version deines Plans. Deine bisherigen
        Trainings bleiben erhalten.
      </p>
    </PlanDialog>
  );
}
