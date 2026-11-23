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
import { PlanMobilitySessions } from "../components/plan-mobility-sessions";
import { PlanRunSessions } from "../components/plan-run-sessions";
import { PlanChangeView } from "../components/plan/change-card";
import { usePlanChange } from "../hooks/usePlanChange";
import { TrainingPlanEditorView } from "./TrainingPlanEditorView";

/**
 * `plan` shows the plan overview. `plan_change` shows only what an open draft
 * changes against the active plan, with one button to take it over.
 */
export function PlanCard({
  client,
  onChanged,
  dashboard,
  change = false,
}: {
  client: ArnoldMcpClient;
  onChanged: () => void;
  dashboard: ArnoldDashboardView;
  change?: boolean;
}) {
  return change ? (
    <PlanChangeCard client={client} onChanged={onChanged} />
  ) : (
    <PlanOverviewCard
      client={client}
      onChanged={onChanged}
      dashboard={dashboard}
    />
  );
}

function PlanChangeCard({
  client,
  onChanged,
}: {
  client: ArnoldMcpClient;
  onChanged: () => void;
}) {
  const { state, apply, decline, reload } = usePlanChange(client, onChanged);
  const [editing, setEditing] = useState(false);
  const open = () => {
    void client.displayMode("fullscreen");
    setEditing(true);
  };
  const close = () => {
    void client.displayMode("inline");
    setEditing(false);
    void reload();
    onChanged();
  };
  useModelContext(
    client,
    state.kind === "ready" || state.kind === "stale" || state.kind === "error"
      ? `Arnold zeigt die Planänderung als Unterschied: Entwurf „${state.draft.name}“, Version ${state.draft.version_no}, Revision ${state.draft.row_revision}, plan_version_id ${state.draft.plan_version_id}; ${state.rows.length} Änderungen, ${state.openDrafts} offene Entwürfe. Der Entwurf ist noch nicht aktiv; der Nutzer übernimmt ihn selbst mit dem Knopf „Übernehmen“. Nie selbst aktivieren.`
      : state.kind === "confirmed"
        ? `Der Nutzer hat den Entwurf „${state.draft.name}“, Version ${state.draft.version_no}, übernommen; er ist jetzt der aktive Plan.`
        : state.kind === "declined"
          ? `Der Nutzer hat den Entwurf „${state.draft.name}“ nicht übernommen; er ist archiviert, der Plan bleibt wie er war.`
          : undefined,
  );
  if (editing)
    return (
      <section className="ac-fullscreen">
        <div className="ac-fullscreen-head">
          <h2>Plan bearbeiten</h2>
          <button className="ac-link" onClick={close}>
            Zurück zur Änderung
          </button>
        </div>
        <TrainingPlanEditorView client={client} onChanged={onChanged} />
      </section>
    );
  return (
    <PlanChangeView
      state={state}
      onApply={() => void apply()}
      onDecline={() => void decline()}
      onReload={reload}
      onOpenEditor={open}
    />
  );
}

function PlanOverviewCard({
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
  const runSessions = plan && "run_sessions" in plan ? plan.run_sessions : [];
  const mobilitySessions =
    plan && "mobility_sessions" in plan
      ? (plan.mobility_sessions ?? []).filter((s) => s.status === "active")
      : [];
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
      ? `Arnold zeigt den Trainingsplan „${plan.name}“, Version ${plan.version_no}, Revision ${"row_revision" in plan ? plan.row_revision : "noch nicht geladen"}, plan_version_id ${plan.plan_version_id}. Status ${plan.status}. Trainingstage: ${plan.sessions.map((s) => s.session_name).join(", ")}.${runSessions?.length ? ` Laufeinheiten: ${runSessions.map((s) => s.session_name).join(", ")}.` : ""}${mobilitySessions.length ? ` Mobility: ${mobilitySessions.map((s) => s.session_name).join(", ")}.` : ""} ${editing ? "Der Nutzer bearbeitet den Plan im Vollbild." : "Die Karte zeigt den Überblick; Änderungen sind über den Chat oder Plan bearbeiten möglich."}`
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
      {runSessions && <PlanRunSessions sessions={runSessions} />}
      {plan && "mobility_sessions" in plan && (
        <PlanMobilitySessions
          sessions={plan.mobility_sessions}
          strengthSessions={plan.sessions}
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
