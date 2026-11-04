import type { ReactNode } from "react";
import { Dumbbell, History } from "lucide-react";
import type {
  TrainingPlan,
  TrainingPlanVersion,
} from "../../../shared/plan-contract";
import { dateLabel } from "../../format";
import { PLAN_STATUS_LABEL } from "./format";

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
        </dl>
        {children}
      </div>
    </div>
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
