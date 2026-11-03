import { useState } from "react";
import type { ArnoldDashboardView } from "../../shared/arnold-view";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useAsync } from "../hooks";
import { useModelContext } from "../hooks/useModelContext";
import {
  ArnoldCard,
  CardActions,
  CardSkeleton,
  Rows,
} from "../components/cards";
import { RecoveryCard } from "../components/recovery";
import { TrainingPlanEditorView } from "./TrainingPlanEditorView";

export function PlanCard({
  client,
  onChanged,
  dashboard,
}: {
  client: ArnoldMcpClient;
  onChanged: () => void;
  dashboard: ArnoldDashboardView;
}) {
  const result = useAsync(() => client.planContext(), [client]);
  const [editing, setEditing] = useState(false);
  const plan = result.data ? result.data.plan : dashboard.active_plan;
  const canWrite = result.data?.can_write ?? false;
  const edit = () => {
    void client.displayMode("fullscreen");
    setEditing(true);
  };
  const close = () => {
    void client.displayMode("inline");
    setEditing(false);
    result.reload();
    onChanged();
  };
  useModelContext(
    client,
    plan
      ? `Arnold zeigt den Trainingsplan „${plan.name}“, Version ${plan.version_no}, Revision ${"row_revision" in plan ? plan.row_revision : "noch nicht geladen"}, plan_version_id ${plan.plan_version_id}. Status ${plan.status}. Trainingstage: ${plan.sessions.map((s) => s.session_name).join(", ")}. ${editing ? "Der Nutzer bearbeitet den Plan im Vollbild." : "Die Karte zeigt den Überblick; Änderungen sind über den Chat oder Plan bearbeiten möglich."}`
      : "Arnold zeigt den Planüberblick. Es gibt noch keinen Trainingsplan.",
  );
  if (editing)
    return (
      <section className="ac-fullscreen">
        <div className="ac-fullscreen-head">
          <h2>Plan bearbeiten</h2>
          <button className="ac-link" onClick={close}>
            Zum Planüberblick
          </button>
        </div>
        <TrainingPlanEditorView client={client} onChanged={onChanged} />
      </section>
    );
  if (result.error && !plan)
    return (
      <RecoveryCard
        recovery={result.failure?.recovery ?? "retry_same_request"}
        onAction={result.reload}
      />
    );
  if (!result.data && !plan) return <CardSkeleton />;
  return (
    <ArnoldCard
      label={
        plan?.status === "draft" ? "Dein Planentwurf" : "Dein Trainingsplan"
      }
      title={plan?.name ?? "Dein Plan wartet auf dich"}
      subtitle={
        plan
          ? plan.days_per_week
            ? `${plan.days_per_week} ${plan.days_per_week === 1 ? "Trainingstag" : "Trainingstage"} pro Woche`
            : "Deine Trainingstage im Überblick"
          : "Erstelle deinen ersten Plan mit Arnold oder übernimm deinen eigenen."
      }
    >
      {plan && (
        <Rows
          label="Trainingstage"
          items={plan.sessions.map((s) => ({
            key: s.session_id,
            label:
              dashboard.home.next_session?.plan_version_id ===
                plan.plan_version_id &&
              dashboard.home.next_session.session_id === s.session_id ? (
                <>
                  {s.session_name} <span className="ac-pill">Als Nächstes</span>
                </>
              ) : (
                s.session_name
              ),
            value: `${"exercises" in s ? s.exercises.length : s.exercise_count} ${("exercises" in s ? s.exercises.length : s.exercise_count) === 1 ? "Übung" : "Übungen"}`,
          }))}
        />
      )}
      <CardActions
        primary={
          plan
            ? {
                label: canWrite ? "Plan bearbeiten" : "Training ansehen",
                disabled: result.loading,
                onClick: canWrite ? edit : () => void client.openDashboard(),
              }
            : {
                label: "Mit Arnold einrichten",
                onClick: () => void client.showOnboarding(),
              }
        }
        secondary={
          !plan && canWrite
            ? { label: "Plan selbst anlegen", onClick: edit }
            : undefined
        }
      />
    </ArnoldCard>
  );
}
