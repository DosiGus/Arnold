/**
 * Presentational pieces of the onboarding wizard.
 *
 * They receive finished state and raise intents; none of them knows about MCP
 * or decides an onboarding rule. Two conventions run through all of them.
 *
 * First, a choice is a large labelled card, not a `<select>`. The whole point of
 * §18 is that "Wie oft möchtest du trainieren?" should be four taps, not a form
 * field — so every required answer is a radio group rendered as option cards,
 * keyboard operable and announced as a group.
 *
 * Second, no enum value is ever shown. `muscle_gain` is a storage key; the
 * screen says "Muskelaufbau", from the label maps in the contract. That is what
 * keeps a later translation a matter of swapping those maps.
 */
import type { ReactNode } from "react";
import { useId, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  CircleAlert,
  Info,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  DAYS_PER_WEEK_MAX,
  ENVIRONMENT_HINT,
  ENVIRONMENT_LABEL,
  EXPERIENCE_HINT,
  EXPERIENCE_LABEL,
  EXPERIENCE_LEVELS,
  GOAL_HINT,
  GOAL_LABEL,
  PROFILE_STEPS,
  REQUIRED_FIELD_LABEL,
  SESSION_MINUTES_PRESETS,
  STARTING_POINTS,
  STARTING_POINT_HINT,
  STARTING_POINT_LABEL,
  STEP_LABEL,
  TRAINING_ENVIRONMENTS,
  TRAINING_GOALS,
  type ExperienceLevel,
  type OnboardingProgress,
  type OnboardingStep,
  type OnboardingValidationIssue,
  type OnboardingValidationResult,
  type StartingPoint,
  type TrainingEnvironment,
  type TrainingGoal,
} from "../../shared/onboarding-contract";

/* ------------------------------------------------------------------- layout */

export function OnboardingLayout({
  children,
  title,
  lead,
  progress,
  onBack,
  footer,
}: {
  children: ReactNode;
  title: string;
  lead?: string;
  progress?: OnboardingProgress;
  onBack?: () => void;
  footer?: ReactNode;
}) {
  return (
    // A <section>, so the step header below is an ordinary header rather than a
    // second page banner — a <header> in a plain <div> maps to role="banner".
    <section className="onb" aria-label={title}>
      {progress && <OnboardingProgressBar progress={progress} />}
      <header className="onb-head">
        {onBack && (
          <button
            type="button"
            className="onb-back"
            onClick={onBack}
            /* The accessible name must contain the visible text (WCAG 2.5.3),
               so it extends "Zurück" rather than replacing it. */
            aria-label="Zurück zum vorherigen Schritt"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Zurück
          </button>
        )}
        <h2>{title}</h2>
        {lead && <p>{lead}</p>}
      </header>
      <div className="onb-body">{children}</div>
      {footer && <div className="onb-foot">{footer}</div>}
    </section>
  );
}

/**
 * The progress indicator.
 *
 * Shows the answered count rather than a bare bar, because "3 von 6 Angaben"
 * tells the user how much is left and a coloured strip does not.
 */
export function OnboardingProgressBar({
  progress,
}: {
  progress: OnboardingProgress;
}) {
  return (
    <div className="onb-progress">
      <div
        className="onb-progress-track"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Fortschritt der Einrichtung"
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <ol className="onb-steps">
        {PROFILE_STEPS.map((step) => (
          <li
            key={step}
            className={[
              progress.completed_steps.includes(step) ? "done" : "",
              progress.current_step === step ? "current" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-current={progress.current_step === step ? "step" : undefined}
          >
            <span aria-hidden="true">
              {progress.completed_steps.includes(step) ? (
                <Check size={12} />
              ) : null}
            </span>
            {STEP_LABEL[step]}
          </li>
        ))}
      </ol>
      <p className="onb-progress-text">
        {progress.profile_complete
          ? "Alle Pflichtangaben sind erfasst."
          : `${progress.answered_required} von ${progress.total_required} Pflichtangaben erfasst.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ choices */

export type Option<T extends string | number> = {
  value: T;
  label: string;
  hint?: string;
};

/**
 * A single-choice group rendered as option cards.
 *
 * A native radio input per card keeps arrow-key navigation, screen-reader
 * grouping and form semantics; the card is just its label. `error` is rendered
 * inside the group so a validation message sits at the question that caused it
 * rather than in a banner far away.
 */
export function ChoiceGroup<T extends string | number>({
  legend,
  hint,
  options,
  value,
  onChange,
  columns,
  error,
  name,
}: {
  legend: string;
  hint?: string;
  options: readonly Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Layout hint: `compact` for short values like day counts. */
  columns?: "compact";
  error?: string;
  name?: string;
}) {
  const generated = useId();
  const group = name ?? generated;
  const errorId = `${group}-error`;
  return (
    <fieldset
      className={`onb-field ${error ? "invalid" : ""}`}
      aria-describedby={error ? errorId : undefined}
    >
      <legend>{legend}</legend>
      {hint && <p className="onb-hint">{hint}</p>}
      <div className={`onb-choices ${columns === "compact" ? "compact" : ""}`}>
        {options.map((option) => {
          const hintId = `${group}-${option.value}-hint`;
          return (
            <label
              key={String(option.value)}
              className={`onb-choice ${value === option.value ? "selected" : ""}`}
            >
              <input
                type="radio"
                name={group}
                value={String(option.value)}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                /* Named from the human label on purpose: the input's `value` is
                   a storage key, and without this a screen reader announces
                   "muscle_gain" instead of "Muskelaufbau". */
                aria-label={option.label}
                aria-describedby={option.hint ? hintId : undefined}
              />
              <span className="onb-choice-label">{option.label}</span>
              {option.hint && (
                <span className="onb-choice-hint" id={hintId}>
                  {option.hint}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {error && (
        <p className="onb-error" id={errorId} role="alert">
          <CircleAlert size={14} aria-hidden="true" />
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Comma-separated free text, for optional lists like avoided exercises. */
export function TagInput({
  label,
  hint,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="onb-field">
      <label className="onb-label" htmlFor={id}>
        {label}
      </label>
      {hint && <p className="onb-hint">{hint}</p>}
      <input
        id={id}
        type="text"
        className="onb-input"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Splits a comma-separated field into trimmed entries. Empty means absent. */
export const parseList = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/* ------------------------------------------------------------------- states */

export function OnboardingNotice({
  tone,
  title,
  children,
}: {
  tone: "info" | "warning" | "success";
  title?: string;
  children: ReactNode;
}) {
  const Icon =
    tone === "warning" ? AlertTriangle : tone === "success" ? Check : Info;
  return (
    <div
      className={`onb-notice ${tone}`}
      role={tone === "warning" ? "alert" : "status"}
    >
      <Icon size={17} aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

/** Findings for one step. Errors first; recommendations are never alarming. */
export function OnboardingIssues({
  validation,
  step,
}: {
  validation: OnboardingValidationResult;
  step?: OnboardingStep;
}) {
  const relevant = (issues: readonly OnboardingValidationIssue[]) =>
    step ? issues.filter((issue) => issue.step === step) : issues;
  const warnings = relevant(validation.warnings);
  const recommendations = relevant(validation.recommendations);
  if (!warnings.length && !recommendations.length) return null;
  return (
    <div className="onb-issues">
      {warnings.map((issue, index) => (
        <p className="onb-issue warning" key={`w${index}`} role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          {issue.message}
        </p>
      ))}
      {recommendations.map((issue, index) => (
        <p className="onb-issue hint" key={`r${index}`}>
          <Info size={14} aria-hidden="true" />
          {issue.message}
        </p>
      ))}
    </div>
  );
}

export function OnboardingErrorState({
  message,
  onRetry,
  onRestart,
}: {
  message: string;
  onRetry?: () => void;
  onRestart?: () => void;
}) {
  return (
    <div className="onb-error-state" role="alert">
      <AlertTriangle size={24} aria-hidden="true" />
      <strong>Das hat nicht funktioniert</strong>
      <p>{message}</p>
      <div className="onb-actions">
        {onRetry && (
          <button type="button" className="secondary" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            Erneut versuchen
          </button>
        )}
        {onRestart && (
          <button type="button" className="primary" onClick={onRestart}>
            Einrichtung neu starten
          </button>
        )}
      </div>
    </div>
  );
}

/** Expired or cancelled: a controlled restart, never a silent reset. */
export function OnboardingResumeState({
  kind,
  onRestart,
  busy,
}: {
  kind: "expired" | "cancelled";
  onRestart: () => void;
  busy: boolean;
}) {
  return (
    <div className="onb-resume" role="status">
      <AlertTriangle size={24} aria-hidden="true" />
      <strong>
        {kind === "expired"
          ? "Diese Einrichtung ist abgelaufen"
          : "Diese Einrichtung wurde abgebrochen"}
      </strong>
      <p>
        {kind === "expired"
          ? "Aus Sicherheitsgründen läuft eine Einrichtung nach einiger Zeit ab. Deine bisherigen Angaben sind nicht mehr abrufbar – die Einrichtung dauert nur wenige Minuten."
          : "Du kannst jederzeit neu beginnen. Ein bereits erstellter Planentwurf bleibt erhalten und wurde nicht gelöscht."}
      </p>
      <button
        type="button"
        className="primary"
        onClick={onRestart}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle size={15} className="spin" aria-hidden="true" />
        ) : (
          <Sparkles size={15} aria-hidden="true" />
        )}
        Neue Einrichtung starten
      </button>
    </div>
  );
}

export function OnboardingLoading({ text = "Einrichtung wird geladen …" }) {
  return (
    <div className="onb-loading" role="status" aria-live="polite">
      <LoaderCircle className="spin" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

/* -------------------------------------------------------------------- steps */

export function WelcomeStep({
  onStart,
  busy,
  resumed,
  canWritePlan,
}: {
  onStart: () => void;
  busy: boolean;
  resumed: boolean;
  canWritePlan: boolean;
}) {
  return (
    <OnboardingLayout
      title="Willkommen bei Arnold"
      lead="Dein KI-gestützter Trainingsbegleiter. In wenigen Minuten hast du einen Trainingsplan, der zu dir passt."
    >
      <ol className="onb-intro">
        <li>
          <strong>Deine Angaben</strong>
          <span>
            Ziel, Erfahrung und wie viel Zeit du fürs Training hast. Sechs kurze
            Fragen.
          </span>
        </li>
        <li>
          <strong>Dein Planvorschlag</strong>
          <span>
            Arnold erstellt daraus im Chat einen Trainingsplan – oder übernimmt
            deinen bestehenden.
          </span>
        </li>
        <li>
          <strong>Deine Entscheidung</strong>
          <span>
            Du bearbeitest den Plan, bis er passt, und bestätigst ihn
            anschließend selbst.
          </span>
        </li>
      </ol>
      {/* Said up front rather than discovered at the end: the Google step is
          genuinely not available yet, and the welcome screen must not imply it. */}
      <OnboardingNotice tone="info" title="Was Arnold jetzt noch nicht tut">
        <p>
          Das Verbinden deines Google-Kontos und das Anlegen deiner persönlichen
          Trainingsdatei folgen im nächsten Entwicklungsschritt. Bis dahin wird
          kein Google-Konto verbunden und keine Datei erstellt.
        </p>
      </OnboardingNotice>
      {!canWritePlan && (
        <OnboardingNotice tone="warning" title="Eingeschränkte Umgebung">
          <p>
            In dieser Umgebung kann kein Planentwurf gespeichert werden. Du
            kannst deine Angaben erfassen; der Planvorschlag ist deaktiviert.
          </p>
        </OnboardingNotice>
      )}
      <div className="onb-actions">
        <button
          type="button"
          className="primary onb-cta"
          onClick={onStart}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          {resumed ? "Einrichtung fortsetzen" : "Einrichtung starten"}
        </button>
      </div>
    </OnboardingLayout>
  );
}

const GOAL_OPTIONS: readonly Option<TrainingGoal>[] = TRAINING_GOALS.map(
  (goal) => ({ value: goal, label: GOAL_LABEL[goal], hint: GOAL_HINT[goal] }),
);
const EXPERIENCE_OPTIONS: readonly Option<ExperienceLevel>[] =
  EXPERIENCE_LEVELS.map((level) => ({
    value: level,
    label: EXPERIENCE_LABEL[level],
    hint: EXPERIENCE_HINT[level],
  }));
const ENVIRONMENT_OPTIONS: readonly Option<TrainingEnvironment>[] =
  TRAINING_ENVIRONMENTS.map((environment) => ({
    value: environment,
    label: ENVIRONMENT_LABEL[environment],
    hint: ENVIRONMENT_HINT[environment],
  }));
const STARTING_POINT_OPTIONS: readonly Option<StartingPoint>[] =
  STARTING_POINTS.map((point) => ({
    value: point,
    label: STARTING_POINT_LABEL[point],
    hint: STARTING_POINT_HINT[point],
  }));
const DAY_OPTIONS: readonly Option<number>[] = Array.from(
  { length: DAYS_PER_WEEK_MAX },
  (_, index) => ({
    value: index + 1,
    label: `${index + 1}`,
    hint: index === 0 ? "Tag" : "Tage",
  }),
);
const MINUTE_OPTIONS: readonly Option<number>[] = SESSION_MINUTES_PRESETS.map(
  (minutes) => ({ value: minutes, label: `${minutes}`, hint: "Minuten" }),
);

/** Goal and experience: the two answers that shape everything else. */
export function GoalStep({
  goal,
  experience,
  onChange,
  validation,
  onNext,
  busy,
  showErrors,
}: {
  goal: TrainingGoal | null;
  experience: ExperienceLevel | null;
  onChange: (patch: {
    primary_goal?: TrainingGoal;
    experience?: ExperienceLevel;
  }) => void;
  validation: OnboardingValidationResult;
  onNext: () => void;
  busy: boolean;
  showErrors: boolean;
}) {
  const errorFor = (field: string) =>
    showErrors
      ? validation.errors.find((issue) => issue.field === field)?.message
      : undefined;
  return (
    <OnboardingLayout
      title="Was möchtest du erreichen?"
      lead="Dein Ziel und deine Erfahrung bestimmen, wie dein Plan aufgebaut wird."
      footer={
        <button
          type="button"
          className="primary"
          onClick={onNext}
          disabled={busy}
        >
          Weiter
        </button>
      }
    >
      <ChoiceGroup
        legend="Dein wichtigstes Trainingsziel"
        options={GOAL_OPTIONS}
        value={goal}
        onChange={(value) => onChange({ primary_goal: value })}
        error={errorFor("primary_goal")}
        name="primary_goal"
      />
      <ChoiceGroup
        legend="Wie viel Krafttraining hast du schon gemacht?"
        options={EXPERIENCE_OPTIONS}
        value={experience}
        onChange={(value) => onChange({ experience: value })}
        error={errorFor("experience")}
        name="experience"
      />
      <OnboardingIssues validation={validation} step="goal" />
    </OnboardingLayout>
  );
}

/** Days, minutes and environment: the three facts a plan must fit into. */
export function AvailabilityStep({
  days,
  minutes,
  environment,
  onChange,
  validation,
  onNext,
  onBack,
  busy,
  showErrors,
}: {
  days: number | null;
  minutes: number | null;
  environment: TrainingEnvironment | null;
  onChange: (patch: {
    days_per_week?: number;
    session_minutes?: number;
    environment?: TrainingEnvironment;
  }) => void;
  validation: OnboardingValidationResult;
  onNext: () => void;
  onBack: () => void;
  busy: boolean;
  showErrors: boolean;
}) {
  const errorFor = (field: string) =>
    showErrors
      ? validation.errors.find((issue) => issue.field === field)?.message
      : undefined;
  return (
    <OnboardingLayout
      title="Wie sieht dein Trainingsalltag aus?"
      lead="Ein Plan hilft nur, wenn er in deine Woche passt."
      onBack={onBack}
      footer={
        <button
          type="button"
          className="primary"
          onClick={onNext}
          disabled={busy}
        >
          Weiter
        </button>
      }
    >
      <ChoiceGroup
        legend="Wie oft möchtest du pro Woche trainieren?"
        options={DAY_OPTIONS}
        value={days}
        onChange={(value) => onChange({ days_per_week: value })}
        columns="compact"
        error={errorFor("days_per_week")}
        name="days_per_week"
      />
      <ChoiceGroup
        legend="Wie viel Zeit hast du je Training?"
        options={MINUTE_OPTIONS}
        value={minutes}
        onChange={(value) => onChange({ session_minutes: value })}
        columns="compact"
        error={errorFor("session_minutes")}
        name="session_minutes"
      />
      <ChoiceGroup
        legend="Wo trainierst du?"
        options={ENVIRONMENT_OPTIONS}
        value={environment}
        onChange={(value) => onChange({ environment: value })}
        error={errorFor("environment")}
        name="environment"
      />
      <OnboardingIssues validation={validation} step="availability" />
    </OnboardingLayout>
  );
}

/**
 * The optional step.
 *
 * Everything here may be skipped, and the skip is a real button rather than a
 * greyed-out hint — §18 asks for optional questions to be genuinely optional.
 */
export function PreferencesStep({
  startingPoint,
  preferred,
  avoided,
  equipment,
  notes,
  onChange,
  validation,
  onNext,
  onBack,
  busy,
  showErrors,
}: {
  startingPoint: StartingPoint | null;
  preferred: string;
  avoided: string;
  equipment: string;
  notes: string;
  onChange: (patch: {
    starting_point?: StartingPoint;
    preferred?: string;
    avoided?: string;
    equipment?: string;
    notes?: string;
  }) => void;
  validation: OnboardingValidationResult;
  onNext: (options: { skipOptional: boolean }) => void;
  onBack: () => void;
  busy: boolean;
  showErrors: boolean;
}) {
  const notesId = useId();
  const error = showErrors
    ? validation.errors.find((issue) => issue.field === "starting_point")
        ?.message
    : undefined;
  return (
    <OnboardingLayout
      title="Hast du eigene Vorlieben?"
      lead="Nur die erste Frage ist nötig. Alles andere kannst du überspringen und später ergänzen."
      onBack={onBack}
      footer={
        <>
          <button
            type="button"
            className="primary"
            onClick={() => onNext({ skipOptional: false })}
            disabled={busy}
          >
            Weiter
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => onNext({ skipOptional: true })}
            disabled={busy}
          >
            Optionale Angaben überspringen
          </button>
        </>
      }
    >
      <ChoiceGroup
        legend="Wie möchtest du starten?"
        options={STARTING_POINT_OPTIONS}
        value={startingPoint}
        onChange={(value) => onChange({ starting_point: value })}
        error={error}
        name="starting_point"
      />
      {startingPoint === "existing_plan" && (
        <OnboardingNotice tone="info" title="Deinen Plan übernehmen">
          <p>
            Beschreibe deinen bestehenden Plan einfach im Chat – zum Beispiel
            „Ich trainiere Push/Pull/Legs mit Bankdrücken, Klimmzügen und
            Kniebeugen". Arnold strukturiert das und zeigt es dir hier als
            bearbeitbaren Entwurf. Fehlende Sätze oder Wiederholungen kannst du
            danach ergänzen.
          </p>
        </OnboardingNotice>
      )}
      <TagInput
        label="Übungen, die du gern machst"
        hint="Mit Komma trennen. Optional."
        placeholder="z. B. Bankdrücken, Klimmzüge"
        value={preferred}
        onChange={(value) => onChange({ preferred: value })}
      />
      <TagInput
        label="Übungen, die du vermeiden möchtest"
        hint="Mit Komma trennen. Optional."
        placeholder="z. B. Kniebeugen"
        value={avoided}
        onChange={(value) => onChange({ avoided: value })}
      />
      <TagInput
        label="Geräte, die dir zur Verfügung stehen"
        hint="Besonders hilfreich beim Training zuhause. Optional."
        placeholder="z. B. Kurzhanteln, Klimmzugstange"
        value={equipment}
        onChange={(value) => onChange({ equipment: value })}
      />
      <div className="onb-field">
        <label className="onb-label" htmlFor={notesId}>
          Sonst noch etwas?
        </label>
        <p className="onb-hint">
          Freitext, optional. Bitte keine Gesundheits- oder Krankheitsangaben –
          Arnold gibt keine medizinischen Einschätzungen ab.
        </p>
        <textarea
          id={notesId}
          className="onb-textarea"
          rows={3}
          maxLength={600}
          placeholder="z. B. Ich trainiere am liebsten morgens."
          value={notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </div>
      <OnboardingIssues validation={validation} step="preferences" />
    </OnboardingLayout>
  );
}

/** Everything the user said, each line editable at its own step. */
export function ProfileSummaryStep({
  summary,
  progress,
  validation,
  onEdit,
  onRequestPlan,
  busy,
  canRequestPlan,
  canWritePlan,
  onBack,
}: {
  summary: {
    goal: TrainingGoal | null;
    experience: ExperienceLevel | null;
    days: number | null;
    minutes: number | null;
    environment: TrainingEnvironment | null;
    startingPoint: StartingPoint | null;
    preferred: readonly string[];
    avoided: readonly string[];
    equipment: readonly string[];
    notes?: string;
  };
  progress: OnboardingProgress;
  validation: OnboardingValidationResult;
  onEdit: (step: OnboardingStep) => void;
  onRequestPlan: () => void;
  busy: boolean;
  canRequestPlan: boolean;
  canWritePlan: boolean;
  onBack: () => void;
}) {
  const rows: {
    label: string;
    value: string;
    step: OnboardingStep;
    missing?: boolean;
  }[] = [
    {
      label: REQUIRED_FIELD_LABEL.primary_goal,
      value: summary.goal ? GOAL_LABEL[summary.goal] : "Noch offen",
      step: "goal",
      missing: !summary.goal,
    },
    {
      label: REQUIRED_FIELD_LABEL.experience,
      value: summary.experience
        ? EXPERIENCE_LABEL[summary.experience]
        : "Noch offen",
      step: "goal",
      missing: !summary.experience,
    },
    {
      label: REQUIRED_FIELD_LABEL.days_per_week,
      value:
        summary.days === null
          ? "Noch offen"
          : `${summary.days} ${summary.days === 1 ? "Tag" : "Tage"} pro Woche`,
      step: "availability",
      missing: summary.days === null,
    },
    {
      label: REQUIRED_FIELD_LABEL.session_minutes,
      value:
        summary.minutes === null
          ? "Noch offen"
          : `${summary.minutes} Minuten je Training`,
      step: "availability",
      missing: summary.minutes === null,
    },
    {
      label: REQUIRED_FIELD_LABEL.environment,
      value: summary.environment
        ? ENVIRONMENT_LABEL[summary.environment]
        : "Noch offen",
      step: "availability",
      missing: !summary.environment,
    },
    {
      label: REQUIRED_FIELD_LABEL.starting_point,
      value: summary.startingPoint
        ? STARTING_POINT_LABEL[summary.startingPoint]
        : "Noch offen",
      step: "preferences",
      missing: !summary.startingPoint,
    },
  ];
  const optional: { label: string; value: string }[] = [];
  if (summary.preferred.length)
    optional.push({
      label: "Bevorzugte Übungen",
      value: summary.preferred.join(", "),
    });
  if (summary.avoided.length)
    optional.push({
      label: "Zu vermeidende Übungen",
      value: summary.avoided.join(", "),
    });
  if (summary.equipment.length)
    optional.push({
      label: "Verfügbare Geräte",
      value: summary.equipment.join(", "),
    });
  if (summary.notes) optional.push({ label: "Notiz", value: summary.notes });

  return (
    <OnboardingLayout
      title="Passt das so?"
      lead="Prüfe deine Angaben. Du kannst jede Zeile ändern."
      progress={progress}
      onBack={onBack}
      footer={
        <button
          type="button"
          className="primary onb-cta"
          onClick={onRequestPlan}
          disabled={busy || !canRequestPlan || !canWritePlan}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          Trainingsplan vorschlagen lassen
        </button>
      }
    >
      <dl className="onb-summary">
        {rows.map((row) => (
          <div key={row.label} className={row.missing ? "missing" : ""}>
            <dt>{row.label}</dt>
            <dd>
              <span>{row.value}</span>
              <button
                type="button"
                className="onb-edit"
                onClick={() => onEdit(row.step)}
                aria-label={`${row.label} ändern`}
              >
                <Pencil size={13} aria-hidden="true" />
                Ändern
              </button>
            </dd>
          </div>
        ))}
        {optional.map((row) => (
          <div key={row.label} className="optional">
            <dt>{row.label}</dt>
            <dd>
              <span>{row.value}</span>
              <button
                type="button"
                className="onb-edit"
                onClick={() => onEdit("preferences")}
                aria-label={`${row.label} ändern`}
              >
                <Pencil size={13} aria-hidden="true" />
                Ändern
              </button>
            </dd>
          </div>
        ))}
      </dl>
      {!progress.profile_complete && (
        <OnboardingNotice tone="warning" title="Es fehlen noch Angaben">
          <p>
            Für einen Planvorschlag fehlen:{" "}
            {progress.missing_fields
              .map(
                (field) =>
                  REQUIRED_FIELD_LABEL[
                    field as keyof typeof REQUIRED_FIELD_LABEL
                  ] ?? field,
              )
              .join(", ")}
            .
          </p>
        </OnboardingNotice>
      )}
      <OnboardingIssues validation={validation} />
    </OnboardingLayout>
  );
}

/* --------------------------------------------------------- plan generation */

/**
 * The step that hands over to the chat.
 *
 * This is the honest-handoff screen from §12. The MCP app cannot make the host
 * model generate a plan, so there is deliberately no button that pretends to:
 * the screen explains what to say in the chat, and the wizard waits for the
 * proposal to arrive through the server. A fake "Generate" button here would be
 * the single most misleading thing this feature could contain.
 */
export function PlanGenerationStep({
  daysPerWeek,
  minutes,
  startingPoint,
  onBack,
  onReload,
  busy,
}: {
  daysPerWeek: number | null;
  minutes: number | null;
  startingPoint: StartingPoint | null;
  onBack: () => void;
  onReload: () => void;
  busy: boolean;
}) {
  const existing = startingPoint === "existing_plan";
  return (
    <OnboardingLayout
      title="Jetzt entsteht dein Plan"
      lead="Arnold erstellt deinen Trainingsplan im Chat – mit allen Angaben, die du gerade gemacht hast."
      onBack={onBack}
    >
      <OnboardingNotice tone="info" title="So geht es weiter">
        <p>
          Wechsle in den Chat und schreibe Arnold, dass dein Plan erstellt
          werden soll. Zum Beispiel:
        </p>
        <p className="onb-quote">
          {existing
            ? "„Übernimm meinen bestehenden Trainingsplan."
            : `„Erstelle mir jetzt den Trainingsplan für ${daysPerWeek ?? 3} Tage pro Woche.`}
        </p>
        <p>
          Sobald der Vorschlag fertig ist, erscheint er hier als bearbeitbarer
          Entwurf.
        </p>
      </OnboardingNotice>
      <ul className="onb-facts">
        <li>
          <strong>{daysPerWeek ?? "—"}</strong>
          <span>Trainingstage pro Woche</span>
        </li>
        <li>
          <strong>{minutes ?? "—"}</strong>
          <span>Minuten je Einheit</span>
        </li>
        <li>
          <strong>{existing ? "Übernahme" : "Neuer Plan"}</strong>
          <span>Ausgangssituation</span>
        </li>
      </ul>
      <p className="onb-note">
        Arnold erfindet keine Trainingsgewichte. Was du nicht genannt hast,
        bleibt leer und kann später ergänzt werden.
      </p>
      <div className="onb-actions">
        <button
          type="button"
          className="secondary"
          onClick={onReload}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
          ) : (
            <RefreshCw size={14} aria-hidden="true" />
          )}
          Nach dem Vorschlag suchen
        </button>
      </div>
    </OnboardingLayout>
  );
}

/* -------------------------------------------------------- confirmation view */

/**
 * The release dialog.
 *
 * Names the exact revision being released and says what the confirmation does
 * and does not mean. The wording is not decoration: a user must not read this as
 * "my plan is now live in a Google file".
 */
export function PlanConfirmationDialog({
  planName,
  revision,
  sessionCount,
  exerciseCount,
  onConfirm,
  onCancel,
  busy,
}: {
  planName: string;
  revision: number;
  sessionCount: number;
  exerciseCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const titleId = useId();
  return (
    <div className="onb-dialog-backdrop" role="presentation">
      <div
        className="onb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId}>Trainingsplan bestätigen</h3>
        <p>
          Du bestätigst <strong>{planName}</strong> mit {sessionCount}{" "}
          Trainingseinheiten und {exerciseCount} Übungen in der aktuell
          geprüften Fassung (Revision {revision}).
        </p>
        <OnboardingNotice tone="info" title="Was das bedeutet">
          <p>
            Du gibst diesen Plan für die Einrichtung frei. Der Plan ist damit{" "}
            <strong>noch nicht</strong> in einer persönlichen Google-Datei
            aktiviert – dafür wird im nächsten Schritt dein Google-Konto
            verbunden. Änderst du den Plan später, musst du ihn erneut
            bestätigen.
          </p>
        </OnboardingNotice>
        <div className="onb-actions">
          <button
            type="button"
            className="primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" aria-hidden="true" />
            ) : (
              <Check size={15} aria-hidden="true" />
            )}
            Plan bestätigen
          </button>
          <button
            type="button"
            className="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The OAuth handoff.
 *
 * The Google button is disabled and labelled as the next development step. §18
 * forbids a control that fakes an unavailable function, and this is the one
 * place where faking it would be most tempting.
 */
export function GoogleConnectionHandoffStep({
  planName,
  revision,
  sessionCount,
  exerciseCount,
  onRevise,
  busy,
}: {
  planName: string;
  revision: number;
  sessionCount: number;
  exerciseCount: number;
  onRevise: () => void;
  busy: boolean;
}) {
  return (
    <OnboardingLayout
      title="Dein Trainingsplan ist bereit."
      lead={`${planName} · ${sessionCount} Trainingseinheiten · ${exerciseCount} Übungen · bestätigte Revision ${revision}`}
    >
      <div className="onb-ready" role="status">
        <span className="onb-ready-icon" aria-hidden="true">
          <Check size={22} />
        </span>
        <div>
          <strong>Von dir bestätigt und freigegeben</strong>
          <p>
            Im nächsten Schritt verbinden wir dein Google-Konto, damit Arnold
            deine persönliche Trainingsdatei erstellen und deine Fortschritte
            speichern kann.
          </p>
        </div>
      </div>
      <OnboardingNotice tone="info" title="Noch nicht verfügbar">
        <p>
          Die Google-Verbindung ist noch nicht implementiert. Es wurde kein
          Google-Konto verbunden, keine Datei angelegt und kein Plan in einer
          Trainingsdatei aktiviert. Dein bestätigter Plan ist gespeichert und
          wird für diesen Schritt übernommen.
        </p>
      </OnboardingNotice>
      <div className="onb-actions">
        <button
          type="button"
          className="primary"
          disabled
          aria-disabled="true"
          title="Diese Funktion folgt im nächsten Entwicklungsschritt."
        >
          Google-Konto verbinden
        </button>
        <span className="onb-badge">Nächster Entwicklungsschritt</span>
      </div>
      <div className="onb-actions">
        <button
          type="button"
          className="secondary"
          onClick={onRevise}
          disabled={busy}
        >
          <Pencil size={14} aria-hidden="true" />
          Plan doch noch ändern
        </button>
      </div>
      <p className="onb-note">
        Wenn du den Plan jetzt noch änderst, wird deine Bestätigung ungültig und
        du bestätigst die neue Fassung erneut.
      </p>
    </OnboardingLayout>
  );
}

/** A small controlled confirmation for leaving the setup. */
export function CancelOnboardingButton({
  onCancel,
  busy,
}: {
  onCancel: () => void;
  busy: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        className="onb-quiet"
        onClick={() => setAsking(true)}
        disabled={busy}
      >
        Einrichtung abbrechen
      </button>
    );
  return (
    <span className="onb-confirm-inline" role="group">
      <span>Einrichtung wirklich abbrechen?</span>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setAsking(false);
          onCancel();
        }}
        disabled={busy}
      >
        Ja, abbrechen
      </button>
      <button
        type="button"
        className="onb-quiet"
        onClick={() => setAsking(false)}
        disabled={busy}
      >
        Weiter einrichten
      </button>
    </span>
  );
}
