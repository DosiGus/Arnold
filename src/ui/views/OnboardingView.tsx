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
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, Info, RefreshCw } from "lucide-react";
import type {
  ExperienceLevel,
  OnboardingProfilePatch,
  OnboardingState,
  OnboardingStep,
  StartingPoint,
  TrainingEnvironment,
  TrainingGoal,
} from "../../shared/onboarding-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { useOnboarding } from "../hooks/useOnboarding";
import {
  AvailabilityStep,
  CancelOnboardingButton,
  GoalStep,
  GoogleConnectionHandoffStep,
  OnboardingErrorState,
  OnboardingIssues,
  OnboardingLayout,
  OnboardingLoading,
  OnboardingNotice,
  OnboardingResumeState,
  PlanConfirmationDialog,
  PlanGenerationStep,
  PreferencesStep,
  ProfileSummaryStep,
  WelcomeStep,
  parseList,
} from "../components/onboarding";
import { TrainingPlanEditorView } from "./TrainingPlanEditorView";

/** The optional free-text fields, held locally until a step is submitted. */
type Drafts = {
  preferred: string;
  avoided: string;
  equipment: string;
  notes: string;
};

export function OnboardingView({
  client,
  initial,
  resumed = false,
  onFinishedHandoff,
}: {
  client: ArnoldMcpClient;
  initial?: OnboardingState;
  resumed?: boolean;
  /** Called when the setup reaches the handoff, so a shell can react. */
  onFinishedHandoff?: () => void;
}) {
  const onb = useOnboarding(client, initial);
  const { state, session, step, progress, validation } = onb;
  /** Errors are shown once a step has been submitted, not while typing. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({
    preferred: "",
    avoided: "",
    equipment: "",
    notes: "",
  });

  const preferences = session?.profile.preferences;

  // The optional fields are seeded from the server once and then owned locally,
  // so typing is never fought by a background reload.
  const seeded = useMemo(
    () => ({
      preferred: (preferences?.preferred_exercises ?? []).join(", "),
      avoided: (preferences?.avoided_exercises ?? []).join(", "),
      equipment: (preferences?.available_equipment ?? []).join(", "),
      notes: preferences?.notes ?? "",
    }),
    [preferences],
  );
  const [seedKey, setSeedKey] = useState<string>();
  useEffect(() => {
    const key = session?.onboarding_session_id;
    if (!key || seedKey === key) return;
    setSeedKey(key);
    setDrafts(seeded);
  }, [seedKey, seeded, session?.onboarding_session_id]);

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
  const mark = (fields: readonly string[]) =>
    setTouched((previous) => ({
      ...previous,
      ...Object.fromEntries(fields.map((field) => [field, true])),
    }));
  const shows = (fields: readonly string[]) =>
    fields.some((field) => touched[field]);

  /** Saves a patch and moves on only once the server has stored it. */
  const saveAnd = async (
    patch: OnboardingProfilePatch,
    nextStep: OnboardingStep,
  ) => {
    const response = await onb.saveProfile(patch, nextStep);
    if (response?.ok) onb.goToStep(nextStep);
    return response;
  };

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
            daysPerWeek={profile.days_per_week}
            minutes={profile.session_minutes}
            startingPoint={profile.starting_point}
            onBack={() => onb.goToStep("summary")}
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
                onClick={() => onb.goToStep("summary")}
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
      case "welcome":
        return (
          <WelcomeStep
            resumed={resumed || progress.answered_required > 0}
            canWritePlan={state.can_write_plan}
            googleAvailable={state.google_connection_available}
            busy={onb.busy}
            onStart={() => onb.goToStep("goal")}
          />
        );

      case "availability":
        return (
          <AvailabilityStep
            days={profile.days_per_week}
            minutes={profile.session_minutes}
            environment={profile.environment}
            validation={validation}
            busy={onb.busy}
            showErrors={shows([
              "days_per_week",
              "session_minutes",
              "environment",
            ])}
            onChange={(patch) => void onb.saveProfile(patch)}
            onBack={() => onb.goToStep("goal")}
            onNext={() => {
              mark(["days_per_week", "session_minutes", "environment"]);
              if (
                profile.days_per_week !== null &&
                profile.session_minutes !== null &&
                profile.environment !== null
              )
                onb.goToStep("preferences");
            }}
          />
        );

      case "preferences":
        return (
          <PreferencesStep
            startingPoint={profile.starting_point}
            preferred={drafts.preferred}
            avoided={drafts.avoided}
            equipment={drafts.equipment}
            notes={drafts.notes}
            validation={validation}
            busy={onb.busy}
            showErrors={shows(["starting_point"])}
            onChange={(patch) => {
              if (patch.starting_point)
                void onb.saveProfile({ starting_point: patch.starting_point });
              const { starting_point: _ignored, ...rest } = patch;
              if (Object.keys(rest).length)
                setDrafts((previous) => ({ ...previous, ...rest }));
            }}
            onBack={() => onb.goToStep("availability")}
            onNext={({ skipOptional }) => {
              mark(["starting_point"]);
              if (profile.starting_point === null) return;
              if (skipOptional) {
                onb.goToStep("summary");
                return;
              }
              // Optional answers are only sent when there is something to send,
              // so skipping writes nothing and claims nothing.
              const next = {
                ...(parseList(drafts.preferred).length
                  ? { preferred_exercises: parseList(drafts.preferred) }
                  : {}),
                ...(parseList(drafts.avoided).length
                  ? { avoided_exercises: parseList(drafts.avoided) }
                  : {}),
                ...(parseList(drafts.equipment).length
                  ? { available_equipment: parseList(drafts.equipment) }
                  : {}),
                ...(drafts.notes.trim() ? { notes: drafts.notes.trim() } : {}),
              };
              if (Object.keys(next).length)
                void saveAnd({ preferences: next }, "summary");
              else onb.goToStep("summary");
            }}
          />
        );

      case "summary":
      case "plan_proposal":
      case "plan_review":
      case "confirmation":
      case "google_connection":
      case "done":
        return (
          <ProfileSummaryStep
            summary={{
              goal: profile.primary_goal,
              experience: profile.experience,
              days: profile.days_per_week,
              minutes: profile.session_minutes,
              environment: profile.environment,
              startingPoint: profile.starting_point,
              preferred: preferences?.preferred_exercises ?? [],
              avoided: preferences?.avoided_exercises ?? [],
              equipment: preferences?.available_equipment ?? [],
              notes: preferences?.notes,
            }}
            progress={progress}
            validation={validation}
            busy={onb.busy}
            canRequestPlan={progress.can_request_plan}
            canWritePlan={state.can_write_plan}
            onEdit={(target) => onb.goToStep(target)}
            onBack={() => onb.goToStep("preferences")}
            onRequestPlan={() => void onb.requestPlan()}
          />
        );

      case "goal":
      default:
        return (
          <GoalStep
            goal={profile.primary_goal}
            experience={profile.experience}
            validation={validation}
            busy={onb.busy}
            showErrors={shows(["primary_goal", "experience"])}
            onChange={(patch) =>
              void onb.saveProfile(
                patch as {
                  primary_goal?: TrainingGoal;
                  experience?: ExperienceLevel;
                },
              )
            }
            onNext={() => {
              mark(["primary_goal", "experience"]);
              if (profile.primary_goal !== null && profile.experience !== null)
                onb.goToStep("availability");
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
        {/* Said rather than implied: the setup survives on this server only. */}
        <span className="onb-status-note">
          {state.resume.durable
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

export type { StartingPoint, TrainingEnvironment };
