/**
 * The onboarding wizard.
 *
 * One screen per phase, driven entirely by the server state in `useOnboarding`.
 * The view decides what to render; it never decides what is allowed — the status
 * and `allowed_events` come from the state machine, so a button cannot exist for
 * a transition the server would refuse.
 *
 * The plan phase mounts `TrainingPlanEditorView` from Task 005 unchanged, with
 * `embedded` set. That is deliberate and is the whole of §14: there is exactly
 * one plan editor in the product, every edit goes through `update_plan_draft`,
 * and the onboarding only governs *when* the editor is on screen and when a
 * confirmed plan may move on.
 *
 * Local answer state exists only for the step being filled in. Everything the
 * user has finished is already on the server, which is why navigating back
 * cannot lose data.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, Info, RefreshCw } from "lucide-react";
import type { OnboardingState } from "../../shared/onboarding-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { OWN_PLAN_MESSAGE, useOnboarding } from "../hooks/useOnboarding";
import {
  CancelOnboardingButton,
  GoogleConnectionHandoffStep,
  OnboardingErrorState,
  OnboardingIssues,
  OnboardingLayout,
  OnboardingLoading,
  OnboardingNotice,
  OnboardingResumeState,
  OwnPlanStep,
  PlanConfirmationDialog,
  PlanGenerationStep,
  ProfileStep,
  WelcomeStep,
} from "../components/onboarding";
import { TrainingPlanEditorView } from "./TrainingPlanEditorView";

export function OnboardingView({
  client,
  initial,
  onFinishedHandoff,
}: {
  client: ArnoldMcpClient;
  initial?: OnboardingState;
  /** Kept for callers; the server's step decides where a resumed setup opens. */
  resumed?: boolean;
  /** Called when the setup reaches the handoff, so a shell can react. */
  onFinishedHandoff?: () => void;
}) {
  const onb = useOnboarding(client, initial);
  const { state, session, step, progress, validation } = onb;
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (session?.status === "AWAITING_GOOGLE_CONNECTION") onFinishedHandoff?.();
  }, [onFinishedHandoff, session?.status]);

  if (onb.ui === "LOADING")
    return (
      <div className="onb-shell">
        <OnboardingLoading />
      </div>
    );

  if (onb.ui === "NO_SESSION")
    return (
      <div className="onb-shell">
        <OnboardingErrorState
          message={onb.error}
          onRestart={() => void onb.restart()}
        />
      </div>
    );

  if (!state || !session || !progress || !validation)
    return (
      <div className="onb-shell">
        <OnboardingErrorState
          message={
            onb.error || "Der Einrichtungsstand konnte nicht geladen werden."
          }
          onRetry={() => void onb.reload(true)}
          onRestart={() => void onb.restart()}
        />
      </div>
    );

  if (onb.expired || onb.cancelled)
    return (
      <div className="onb-shell">
        <OnboardingResumeState
          kind={onb.expired ? "expired" : "cancelled"}
          onRestart={() => void onb.restart()}
          busy={onb.busy}
        />
      </div>
    );

  if (session.status === "COMPLETED")
    return (
      <div className="onb-shell">
        <OnboardingLayout
          title="Deine Einrichtung ist abgeschlossen."
          lead="Google ist verbunden. Dein bestätigter Trainingsplan liegt in deiner persönlichen Trainingsdatei."
        >
          <button
            type="button"
            className="primary"
            onClick={() => void client.openDashboard()}
          >
            Zum Training
          </button>
        </OnboardingLayout>
      </div>
    );

  const profile = session.profile;
  const banner = (
    <>
      {onb.error && (
        <div className="onb-notice warning" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>Das konnte nicht gespeichert werden</strong>
            <p>{onb.error}</p>
          </div>
        </div>
      )}
      {onb.message && (
        <p className="onb-flash" role="status">
          {onb.message}
        </p>
      )}
      {/* A replayed or diverged state is labelled, never presented as current. */}
      {state.handoff.status === "superseded" && (
        <OnboardingNotice
          tone="warning"
          title="Deine Bestätigung ist nicht mehr gültig"
        >
          <p>{state.handoff.blocked_reason}</p>
        </OnboardingNotice>
      )}
    </>
  );

  /* ------------------------------------------------------------- plan phase */

  const planPhase =
    session.status === "WAITING_FOR_PLAN_PROPOSAL" ||
    session.status === "REVIEWING_PLAN" ||
    session.status === "PLAN_CONFIRMED" ||
    session.status === "AWAITING_GOOGLE_CONNECTION";

  if (planPhase) {
    // Confirmed and released: the handoff screen, and nothing that suggests a
    // Google file now exists.
    if (
      session.status === "AWAITING_GOOGLE_CONNECTION" &&
      state.handoff.status === "ready_for_google_connection" &&
      state.plan
    )
      return (
        <div className="onb-shell">
          {banner}
          <GoogleConnectionHandoffStep
            planName={state.plan.name}
            revision={
              state.handoff.confirmed_plan_revision ?? state.plan.row_revision
            }
            sessionCount={state.plan.session_count}
            exerciseCount={state.plan.exercise_count}
            onRevise={() => void onb.revisePlan()}
            available={state.google_connection_available}
            onConnect={() => void onb.connectGoogle()}
            onRefresh={() => void onb.finishSetup()}
            busy={onb.busy}
          />
        </div>
      );

    // Waiting for a proposal, and none has arrived: the honest handoff to chat.
    if (!state.plan)
      return (
        <div className="onb-shell">
          {banner}
          <PlanGenerationStep
            daysPerWeek={profile.training.days_per_week}
            minutes={profile.training.session_minutes}
            path={profile.path}
            onBack={() =>
              onb.goToStep(profile.path === "own_plan" ? "own_plan" : "profile")
            }
            onReload={() => void onb.reload(true)}
            busy={onb.busy}
          />
        </div>
      );

    const plan = state.plan;
    const planValidation = state.plan_validation;
    const confirmable =
      Boolean(planValidation?.valid) && progress.can_confirm_plan;

    return (
      <div className="onb-shell">
        {banner}
        <OnboardingLayout
          title="Dein Planvorschlag"
          lead={`${plan.name} · ${plan.session_count} Trainingseinheiten · ${plan.exercise_count} Übungen`}
          footer={
            <>
              <button
                type="button"
                className="primary onb-cta"
                onClick={() => setConfirming(true)}
                disabled={onb.busy || !confirmable}
                title={
                  confirmable
                    ? undefined
                    : "Der Plan ist noch nicht vollständig und kann daher nicht bestätigt werden."
                }
              >
                Plan bestätigen
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  onb.goToStep(
                    profile.path === "own_plan" ? "own_plan" : "profile",
                  )
                }
                disabled={onb.busy}
              >
                <ChevronLeft size={14} aria-hidden="true" />
                Zurück zu meinen Angaben
              </button>
              <CancelOnboardingButton
                onCancel={() => void onb.cancel()}
                busy={onb.busy}
              />
            </>
          }
        >
          {!confirmable && planValidation && !planValidation.valid && (
            <OnboardingNotice
              tone="warning"
              title="Noch nicht bestätigungsfähig"
            >
              <p>
                {planValidation.errors[0]?.message ??
                  "Der Plan ist noch nicht vollständig."}
              </p>
            </OnboardingNotice>
          )}
          <div className="onb-editor">
            {/* The Task 005 editor, unchanged. Every edit it makes raises the
                draft revision, which is what invalidates an older confirmation. */}
            <TrainingPlanEditorView
              client={client}
              onChanged={() => void onb.reload(false)}
              embedded
            />
          </div>
          <OnboardingIssues validation={validation} step="plan_review" />
        </OnboardingLayout>

        {confirming && (
          <PlanConfirmationDialog
            planName={plan.name}
            revision={plan.row_revision}
            sessionCount={plan.session_count}
            exerciseCount={plan.exercise_count}
            busy={onb.busy}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              void onb.confirmPlan();
            }}
          />
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------- profile phase */

  const content = () => {
    switch (step) {
      case "profile":
        return (
          <ProfileStep
            profile={profile}
            progress={progress}
            validation={validation}
            exerciseChoices={state.exercise_choices}
            splitOptions={state.split_options}
            busy={onb.busy}
            canWritePlan={state.can_write_plan}
            onSave={async (patch) =>
              (await onb.saveProfile(patch))?.ok ?? false
            }
            onRequestPlan={() => void onb.requestPlan()}
            onBack={() => onb.goToStep("welcome")}
          />
        );

      case "own_plan":
        return (
          <OwnPlanStep
            onBack={() => onb.goToStep("welcome")}
            onAskChat={() => void client.askChat(OWN_PLAN_MESSAGE)}
            onReload={() => void onb.reload(true)}
            busy={onb.busy}
          />
        );

      case "welcome":
      default:
        return (
          <WelcomeStep
            canWritePlan={state.can_write_plan}
            googleAvailable={state.google_connection_available}
            busy={onb.busy}
            onChoose={(path) => {
              // Choosing the path already chosen just continues there.
              if (path === profile.path)
                onb.goToStep(path === "own_plan" ? "own_plan" : "profile");
              else void onb.choosePath(path);
            }}
          />
        );
    }
  };

  return (
    <div className="onb-shell">
      {banner}
      {content()}
      <footer className="onb-statusbar">
        {/* Said rather than implied: where the setup is kept. */}
        <span className="onb-status-note">
          {state.resume.cross_device
            ? "Mit deinem Konto gespeichert."
            : state.resume.durable
              ? "Einrichtung gespeichert."
              : "Nur für diese Serversitzung gespeichert."}
        </span>
        <button
          type="button"
          className="onb-quiet"
          onClick={() => void onb.reload(true)}
          disabled={onb.busy}
        >
          <RefreshCw size={13} aria-hidden="true" />
          Aktualisieren
        </button>
        {step !== "welcome" && (
          <CancelOnboardingButton
            onCancel={() => void onb.cancel()}
            busy={onb.busy}
          />
        )}
      </footer>
    </div>
  );
}
