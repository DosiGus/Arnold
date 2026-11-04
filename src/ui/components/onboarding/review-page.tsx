import type { ReactNode } from "react";
import {
  Clock,
  MapPin,
  Pencil,
  Sparkles,
  Target,
  TrendingUp,
  User,
} from "lucide-react";
import type {
  OnboardingProfile,
  OnboardingProgress,
} from "../../../shared/onboarding-contract";
import {
  BODY_AREA_LABEL,
  ENVIRONMENT_LABEL,
  EXPERIENCE_LABEL,
  GOAL_LABEL,
  MUSCLE_GROUP_LABEL,
  SPLIT_LABEL,
  WEEKDAY_LABEL,
} from "../../../shared/onboarding-contract";
import { CardActions, CardNote } from "../cards";
import { formatNumber } from "../../format";
import { ICON, TITLE, type Page } from "./pages";

/**
 * The review in plain words: one sentence for the whole plan, then one row
 * per answer with a way back to change it.
 */
export function renderReviewPage({
  head,
  busy,
  person,
  training,
  exerciseChoices,
  progress,
  canWritePlan,
  onRequestPlan,
  onEdit,
}: {
  head: ReactNode;
  busy: boolean;
  person: OnboardingProfile["person"];
  training: OnboardingProfile["training"];
  exerciseChoices: readonly { exercise_id: string; name_de: string }[];
  progress: OnboardingProgress;
  canWritePlan: boolean;
  onRequestPlan: () => void;
  /** Opens a page as an edit that returns to the review. */
  onEdit: (page: Page) => void;
}) {
  const allGoals = training.primary_goal
    ? [training.primary_goal, ...(training.secondary_goals ?? [])]
    : [];
  const goalText = allGoals.length
    ? allGoals.map((g) => GOAL_LABEL[g]).join(" + ")
    : "Noch offen";
  const daysValue = training.days_per_week;
  const minutesValue = training.session_minutes;
  const wishCount = [
    (training.training_days?.length ?? 0) > 0,
    !!training.split && training.split !== "auto",
    (training.focus_muscle_groups?.length ?? 0) > 0,
    (training.equipment?.length ?? 0) > 0,
    (training.preferred_exercise_ids?.length ?? 0) > 0,
    (training.avoided_exercise_ids?.length ?? 0) > 0,
    !!training.notes,
  ].filter(Boolean).length;
  const exerciseName = (id: string) =>
    exerciseChoices.find((e) => e.exercise_id === id)?.name_de ?? id;
  const sentence = [
    `Arnold plant ${daysValue ?? "–"} ${daysValue === 1 ? "Training" : "Trainings"} pro Woche à ${minutesValue ?? "–"} Minuten für „${goalText}“`,
    training.focus_muscle_groups?.length
      ? `, mit Schwerpunkt ${training.focus_muscle_groups.map((m) => MUSCLE_GROUP_LABEL[m]).join(" und ")}`
      : "",
    training.avoided_exercise_ids?.length
      ? `, ohne ${training.avoided_exercise_ids.map(exerciseName).join(" und ")}`
      : "",
    person.protect_areas?.length
      ? ` und nimmt Rücksicht auf ${person.protect_areas.map((a) => BODY_AREA_LABEL[a]).join(" und ")}`
      : "",
    ".",
  ].join("");
  const personParts = [
    person.age_years !== undefined ? `${person.age_years} Jahre` : null,
    person.height_cm !== undefined ? `${person.height_cm} cm` : null,
    person.body_weight_kg !== undefined
      ? `${formatNumber(person.body_weight_kg, 1)} kg`
      : null,
  ].filter(Boolean);
  const rows: {
    key: string;
    icon: ReactNode;
    label: string;
    value: string;
    edit: Page;
  }[] = [
    {
      key: "goal",
      icon: <Target size={ICON} />,
      label: "Ziel",
      value: goalText,
      edit: "goal",
    },
    {
      key: "experience",
      icon: <TrendingUp size={ICON} />,
      label: "Erfahrung",
      value: training.experience
        ? EXPERIENCE_LABEL[training.experience]
        : "Noch offen",
      edit: "experience",
    },
    {
      key: "rhythm",
      icon: <Clock size={ICON} />,
      label: "Wie oft und wie lange",
      value:
        daysValue && minutesValue
          ? `${daysValue} ${daysValue === 1 ? "Trainingstag" : "Trainingstage"} pro Woche · je ${minutesValue} Minuten`
          : "Noch offen",
      edit: "rhythm",
    },
    {
      key: "place",
      icon: <MapPin size={ICON} />,
      label: "Trainingsort",
      value: training.environment
        ? ENVIRONMENT_LABEL[training.environment]
        : "Noch offen",
      edit: "environment",
    },
    {
      key: "wishes",
      icon: <Sparkles size={ICON} />,
      label: "Wünsche",
      value: wishCount
        ? `${wishCount} gesetzt${training.training_days?.length ? ` · ${training.training_days.map((d) => WEEKDAY_LABEL[d].slice(0, 2)).join(", ")}` : ""}${training.notes ? ` · „${training.notes}“` : ""}`
        : "Keine, Arnold entscheidet",
      edit: "wishes",
    },
    ...(personParts.length
      ? [
          {
            key: "person",
            icon: <User size={ICON} />,
            label: "Über dich",
            value: personParts.join(" · "),
            edit: "person" as Page,
          },
        ]
      : []),
  ];
  return (
    <section
      className="ac"
      aria-label={TITLE.review}
      aria-busy={busy || undefined}
    >
      {head}
      <div>
        <h2 className="ac-title">{TITLE.review}</h2>
        <p className="ac-sub">Prüf kurz, dann legt Arnold los.</p>
      </div>
      <div className="ac-plan-hero">
        <span className="ac-plan-pills">
          {daysValue && <span className="ac-pill">{daysValue}× pro Woche</span>}
          {minutesValue && <span className="ac-pill">{minutesValue} Min.</span>}
          {training.environment && (
            <span className="ac-pill muted">
              {ENVIRONMENT_LABEL[training.environment]}
            </span>
          )}
          {training.split && training.split !== "auto" && (
            <span className="ac-pill muted">{SPLIT_LABEL[training.split]}</span>
          )}
        </span>
        <p>{sentence}</p>
      </div>
      <ul className="ac-review-rows">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="ac-review-icon" aria-hidden="true">
              {r.icon}
            </span>
            <span className="ac-review-text">
              <small>{r.label}</small>
              <strong>{r.value}</strong>
            </span>
            <button
              type="button"
              className="ac-icon-btn"
              aria-label={`${r.label} ändern`}
              disabled={busy}
              onClick={() => onEdit(r.edit)}
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {!progress.can_request_plan && (
        <CardNote>Es fehlen noch Angaben für deinen Plan.</CardNote>
      )}
      <CardActions
        primary={{
          label: (
            <>
              <Sparkles size={18} aria-hidden="true" /> Plan erstellen
            </>
          ),
          ariaLabel: "Plan erstellen",
          disabled: busy || !canWritePlan || !progress.can_request_plan,
          onClick: onRequestPlan,
        }}
      />
    </section>
  );
}
