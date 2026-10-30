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
import strengthSculpture from "../assets/strength-sculpture.webp?inline";
import { useId, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Info,
  LoaderCircle,
  Orbit,
  Pencil,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  BODY_AREAS,
  BODY_AREA_LABEL,
  DAYS_PER_WEEK_MAX,
  ENVIRONMENT_HINT,
  ENVIRONMENT_LABEL,
  EQUIPMENT,
  EQUIPMENT_LABEL,
  EXPERIENCE_HINT,
  EXPERIENCE_LABEL,
  EXPERIENCE_LEVELS,
  GOAL_HINT,
  GOAL_LABEL,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABEL,
  ONBOARDING_PATHS,
  PERSON_BASICS,
  PATH_HINT,
  PATH_LABEL,
  PROFILE_STEPS,
  REQUIRED_FIELD_LABEL,
  SESSION_MINUTES_PRESETS,
  SEXES,
  SEX_LABEL,
  SPLITS,
  SPLIT_HINT,
  SPLIT_LABEL,
  STEP_LABEL,
  TRAINING_ENVIRONMENTS,
  TRAINING_GOALS,
  TRAINING_REQUIRED_FIELDS,
  WEEKDAYS,
  WEEKDAY_LABEL,
  type ExerciseChoice,
  type ExperienceLevel,
  type OnboardingPath,
  type OnboardingProfile,
  type OnboardingProgress,
  type OnboardingStep,
  type OnboardingValidationIssue,
  type OnboardingValidationResult,
  type PersonPatch,
  type Sex,
  type Split,
  type TrainingEnvironment,
  type TrainingGoal,
  type TrainingPatch,
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
      <div className="onb-brand">
        <Orbit size={24} strokeWidth={1.25} aria-hidden="true" />
        <span>arnold</span>
        <span className="source-badge">Einrichtung</span>
      </div>
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
      <ol className="onb-steps visually-hidden">
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
          ? "Angaben vollständig."
          : `${progress.answered_required} / ${progress.total_required} Angaben`}
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
                aria-describedby={
                  columns === "compact" && option.hint ? hintId : undefined
                }
              />
              <span className="onb-choice-label">{option.label}</span>
              {columns === "compact" && option.hint && (
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

/**
 * Welcome: who Arnold is, and the two ways in.
 *
 * Two equal buttons side by side, no form. Everything after this screen
 * depends on the choice, so it is the only question asked here.
 */
export function WelcomeStep({
  onChoose,
  busy,
  canWritePlan,
  googleAvailable = false,
}: {
  onChoose: (path: OnboardingPath) => void;
  busy: boolean;
  canWritePlan: boolean;
  googleAvailable?: boolean;
}) {
  return (
    <OnboardingLayout
      title="Willkommen bei Arnold"
      lead="Dein persönlicher Trainingsbegleiter, direkt hier im Chat."
    >
      <div className="onb-welcome-visual" aria-hidden="true">
        <span>Dein Moment.</span>
        <img src={strengthSculpture} alt="" draggable={false} />
      </div>
      <p className="onb-welcome-text">
        Arnold baut dir einen Trainingsplan, der zu deinem Alltag passt,
        schreibt beim Training deine Sätze und Gewichte mit und zeigt dir, wo du
        stärker wirst. Deine Daten liegen in deinem eigenen Google Drive.
      </p>
      {!googleAvailable && (
        <p className="onb-note">
          Google-Verbindung nicht verfügbar. Es wird keine Datei erstellt.
        </p>
      )}
      {!canWritePlan && (
        <OnboardingNotice tone="warning" title="Eingeschränkte Umgebung">
          <p>
            In dieser Umgebung kann kein Planentwurf gespeichert werden. Du
            kannst deine Angaben erfassen; der Planvorschlag ist deaktiviert.
          </p>
        </OnboardingNotice>
      )}
      <div
        className="onb-paths"
        role="group"
        aria-label="Wie möchtest du starten?"
      >
        {ONBOARDING_PATHS.map((path) => (
          <button
            key={path}
            type="button"
            className={`onb-path ${path === "arnold_plan" ? "primary" : "secondary"}`}
            onClick={() => onChoose(path)}
            disabled={busy}
          >
            {path === "arnold_plan" ? (
              <Sparkles size={18} aria-hidden="true" />
            ) : (
              <Upload size={18} aria-hidden="true" />
            )}
            <strong>{PATH_LABEL[path]}</strong>
            <span>{PATH_HINT[path]}</span>
          </button>
        ))}
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
const SEX_OPTIONS: readonly Option<Sex>[] = SEXES.map((sex) => ({
  value: sex,
  label: SEX_LABEL[sex],
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

/**
 * A multiple-choice group rendered as toggle chips.
 *
 * Native checkboxes for the same reasons `ChoiceGroup` uses radios. `max`
 * disables the unchosen chips once the limit is reached instead of refusing
 * the tap after the fact.
 */
export function ChipGroup<T extends string>({
  legend,
  hint,
  options,
  values,
  onChange,
  max,
  name,
}: {
  legend: string;
  hint?: string;
  options: readonly Option<T>[];
  values: readonly T[];
  onChange: (values: T[]) => void;
  max?: number;
  name?: string;
}) {
  const generated = useId();
  const group = name ?? generated;
  const full = max !== undefined && values.length >= max;
  return (
    <fieldset className="onb-field">
      <legend>{legend}</legend>
      {hint && <p className="onb-hint">{hint}</p>}
      <div className="onb-chips">
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <label
              key={option.value}
              className={`onb-chip ${checked ? "selected" : ""}`}
            >
              <input
                type="checkbox"
                name={group}
                value={option.value}
                checked={checked}
                disabled={!checked && full}
                aria-label={option.label}
                onChange={() =>
                  onChange(
                    checked
                      ? values.filter((value) => value !== option.value)
                      : options
                          .map((o) => o.value)
                          .filter(
                            (value) =>
                              values.includes(value) || value === option.value,
                          ),
                  )
                }
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A number answer that saves when the field is left.
 *
 * Typing "1", "18", "180" must not send three writes, and a half-typed value
 * outside the band must not be refused mid-word. An emptied field removes
 * the answer.
 */
function NumberField({
  label,
  unit,
  value,
  min,
  max,
  onSave,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  min: number;
  max: number;
  onSave: (value: number | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const trimmed = draft.trim().replace(",", ".");
    if (trimmed === "") {
      setInvalid(false);
      if (value !== undefined) onSave(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== value) onSave(parsed);
  };
  return (
    <div className={`onb-field onb-number ${invalid ? "invalid" : ""}`}>
      <label className="onb-label" htmlFor={id}>
        {label}
      </label>
      <div className="onb-number-input">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          className="onb-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          aria-invalid={invalid}
        />
        <span>{unit}</span>
      </div>
      {invalid && (
        <p className="onb-error" role="alert">
          <CircleAlert size={14} aria-hidden="true" />
          Bitte einen Wert zwischen {min} und {max} angeben.
        </p>
      )}
    </div>
  );
}

/** One of the two cards. The header button opens and closes its form. */
function ProfileCard({
  title,
  summary,
  complete,
  optional,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  complete: boolean;
  optional?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panel = useId();
  return (
    <div className={`onb-card ${open ? "open" : ""} ${complete ? "done" : ""}`}>
      <button
        type="button"
        className="onb-card-toggle"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
      >
        <span className="onb-card-check" aria-hidden="true">
          {complete ? <Check size={14} /> : null}
        </span>
        <span className="onb-card-title">
          <strong>{title}</strong>
          <span>
            {summary}
            {optional ? " · freiwillig" : ""}
          </span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="onb-card-chevron"
        />
      </button>
      {open && (
        <div className="onb-card-body" id={panel}>
          {children}
        </div>
      )}
    </div>
  );
}

type CardPatch = { person: PersonPatch; training: TrainingPatch };
const NO_PATCH: CardPatch = { person: {}, training: {} };
const isEmptyPatch = (patch: CardPatch) =>
  !Object.keys(patch.person).length && !Object.keys(patch.training).length;

/** Lays a patch over stored answers for display: null and [] remove. */
function overlay<T extends object>(base: T, patch: object): T {
  const next = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null || (Array.isArray(value) && value.length === 0))
      delete next[key];
    else next[key] = value;
  }
  return next as T;
}

/**
 * The "Plan mit Arnold" screen: the cards Person and Training, then
 * "Plan erstellen".
 *
 * Taps stay on the device and show at once; they are saved in one write when
 * a card is closed, when going back, or with "Plan erstellen". Inside ChatGPT
 * every save is a round trip of seconds, so saving per tap would make the
 * cards wait after every choice. No choice is ever locked while saving.
 */
export function ProfileStep({
  profile,
  progress,
  validation,
  exerciseChoices,
  splitOptions,
  busy,
  canWritePlan,
  onSave,
  onRequestPlan,
  onBack,
  initiallyOpen = null,
}: {
  profile: OnboardingProfile;
  progress: OnboardingProgress;
  validation: OnboardingValidationResult;
  exerciseChoices: readonly ExerciseChoice[];
  splitOptions: readonly Split[];
  busy: boolean;
  canWritePlan: boolean;
  /** Saves both cards' changes in one write; resolves to whether it stuck. */
  onSave: (patch: {
    person?: PersonPatch;
    training?: TrainingPatch;
  }) => Promise<boolean>;
  onRequestPlan: () => void;
  onBack: () => void;
  /** The card that starts open. Both start closed by default. */
  initiallyOpen?: "person" | "training" | null;
}) {
  const [open, setOpen] = useState<"person" | "training" | null>(initiallyOpen);
  /** Taps not sent yet, and taps sent but not yet confirmed by the server. */
  const [pending, setPending] = useState<CardPatch>(NO_PATCH);
  const [inFlight, setInFlight] = useState<CardPatch>(NO_PATCH);

  const person = overlay(
    overlay(profile.person, inFlight.person),
    pending.person,
  );
  const training = overlay(
    overlay(profile.training, inFlight.training),
    pending.training,
  );

  const changePerson = (patch: PersonPatch) =>
    setPending((current) => ({
      ...current,
      person: { ...current.person, ...patch },
    }));
  const changeTraining = (patch: TrainingPatch) =>
    setPending((current) => {
      const next: TrainingPatch = { ...current.training, ...patch };
      // Fixed weekdays decide the count; a different count drops them. The
      // server applies the same rule; this keeps the screen in step with it.
      if (patch.training_days?.length)
        next.days_per_week = patch.training_days.length;
      else if (
        patch.days_per_week !== undefined &&
        (training.training_days?.length ?? 0) > 0 &&
        training.training_days!.length !== patch.days_per_week
      )
        next.training_days = [];
      return { ...current, training: next };
    });

  /** Sends what is pending. Taps made meanwhile stay pending, never lost. */
  const flush = async () => {
    if (isEmptyPatch(pending)) return true;
    const sent = pending;
    setInFlight(sent);
    setPending(NO_PATCH);
    const ok = await onSave({
      ...(Object.keys(sent.person).length ? { person: sent.person } : {}),
      ...(Object.keys(sent.training).length ? { training: sent.training } : {}),
    });
    setInFlight(NO_PATCH);
    if (!ok)
      setPending((current) => ({
        person: { ...sent.person, ...current.person },
        training: { ...sent.training, ...current.training },
      }));
    return ok;
  };

  const toggle = (card: "person" | "training") => {
    void flush();
    setOpen((current) => (current === card ? null : card));
  };

  const missing = TRAINING_REQUIRED_FIELDS.filter(
    (field) => training[field] === null || training[field] === undefined,
  );
  const trainingComplete = missing.length === 0;
  const personComplete = PERSON_BASICS.every(
    (field) => person[field] !== undefined,
  );
  const notesId = useId();
  const [notes, setNotes] = useState(training.notes ?? "");

  const personSummary =
    [
      person.age_years !== undefined ? `${person.age_years} Jahre` : null,
      person.sex ? SEX_LABEL[person.sex] : null,
      person.height_cm !== undefined ? `${person.height_cm} cm` : null,
      person.body_weight_kg !== undefined
        ? `${person.body_weight_kg} kg`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Alter, Geschlecht, Größe, Gewicht";
  const trainingSummary = trainingComplete
    ? [
        training.primary_goal ? GOAL_LABEL[training.primary_goal] : null,
        training.days_per_week !== null
          ? `${training.days_per_week} × pro Woche`
          : null,
        training.session_minutes !== null
          ? `${training.session_minutes} Min.`
          : null,
        training.environment ? ENVIRONMENT_LABEL[training.environment] : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : `Ziel, Tage, Zeit, Ort · noch ${missing.length} offen`;

  const splitChoices = SPLITS.filter(
    (split) => splitOptions.includes(split) || split === training.split,
  ).map((split) => ({
    value: split,
    label: SPLIT_LABEL[split],
    hint: SPLIT_HINT[split],
  }));
  const groups = MUSCLE_GROUPS.map((group) => ({
    group,
    exercises: exerciseChoices.filter(
      (choice) => choice.muscle_group === group,
    ),
  })).filter((entry) => entry.exercises.length);
  const preferred = training.preferred_exercise_ids ?? [];

  return (
    <OnboardingLayout
      title="Erzähl Arnold von dir"
      lead="Zwei kurze Bereiche. Alles wird sofort gespeichert."
      progress={progress}
      onBack={() => void flush().then(() => onBack())}
      footer={
        <button
          type="button"
          className="primary onb-cta"
          onClick={() =>
            void flush().then((ok) => {
              if (ok) onRequestPlan();
            })
          }
          disabled={busy || !trainingComplete || !canWritePlan}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          Plan erstellen
        </button>
      }
    >
      <div className="onb-cards">
        <ProfileCard
          title="Person"
          summary={personSummary}
          complete={personComplete}
          optional
          open={open === "person"}
          onToggle={() => toggle("person")}
        >
          <div className="onb-number-row">
            <NumberField
              label="Alter"
              unit="Jahre"
              value={person.age_years}
              min={14}
              max={100}
              onSave={(value) => changePerson({ age_years: value })}
            />
            <NumberField
              label="Größe"
              unit="cm"
              value={person.height_cm}
              min={120}
              max={230}
              onSave={(value) => changePerson({ height_cm: value })}
            />
            <NumberField
              label="Gewicht"
              unit="kg"
              value={person.body_weight_kg}
              min={30}
              max={300}
              onSave={(value) => changePerson({ body_weight_kg: value })}
            />
          </div>
          <ChoiceGroup
            legend="Geschlecht"
            options={SEX_OPTIONS}
            value={person.sex ?? null}
            onChange={(value) => changePerson({ sex: value })}
            columns="compact"
            name="sex"
          />
          <ChipGroup
            legend="Gibt es Bereiche, die du schonen möchtest?"
            hint="Arnold wählt dafür schonendere Übungen. Keine Diagnose nötig."
            options={BODY_AREAS.map((area) => ({
              value: area,
              label: BODY_AREA_LABEL[area],
            }))}
            values={person.protect_areas ?? []}
            onChange={(values) => changePerson({ protect_areas: values })}
            name="protect_areas"
          />
        </ProfileCard>

        <ProfileCard
          title="Training"
          summary={trainingSummary}
          complete={trainingComplete}
          open={open === "training"}
          onToggle={() => toggle("training")}
        >
          <ChoiceGroup
            legend="Was ist dein Ziel?"
            options={GOAL_OPTIONS}
            value={training.primary_goal}
            onChange={(value) => changeTraining({ primary_goal: value })}
            name="primary_goal"
          />
          <ChoiceGroup
            legend="Wie lange trainierst du schon?"
            options={EXPERIENCE_OPTIONS}
            value={training.experience}
            onChange={(value) => changeTraining({ experience: value })}
            name="experience"
          />
          <ChipGroup
            legend="An welchen Tagen kannst du trainieren?"
            hint="Feste Tage antippen – oder unten nur die Anzahl wählen."
            options={WEEKDAYS.map((day) => ({
              value: day,
              label: WEEKDAY_LABEL[day],
            }))}
            values={training.training_days ?? []}
            onChange={(values) => changeTraining({ training_days: values })}
            name="training_days"
          />
          <ChoiceGroup
            legend="Wie oft pro Woche?"
            options={DAY_OPTIONS}
            value={training.days_per_week}
            onChange={(value) => changeTraining({ days_per_week: value })}
            columns="compact"
            name="days_per_week"
          />
          <ChoiceGroup
            legend="Wie viel Zeit hast du pro Training?"
            options={MINUTE_OPTIONS}
            value={training.session_minutes}
            onChange={(value) => changeTraining({ session_minutes: value })}
            columns="compact"
            name="session_minutes"
          />
          <ChoiceGroup
            legend="Wo trainierst du?"
            options={ENVIRONMENT_OPTIONS}
            value={training.environment}
            onChange={(value) => changeTraining({ environment: value })}
            name="environment"
          />
          {(training.environment === "home" ||
            training.environment === "outdoor") && (
            <ChipGroup
              legend="Welche Geräte hast du?"
              hint="Ohne Auswahl plant Arnold mit dem eigenen Körpergewicht."
              options={EQUIPMENT.map((item) => ({
                value: item,
                label: EQUIPMENT_LABEL[item],
              }))}
              values={training.equipment ?? []}
              onChange={(values) => changeTraining({ equipment: values })}
              name="equipment"
            />
          )}
          <ChoiceGroup
            legend="Bevorzugst du eine Aufteilung?"
            options={splitChoices}
            value={training.split ?? "auto"}
            onChange={(value) => changeTraining({ split: value })}
            name="split"
          />
          <ChipGroup
            legend="Worauf soll der Schwerpunkt liegen?"
            hint="Bis zu drei Muskelgruppen. Optional."
            options={MUSCLE_GROUPS.map((group) => ({
              value: group,
              label: MUSCLE_GROUP_LABEL[group],
            }))}
            values={training.focus_muscle_groups ?? []}
            onChange={(values) =>
              changeTraining({ focus_muscle_groups: values })
            }
            max={3}
            name="focus_muscle_groups"
          />
          {groups.length > 0 && (
            <fieldset className="onb-field onb-exercises">
              <legend>Welche Übungen machst du gern?</legend>
              <p className="onb-hint">
                Antippen, was in deinen Plan soll. Optional.
              </p>
              {groups.map(({ group, exercises }) => (
                <ChipGroup
                  key={group}
                  legend={MUSCLE_GROUP_LABEL[group]}
                  options={exercises.map((exercise) => ({
                    value: exercise.exercise_id,
                    label: exercise.name_de,
                  }))}
                  values={preferred.filter((id) =>
                    exercises.some((exercise) => exercise.exercise_id === id),
                  )}
                  onChange={(values) =>
                    changeTraining({
                      preferred_exercise_ids: [
                        ...preferred.filter(
                          (id) =>
                            !exercises.some(
                              (exercise) => exercise.exercise_id === id,
                            ),
                        ),
                        ...values,
                      ],
                    })
                  }
                  name={`preferred-${group}`}
                />
              ))}
            </fieldset>
          )}
          <div className="onb-field">
            <label className="onb-label" htmlFor={notesId}>
              Sonst noch etwas?
            </label>
            <p className="onb-hint">Freitext, optional.</p>
            <textarea
              id={notesId}
              className="onb-textarea"
              rows={2}
              maxLength={600}
              placeholder="z. B. Ich trainiere am liebsten morgens."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                const next = notes.trim();
                if (next !== (training.notes ?? ""))
                  changeTraining({ notes: next || null });
              }}
            />
          </div>
        </ProfileCard>
      </div>
      {!trainingComplete && (
        <p className="onb-note">
          Für deinen Plan fehlt noch:{" "}
          {missing
            .map((field) => REQUIRED_FIELD_LABEL[`training.${field}`])
            .join(", ")}
          .
        </p>
      )}
      <OnboardingIssues validation={validation} step="profile" />
    </OnboardingLayout>
  );
}

/**
 * The "Eigener Plan" screen. The plan arrives through the chat — as text or a
 * photo — so this screen only says so and waits for the draft.
 */
export function OwnPlanStep({
  onBack,
  onAskChat,
  onReload,
  busy,
}: {
  onBack: () => void;
  onAskChat: () => void;
  onReload: () => void;
  busy: boolean;
}) {
  return (
    <OnboardingLayout
      title="Deinen Plan übernehmen"
      lead="Schreib deinen Plan in den Chat oder schick ein Foto davon."
      onBack={onBack}
    >
      <OnboardingNotice tone="info" title="So geht es">
        <p>
          Zum Beispiel: „Montag Brust und Trizeps: Bankdrücken 3×8, Dips 3×10 …"
          oder ein Foto von deinem Zettel. Arnold überträgt den Plan und zeigt
          ihn dir hier als Entwurf. Fehlende Sätze oder Wiederholungen kannst du
          danach ergänzen.
        </p>
      </OnboardingNotice>
      <div className="onb-actions">
        <button
          type="button"
          className="primary"
          onClick={onAskChat}
          disabled={busy}
        >
          Im Chat weitermachen
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onReload}
          disabled={busy}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Nach dem Plan suchen
        </button>
      </div>
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
  path,
  onBack,
  onReload,
  busy,
}: {
  daysPerWeek: number | null;
  minutes: number | null;
  path: OnboardingPath | null;
  onBack: () => void;
  onReload: () => void;
  busy: boolean;
}) {
  const existing = path === "own_plan";
  return (
    <OnboardingLayout
      title="Jetzt entsteht dein Plan"
      lead="Arnold erstellt deinen Trainingsplan im Chat – mit allen Angaben, die du gerade gemacht hast."
      onBack={onBack}
    >
      <OnboardingNotice tone="info" title="So geht es weiter">
        <p>
          Arnold arbeitet im Chat an deinem Plan. Falls dort nichts passiert,
          schreib zum Beispiel:
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
          <strong>{existing ? "Eigener Plan" : "Plan von Arnold"}</strong>
          <span>Weg</span>
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
  available = false,
  onConnect,
  onRefresh,
}: {
  planName: string;
  revision: number;
  sessionCount: number;
  exerciseCount: number;
  onRevise: () => void;
  busy: boolean;
  available?: boolean;
  onConnect?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <OnboardingLayout
      title="Dein Trainingsplan ist bereit."
      lead={`${planName} · ${sessionCount} Trainingseinheiten · ${exerciseCount} Übungen`}
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
      {available ? (
        <OnboardingNotice tone="info" title="Deine eigene Trainingsdatei">
          <p>
            Gib Arnold bei Google Zugriff auf die von Arnold erstellte Datei.
            Nach erfolgreicher Prüfung wird dein bestätigter Plan dort
            aktiviert. Deine übrigen Drive-Dateien bleiben außerhalb dieser
            Freigabe.
          </p>
        </OnboardingNotice>
      ) : (
        <OnboardingNotice tone="info" title="Noch nicht verfügbar">
          <p>
            Die Google-Verbindung ist noch nicht implementiert. Es wurde kein
            Google-Konto verbunden, keine Datei angelegt und kein Plan in einer
            Trainingsdatei aktiviert. Dein bestätigter Plan ist gespeichert und
            wird für diesen Schritt übernommen.
          </p>
        </OnboardingNotice>
      )}
      <div className="onb-actions">
        <button
          type="button"
          className="primary"
          disabled={!available || busy}
          aria-disabled={!available || busy}
          onClick={onConnect}
          title={
            available
              ? "Google-Freigabe öffnen"
              : "Diese Funktion folgt im nächsten Entwicklungsschritt."
          }
        >
          Google-Konto verbinden
        </button>
        {available ? (
          <button
            type="button"
            className="secondary"
            onClick={onRefresh}
            disabled={busy}
          >
            Einrichtung prüfen und abschließen
          </button>
        ) : (
          <span className="onb-badge">Nächster Entwicklungsschritt</span>
        )}
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
