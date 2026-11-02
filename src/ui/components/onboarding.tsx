import { useEffect, useRef, useState } from "react";
import type {
  OnboardingProfile,
  OnboardingProfilePatch,
  OnboardingProgress,
  OnboardingValidationResult,
  OnboardingPath,
  Training,
  Person,
} from "../../shared/onboarding-contract";
import {
  TRAINING_GOALS,
  GOAL_LABEL,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LABEL,
  TRAINING_ENVIRONMENTS,
  ENVIRONMENT_LABEL,
  SEXES,
  SEX_LABEL,
  BODY_AREAS,
  BODY_AREA_LABEL,
  WEEKDAYS,
  WEEKDAY_LABEL,
  SPLITS,
  SPLIT_LABEL,
  EQUIPMENT,
  MUSCLE_GROUPS,
  EQUIPMENT_LABEL,
  MUSCLE_GROUP_LABEL,
} from "../../shared/onboarding-contract";
import {
  ArnoldCard,
  CardActions,
  CardNote,
  ChipGroup,
  Rows,
  Stepper,
} from "./cards";
import { formatNumber } from "../format";

type RequiredQuestion =
  | "primary_goal"
  | "experience"
  | "days_per_week"
  | "session_minutes"
  | "environment";
const REQUIRED: readonly RequiredQuestion[] = [
  "primary_goal",
  "experience",
  "days_per_week",
  "session_minutes",
  "environment",
];
type Question =
  | RequiredQuestion
  | "person"
  | "age_years"
  | "sex"
  | "height_cm"
  | "body_weight_kg"
  | "protect_areas"
  | "review"
  | "edit"
  | "training_days"
  | "split"
  | "equipment"
  | "focus_muscle_groups"
  | "preferred_exercise_ids"
  | "avoided_exercise_ids";
const PERSON: readonly Question[] = [
  "age_years",
  "sex",
  "height_cm",
  "body_weight_kg",
  "protect_areas",
];
const WISHES: readonly Question[] = [
  "training_days",
  "split",
  "equipment",
  "focus_muscle_groups",
  "preferred_exercise_ids",
  "avoided_exercise_ids",
];
const TITLES: Record<Question, string> = {
  edit: "Was möchtest du ändern?",
  person: "Möchtest du etwas über dich angeben?",
  age_years: "Wie alt bist du?",
  sex: "Welches Geschlecht möchtest du angeben?",
  height_cm: "Wie groß bist du?",
  body_weight_kg: "Wie viel wiegst du?",
  protect_areas: "Welche Bereiche möchtest du schonen?",
  primary_goal: "Was ist dein Ziel?",
  experience: "Wie lange trainierst du schon?",
  days_per_week: "Wie oft möchtest du pro Woche trainieren?",
  session_minutes: "Wie viel Zeit hast du pro Training?",
  environment: "Wo trainierst du?",
  review: "Passt das so für deinen Plan?",
  training_days: "Möchtest du feste Trainingstage?",
  split: "Wie möchtest du dein Training aufteilen?",
  equipment: "Welche Geräte stehen dir zur Verfügung?",
  focus_muscle_groups: "Welche Muskeln möchtest du besonders trainieren?",
  preferred_exercise_ids: "Welche Übungen machst du besonders gern?",
  avoided_exercise_ids: "Welche Übungen möchtest du vermeiden?",
};
const options = <T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
) => values.map((value) => ({ value, label: labels[value] }));

export function initialProfileQuestion(profile: OnboardingProfile): Question {
  const missing = REQUIRED.find((key) => profile.training[key] === null);
  if (!missing) return "review";
  return REQUIRED.some((key) => profile.training[key] !== null) ||
    Object.keys(profile.person).length
    ? missing
    : "person";
}

/** Native inputs keep keyboard and assistive technology behaviour familiar. */
export function MultiChoice<T extends string>({
  label,
  options,
  values,
  onChange,
  max = Infinity,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  values: readonly T[];
  onChange: (values: T[]) => void;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <fieldset className="ac-field">
      <legend className="visually-hidden">{label}</legend>
      <div className="ac-chips">
        {options.map((option) => (
          <label className="ac-choice" key={option.value}>
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              disabled={
                disabled ||
                (!values.includes(option.value) && values.length >= max)
              }
              onChange={() =>
                onChange(
                  values.includes(option.value)
                    ? values.filter((v) => v !== option.value)
                    : [...values, option.value],
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function WelcomeStep({
  onChoose,
  busy,
  canWritePlan,
  googleAvailable,
}: {
  onChoose: (path: OnboardingPath) => void;
  busy: boolean;
  canWritePlan: boolean;
  googleAvailable?: boolean;
}) {
  return (
    <ArnoldCard
      label="Dein Training, einfacher"
      title="Willkommen bei Arnold"
      subtitle="Dein Trainingsbegleiter im Chat. Ein Plan, schnelle Satzeingabe und dein Fortschritt an einem Ort."
    >
      <p className="ac-text">Wie möchtest du starten?</p>
      {!canWritePlan && (
        <CardNote>
          Hier kannst du die Einrichtung ansehen. Ein Plan kann in dieser
          Verbindung noch nicht gespeichert werden.
        </CardNote>
      )}
      {!googleAvailable && (
        <p className="ac-caption">
          In dieser Vorschau ist Google nicht verfügbar. Es wird keine Datei
          erstellt.
        </p>
      )}
      <CardActions
        primary={{
          label: "Plan mit Arnold erstellen",
          onClick: () => onChoose("arnold_plan"),
          disabled: busy || !canWritePlan,
        }}
        secondary={{
          label: "Eigenen Plan übernehmen",
          onClick: () => onChoose("own_plan"),
          disabled: busy || !canWritePlan,
        }}
      />
    </ArnoldCard>
  );
}

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
  sessionKey = "preview",
  suppressIssues = false,
  onQuestion,
}: {
  profile: OnboardingProfile;
  progress: OnboardingProgress;
  validation: OnboardingValidationResult;
  exerciseChoices: readonly { exercise_id: string; name_de: string }[];
  splitOptions: readonly (keyof typeof SPLIT_LABEL)[];
  busy: boolean;
  canWritePlan: boolean;
  onSave: (patch: OnboardingProfilePatch) => boolean | Promise<boolean>;
  onRequestPlan: () => void;
  onBack: () => void;
  sessionKey?: string;
  suppressIssues?: boolean;
  onQuestion?: (title: string) => void;
}) {
  const [question, setQuestion] = useState<Question>(() =>
    initialProfileQuestion(profile),
  );
  const [answer, setAnswer] = useState<string>();
  const [many, setMany] = useState<string[]>([]);
  const [number, setNumber] = useState(0);
  const [valid, setValid] = useState(true);
  const [error, setError] = useState("");
  const [editingAnswer, setEditingAnswer] = useState(false);
  const guard = useRef(false);
  const person = profile.person;
  const training = profile.training;
  const requiredIndex = REQUIRED.indexOf(question as RequiredQuestion);
  const optional = PERSON.includes(question) || WISHES.includes(question);
  useEffect(() => {
    onQuestion?.(TITLES[question]);
    setError("");
    setValid(true);
    const source = PERSON.includes(question) ? person : training;
    const value = (source as Record<string, unknown>)[question];
    setAnswer(
      typeof value === "string"
        ? value
        : value === null || value === undefined
          ? undefined
          : String(value),
    );
    setMany(Array.isArray(value) ? value : []);
    const defaults: Partial<Record<Question, number>> = {
      age_years: 30,
      height_cm: 175,
      body_weight_kg: 75,
      days_per_week: 3,
      session_minutes: 60,
    };
    setNumber(typeof value === "number" ? value : (defaults[question] ?? 0));
  }, [question]);
  const firstMissing = () =>
    REQUIRED.find((key) => training[key] === null) ?? "review";
  const nextQuestion = (): Question => {
    if (editingAnswer) return "review";
    if (PERSON.includes(question))
      return PERSON[PERSON.indexOf(question) + 1] ?? firstMissing();
    if (WISHES.includes(question))
      return WISHES[WISHES.indexOf(question) + 1] ?? "review";
    if (requiredIndex >= 0)
      return (
        REQUIRED.slice(requiredIndex + 1).find(
          (key) => training[key] === null,
        ) ?? "review"
      );
    return firstMissing();
  };
  async function next(skip = false) {
    if (guard.current || busy || (!skip && !valid)) return;
    guard.current = true;
    setError("");
    try {
      if (!skip) {
        let patch: OnboardingProfilePatch;
        const numeric = [
          "age_years",
          "height_cm",
          "body_weight_kg",
          "days_per_week",
          "session_minutes",
        ].includes(question);
        const multi = [
          "protect_areas",
          "training_days",
          "equipment",
          "focus_muscle_groups",
          "preferred_exercise_ids",
          "avoided_exercise_ids",
        ].includes(question);
        if (!numeric && !multi && !answer) {
          setError("Wähle eine Antwort aus.");
          return;
        }
        const value = numeric ? number : multi ? many : answer;
        patch = PERSON.includes(question)
          ? { person: { [question]: value } as Person }
          : {
              training: { [question]: value } as NonNullable<
                OnboardingProfilePatch["training"]
              >,
            };
        if (!(await onSave(patch))) return;
      }
      setQuestion(nextQuestion());
    } finally {
      guard.current = false;
    }
  }
  const back = () => {
    if (question === "review") {
      setQuestion("edit");
      return;
    }
    if (editingAnswer) {
      setQuestion("edit");
      return;
    }
    if (requiredIndex > 0) {
      setQuestion(REQUIRED[requiredIndex - 1]);
      return;
    }
    const list = PERSON.includes(question)
      ? PERSON
      : WISHES.includes(question)
        ? WISHES
        : [];
    const index = list.indexOf(question);
    if (index > 0) setQuestion(list[index - 1]);
    else if (WISHES.includes(question)) setQuestion("review");
    else onBack();
  };
  let content;
  if (question === "primary_goal")
    content = (
      <ChipGroup
        label={TITLES[question]}
        value={answer}
        onChange={setAnswer}
        options={options(TRAINING_GOALS, GOAL_LABEL)}
        disabled={busy}
      />
    );
  else if (question === "experience")
    content = (
      <ChipGroup
        label={TITLES[question]}
        value={answer}
        onChange={setAnswer}
        options={options(EXPERIENCE_LEVELS, EXPERIENCE_LABEL)}
        disabled={busy}
      />
    );
  else if (question === "environment")
    content = (
      <ChipGroup
        label={TITLES[question]}
        value={answer}
        onChange={setAnswer}
        options={options(TRAINING_ENVIRONMENTS, ENVIRONMENT_LABEL)}
        disabled={busy}
      />
    );
  else if (question === "sex")
    content = (
      <ChipGroup
        label={TITLES[question]}
        value={answer}
        onChange={setAnswer}
        options={options(SEXES, SEX_LABEL)}
        disabled={busy}
      />
    );
  else if (question === "split")
    content = (
      <ChipGroup
        label={TITLES[question]}
        value={answer}
        onChange={setAnswer}
        options={splitOptions.map((value) => ({
          value,
          label: SPLIT_LABEL[value],
        }))}
        disabled={busy}
      />
    );
  else if (question === "days_per_week")
    content = (
      <ChipGroup
        label={TITLES[question]}
        value={String(number)}
        onChange={(v) => v && setNumber(Number(v))}
        options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({
          value: String(n),
          label: String(n),
        }))}
        disabled={busy}
      />
    );
  else if (question === "session_minutes")
    content = (
      <>
        <ChipGroup
          label="Zeit auswählen"
          value={String(number)}
          onChange={(v) => v && setNumber(Number(v))}
          options={[30, 45, 60, 75, 90].map((n) => ({
            value: String(n),
            label: `${n} Min.`,
          }))}
          disabled={busy}
        />
        <Stepper
          key={question}
          onValidityChange={setValid}
          label="Minuten pro Training"
          value={number}
          unit="Min."
          step={5}
          min={20}
          max={150}
          onChange={setNumber}
          disabled={busy}
        />
      </>
    );
  else if (["age_years", "height_cm", "body_weight_kg"].includes(question))
    content = (
      <Stepper
        key={question}
        onValidityChange={setValid}
        label={
          question === "age_years"
            ? "Alter"
            : question === "height_cm"
              ? "Größe"
              : "Gewicht"
        }
        unit={
          question === "age_years"
            ? "Jahre"
            : question === "height_cm"
              ? "cm"
              : "kg"
        }
        value={number}
        step={question === "body_weight_kg" ? 0.5 : 1}
        min={
          question === "age_years" ? 14 : question === "height_cm" ? 120 : 30
        }
        max={
          question === "age_years" ? 100 : question === "height_cm" ? 230 : 300
        }
        onChange={setNumber}
        disabled={busy}
        format={(v) => formatNumber(v, 1)}
      />
    );
  else if (question === "protect_areas")
    content = (
      <MultiChoice
        label={TITLES[question]}
        options={options(BODY_AREAS, BODY_AREA_LABEL)}
        values={many}
        onChange={setMany}
        disabled={busy}
      />
    );
  else if (question === "training_days")
    content = (
      <MultiChoice
        label={TITLES[question]}
        options={options(WEEKDAYS, WEEKDAY_LABEL)}
        values={many}
        onChange={setMany}
        disabled={busy}
      />
    );
  else if (question === "equipment")
    content = (
      <MultiChoice
        label={TITLES[question]}
        options={options(EQUIPMENT, EQUIPMENT_LABEL)}
        values={many}
        onChange={setMany}
        disabled={busy}
      />
    );
  else if (question === "focus_muscle_groups")
    content = (
      <MultiChoice
        label={TITLES[question]}
        options={options(MUSCLE_GROUPS, MUSCLE_GROUP_LABEL)}
        values={many}
        onChange={setMany}
        disabled={busy}
        max={3}
      />
    );
  else if (
    question === "preferred_exercise_ids" ||
    question === "avoided_exercise_ids"
  )
    content = (
      <MultiChoice
        label={TITLES[question]}
        options={exerciseChoices.map((e) => ({
          value: e.exercise_id,
          label: e.name_de,
        }))}
        values={many}
        onChange={setMany}
        disabled={busy}
      />
    );
  if (question === "edit")
    return (
      <ArnoldCard label="Deine Angaben" title={TITLES.edit}>
        <ChipGroup
          label="Angabe auswählen"
          value={undefined}
          options={[
            { value: "primary_goal", label: "Ziel" },
            { value: "experience", label: "Erfahrung" },
            { value: "days_per_week", label: "Trainingstage" },
            { value: "session_minutes", label: "Zeit" },
            { value: "environment", label: "Trainingsort" },
            { value: "person", label: "Persönliche Angaben" },
          ]}
          onChange={(value) => {
            if (value) {
              setEditingAnswer(value !== "person");
              setQuestion(value as Question);
            }
          }}
        />
        <CardActions
          secondary={{ label: "Zurück", onClick: () => setQuestion("review") }}
        />
      </ArnoldCard>
    );
  if (question === "person")
    return (
      <ArnoldCard
        label="Einrichtung · Schritt 1 von 4"
        title={TITLES.person}
        subtitle="Alter, Größe und Trainingswünsche helfen beim Plan. Alle persönlichen Angaben sind freiwillig."
      >
        <CardActions
          primary={{
            label: "Persönliche Angaben ergänzen",
            onClick: () => setQuestion("age_years"),
            disabled: busy,
          }}
          secondary={{
            label: "Überspringen",
            onClick: () => setQuestion(firstMissing()),
            disabled: busy,
          }}
        />
        <button className="ac-link" onClick={onBack} disabled={busy}>
          Zurück
        </button>
      </ArnoldCard>
    );
  if (question === "review")
    return (
      <ArnoldCard
        label="Einrichtung · Schritt 1 von 4"
        title={TITLES.review}
        subtitle="Du kannst alle Angaben auch im Chat ändern."
      >
        <Rows
          items={[
            {
              key: "goal",
              label: "Dein Ziel",
              value: training.primary_goal
                ? GOAL_LABEL[training.primary_goal]
                : "Noch offen",
            },
            {
              key: "experience",
              label: "Erfahrung",
              value: training.experience
                ? EXPERIENCE_LABEL[training.experience]
                : "Noch offen",
            },
            {
              key: "days",
              label: "Trainingstage pro Woche",
              value: training.days_per_week ?? "Noch offen",
            },
            {
              key: "minutes",
              label: "Zeit pro Training",
              value: training.session_minutes
                ? `${training.session_minutes} Min.`
                : "Noch offen",
            },
            {
              key: "place",
              label: "Trainingsort",
              value: training.environment
                ? ENVIRONMENT_LABEL[training.environment]
                : "Noch offen",
            },
          ]}
        />
        {!progress.can_request_plan && (
          <CardNote>Es fehlen noch Angaben für deinen Plan.</CardNote>
        )}
        <CardActions
          primary={{
            label: "Plan erstellen",
            disabled: busy || !canWritePlan || !progress.can_request_plan,
            onClick: onRequestPlan,
          }}
          secondary={{
            label: "Wünsche ergänzen",
            disabled: busy,
            onClick: () => {
              setEditingAnswer(false);
              setQuestion("training_days");
            },
          }}
        />
        <button className="ac-link" disabled={busy} onClick={back}>
          Angaben ändern
        </button>
      </ArnoldCard>
    );
  // B19: while a save is running or unconfirmed, the server's "missing"
  // finding describes the state before the answer and would be a second,
  // contradicting alert next to the pending notice. It returns once settled.
  const issue =
    busy || suppressIssues
      ? undefined
      : validation.errors.find(
          (e) =>
            e.field === `training.${question}` ||
            e.field === `person.${question}`,
        );
  return (
    <ArnoldCard
      label={`Einrichtung · ${optional ? "Freiwillige Angabe" : `Frage ${requiredIndex + 1} von ${REQUIRED.length}`}`}
      title={TITLES[question]}
      subtitle={
        question === "focus_muscle_groups"
          ? "Wähle bis zu drei Muskelgruppen."
          : optional
            ? "Du kannst diese Frage überspringen."
            : undefined
      }
      busy={busy}
    >
      {content}
      {(error || issue) && (
        <CardNote tone="error">{error || issue?.message}</CardNote>
      )}
      <CardActions
        primary={{
          label: busy ? "Wird gespeichert …" : "Weiter",
          onClick: () => void next(),
          disabled:
            busy ||
            !valid ||
            (!answer &&
              [
                "primary_goal",
                "experience",
                "environment",
                "sex",
                "split",
              ].includes(question)),
        }}
        secondary={
          optional
            ? {
                label: "Überspringen",
                onClick: () => void next(true),
                disabled: busy,
              }
            : { label: "Zurück", onClick: back, disabled: busy }
        }
      />
      {optional && (
        <button className="ac-link" disabled={busy} onClick={back}>
          Zurück
        </button>
      )}
    </ArnoldCard>
  );
}
