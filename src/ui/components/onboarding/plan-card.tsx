import { useId, useState } from "react";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import {
  WEEKDAY_LABEL,
  modulesOf,
  type OnboardingState,
  type Weekday,
} from "../../../shared/onboarding-contract";
import type {
  PlannedExercise,
  TrainingPlanVersion,
} from "../../../shared/plan-contract";
import type { ArnoldMcpClient } from "../../client/ArnoldMcpClient";
import type { CardSaveResult } from "../../hooks/useOnboardingCard";
import { compactLoad } from "../../workout-draft";
import { CardFrame } from "./card-frame";
import { modulesLine, personLine, SummaryLine } from "./card-summary";
import { PlanEditor } from "./plan-editor";
import { conventionsOf, volumeOf } from "./proposal-weights";

/**
 * Card "Plan": the proposal as one tile per training day, with exactly two
 * actions, "Plan bestätigen" and "Selbst bearbeiten" (fullscreen). Everything
 * shown comes from the server's plan; a row such as the morning routine or the
 * running sessions exists only when the plan has it. Changing the plan by
 * voice stays in the chat, so it is no button.
 */

export const PLAN_NEXT_MESSAGE =
  "Ich habe meinen Plan bestätigt. Wie geht's weiter?";

const ISO_DAY: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "Mo, Mi, Fr" from ISO weekdays (1 = Monday), in week order. */
export const weekdaysLine = (days: number[]) =>
  [...new Set(days)]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LABEL[ISO_DAY[d - 1]])
    .filter(Boolean)
    .join(", ");

export const countLabel = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The load text of one planned exercise: weight, body weight or "not yet". */
export function loadText(item: PlannedExercise) {
  const c = conventionsOf(item);
  if (c.load_basis === "bodyweight_only") return "Körpergewicht";
  return item.target_load_kg === null
    ? "beim 1. Training"
    : compactLoad(item.target_load_kg, c);
}

export function PlanCard({
  client,
  state,
  saving,
  onConfirm,
  onChanged,
  onDone,
}: {
  client: ArnoldMcpClient;
  state: OnboardingState;
  saving: boolean;
  onConfirm: () => Promise<CardSaveResult>;
  onChanged: () => Promise<unknown> | void;
  onDone: () => void;
}) {
  const { profile } = state.session;
  const { training } = profile;
  const plan = state.plan;
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<string>();
  const [failure, setFailure] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const base = useId();

  const issues = state.plan_validation?.errors ?? [];
  const done = confirmed || (!!plan && !plan.editable);
  const canConfirm =
    !!plan &&
    plan.editable &&
    !done &&
    state.progress.can_confirm_plan &&
    !!state.plan_validation?.valid &&
    issues.length === 0;

  const startEditing = () => {
    void client.displayMode("fullscreen");
    setEditing(true);
  };
  const stopEditing = () => {
    void client.displayMode("inline");
    setEditing(false);
    void onChanged();
  };

  if (editing && plan)
    return (
      <PlanEditor
        client={client}
        plan={plan}
        onChanged={onChanged}
        onClose={stopEditing}
      />
    );

  const confirm = async () => {
    if (!canConfirm || saving) return;
    setFailure("");
    const result = await onConfirm();
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setConfirmed(true);
    onDone();
  };

  const known = personLine(profile.person);
  const minutes = training.session_minutes;
  const title = plan
    ? `Dein Plan: ${countLabel(plan.sessions.length, "Tag", "Tage")}${minutes !== null ? `, je ${minutes} Min.` : ""}`
    : "Dein Plan";
  const morning = (plan?.mobility_sessions ?? []).find(
    (m) => m.kind === "morning" && m.status === "active",
  );
  const runs = (plan?.run_sessions ?? []).filter((r) => r.status === "active");
  const sessions = plan ? sortedSessions(plan) : [];

  return (
    <CardFrame tag="Plan" title={title} card="plan" busy={saving}>
      {known && <SummaryLine label="Eckdaten">{known}</SummaryLine>}
      <SummaryLine label="Module">
        {modulesLine(modulesOf(training))}
      </SummaryLine>
      {!plan ? (
        <p className="ac-text" role="status">
          Der Vorschlag ist noch nicht da. Tippe auf die Karte, dann lade ich
          ihn neu.
        </p>
      ) : (
        <>
          <ul className="oc-tiles" aria-label="Trainingstage deines Plans">
            {sessions.map((day) => {
              const isOpen = open === day.session_id;
              const panel = `${base}-${day.session_id}`;
              return (
                <li
                  key={day.session_id}
                  className={`oc-tile ${isOpen ? "open" : ""}`}
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? panel : undefined}
                    onClick={() => setOpen(isOpen ? undefined : day.session_id)}
                  >
                    <span className="oc-tile-text">
                      <strong>{day.session_name}</strong>
                      <small>
                        {countLabel(day.exercises.length, "Übung", "Übungen")}
                      </small>
                    </span>
                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      className="ac-fold-chevron"
                    />
                  </button>
                  {isOpen && (
                    <ul
                      className="oc-tile-list"
                      id={panel}
                      aria-label={`Übungen ${day.session_name}`}
                    >
                      {day.exercises.map((item) => (
                        <li key={item.plan_item_id} className="oc-exercise">
                          <span className="oc-exercise-name">
                            {item.exercise_name}
                          </span>
                          <span className="oc-exercise-values">
                            <strong>{loadText(item)}</strong>
                            <small>{volumeOf(item)}</small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {morning && (
            <SummaryLine label="Morgenroutine">
              {morning.weekdays.length > 0
                ? `${weekdaysLine(morning.weekdays)}, je ${morning.minutes} Min.`
                : `${morning.minutes} Min.`}
            </SummaryLine>
          )}
          {runs.length > 0 && (
            <SummaryLine label="Laufen">
              {runs.length}× pro Woche, zusätzlich zum Krafttraining
            </SummaryLine>
          )}
        </>
      )}
      {issues.map((issue) => (
        <p
          key={issue.code + (issue.plan_item_id ?? "")}
          className="cc-line warn"
          role="alert"
        >
          <TriangleAlert size={15} aria-hidden="true" />
          {issue.message}
        </p>
      ))}
      <p className="oc-status" role="status" aria-live="polite">
        {failure ? (
          <span className="cc-line warn">
            <TriangleAlert size={15} aria-hidden="true" />
            {failure}
          </span>
        ) : done ? (
          <span className="cc-line ok">
            <Check size={15} aria-hidden="true" />
            Plan bestätigt
          </span>
        ) : null}
      </p>
      <p className="ac-text">Oder sag mir einfach, was ich ändern soll.</p>
      <div className="ac-actions">
        <button
          type="button"
          className="ac-btn primary"
          disabled={!canConfirm || saving}
          onClick={(event) => {
            event.stopPropagation();
            void confirm();
          }}
        >
          {saving ? "Einen Moment …" : "Plan bestätigen"}
        </button>
        <button
          type="button"
          className="ac-btn secondary"
          disabled={!plan || !plan.editable || done || saving}
          onClick={(event) => {
            event.stopPropagation();
            startEditing();
          }}
        >
          Selbst bearbeiten
        </button>
      </div>
    </CardFrame>
  );
}

const sortedSessions = (plan: TrainingPlanVersion) =>
  [...plan.sessions].sort((a, b) => a.session_order - b.session_order);
