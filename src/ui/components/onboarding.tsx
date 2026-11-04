import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Ban,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crosshair,
  Dumbbell,
  FileText,
  Heart,
  LayoutGrid,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Target,
  TrendingUp,
  User,
} from "lucide-react";
import type {
  OnboardingProfile,
  OnboardingProfilePatch,
  OnboardingProgress,
  OnboardingValidationResult,
  OnboardingPath,
  Person,
  TrainingGoal,
} from "../../shared/onboarding-contract";
import {
  TRAINING_GOALS,
  GOAL_LABEL,
  GOAL_HINT,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LABEL,
  EXPERIENCE_HINT,
  TRAINING_ENVIRONMENTS,
  ENVIRONMENT_LABEL,
  ENVIRONMENT_HINT,
  SEXES,
  SEX_LABEL,
  BODY_AREAS,
  BODY_AREA_LABEL,
  WEEKDAYS,
  WEEKDAY_LABEL,
  SPLIT_LABEL,
  EQUIPMENT,
  MUSCLE_GROUPS,
  EQUIPMENT_LABEL,
  MUSCLE_GROUP_LABEL,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
} from "../../shared/onboarding-contract";
import { CardActions, CardNote } from "./cards";
import { formatNumber } from "../format";

/**
 * The setup as one guided card: a few people facts (optional), four
 * questions, the user's wishes, then a review in plain words.
 *
 * Every page saves its answers as one patch through `onSave`, which buffers
 * and retries on its own; the card moves on immediately.
 */

type Page =
  | "person"
  | "goal"
  | "experience"
  | "rhythm"
  | "environment"
  | "wishes"
  | "review";

const QUESTIONS: readonly Page[] = [
  "goal",
  "experience",
  "rhythm",
  "environment",
];

/** Where the setup is: Angaben, Wünsche, Prüfen, Plan. */
export function SetupHead({
  label,
  phase,
  within,
  onBack,
  backLabel = "Zurück",
  menu,
}: {
  label: string;
  /** 0 Angaben, 1 Wünsche, 2 Prüfen, 3 Plan, 4 fertig. */
  phase: number;
  /** How far into the current phase, 0 to 1. */
  within: number;
  onBack?: () => void;
  backLabel?: string;
  menu?: readonly {
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[];
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  return (
    <>
      <div className="ac-setup-head">
        {onBack && (
          <button
            type="button"
            className="ac-icon-btn ac-back"
            aria-label={backLabel}
            onClick={onBack}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
        )}
        <span className="ac-label-col">
          <span className="ac-label">{label}</span>
          <span className="ac-progress" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <i key={i}>
                <b
                  style={{
                    width: `${i < phase ? 100 : i === phase ? Math.round(within * 100) : 0}%`,
                  }}
                />
              </i>
            ))}
          </span>
        </span>
        {menu && menu.length > 0 && (
          <button
            type="button"
            className="ac-icon-btn"
            aria-label="Weitere Aktionen"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && menu && (
        <ul className="ac-menu ac-setup-menu" id={menuId}>
          {menu.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                className={`ac-menu-item ${item.danger ? "danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
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

/** One choice of a single answer (radio) or several (checkbox), with a hint. */
function OptionTiles<T extends string>({
  label,
  options,
  values,
  multiple,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string; hint: string }[];
  values: readonly T[];
  multiple?: boolean;
  onChange: (values: T[]) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="ac-field ac-tiles">
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => {
        const on = values.includes(option.value);
        return (
          <label
            className={`ac-option-tile ${on ? "on" : ""}`}
            key={option.value}
          >
            <input
              className="visually-hidden"
              type={multiple ? "checkbox" : "radio"}
              name={name}
              checked={on}
              disabled={disabled}
              onChange={() =>
                onChange(
                  multiple
                    ? on
                      ? values.filter((v) => v !== option.value)
                      : [...values, option.value]
                    : [option.value],
                )
              }
            />
            <span className="ac-option-text">
              <strong>{option.label}</strong>
              <span>{option.hint}</span>
            </span>
            <span
              className={`ac-option-mark ${multiple ? "square" : ""}`}
              aria-hidden="true"
            >
              {on && <Check size={14} strokeWidth={3.5} />}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** A row that opens to show its choices. Closed it shows what is set. */
function Fold({
  icon,
  title,
  value,
  set,
  open,
  onToggle,
  children,
}: {
  icon?: ReactNode;
  title: string;
  value: string;
  set: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={`ac-fold ${open ? "open" : ""}`}>
      <button
        type="button"
        className="ac-fold-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        {icon && (
          <span className={`ac-fold-icon ${set ? "set" : ""}`}>{icon}</span>
        )}
        <span className="ac-fold-text">
          <strong>{title}</strong>
          <span className={set ? "set" : ""}>{value}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className="ac-fold-chevron" />
      </button>
      {open && (
        <div className="ac-fold-body" id={id}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A number typed in directly; empty means "keine Angabe". Accepts the German
 * decimal comma. Out-of-range text stays visible and is reported as invalid,
 * so nothing is saved that the user did not mean.
 */
function MiniNumber({
  label,
  unit,
  value,
  min,
  max,
  decimals,
  onChange,
  disabled,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  min: number;
  max: number;
  decimals?: boolean;
  onChange: (value: number | undefined, valid: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const show = (v: number | undefined) =>
    v === undefined ? "" : formatNumber(v, decimals ? 1 : 0);
  const [text, setText] = useState(show(value));
  const parse = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    if (!/^\d+([.,]\d+)?$/.test(trimmed)) return null;
    const n = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max) return null;
    if (!decimals && !Number.isInteger(n)) return null;
    return n;
  };
  // Follow a value set from outside, but never rewrite what is being typed.
  useEffect(() => {
    const parsed = parse(text);
    if (parsed !== null && parsed !== value) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const invalid = parse(text) === null;
  return (
    <div className={`ac-mini ${invalid ? "invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <span className="ac-mini-value">
        <input
          id={id}
          type="text"
          inputMode={decimals ? "decimal" : "numeric"}
          autoComplete="off"
          value={text}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? hintId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = parse(event.target.value);
            if (parsed === null) onChange(value, false);
            else onChange(parsed, true);
          }}
        />
        <small aria-hidden="true">{unit}</small>
      </span>
      {invalid && (
        <small className="ac-mini-hint" id={hintId}>
          {min} bis {max} {unit}
        </small>
      )}
    </div>
  );
}

export function initialProfileQuestion(profile: OnboardingProfile): Page {
  const t = profile.training;
  const firstMissing: Page | undefined =
    t.primary_goal === null
      ? "goal"
      : t.experience === null
        ? "experience"
        : t.days_per_week === null || t.session_minutes === null
          ? "rhythm"
          : t.environment === null
            ? "environment"
            : undefined;
  if (!firstMissing) return "review";
  const anyAnswer =
    t.primary_goal !== null ||
    t.experience !== null ||
    t.days_per_week !== null ||
    t.session_minutes !== null ||
    t.environment !== null ||
    Object.keys(profile.person).length > 0;
  return anyAnswer ? firstMissing : "person";
}

export function WelcomeStep({
  onChoose,
  busy,
  canWritePlan,
}: {
  onChoose: (path: OnboardingPath) => void;
  busy: boolean;
  canWritePlan: boolean;
}) {
  const disabled = busy || !canWritePlan;
  const ids = useId();
  return (
    <section className="ac" aria-label="Willkommen bei Arnold">
      <div>
        <h2 className="ac-title">Willkommen bei Arnold</h2>
        <p className="ac-sub">
          Dein Trainingsbegleiter im Chat: ein Plan, schnelle Satzeingabe und
          dein Fortschritt an einem Ort. Wie möchtest du starten?
        </p>
      </div>
      {!canWritePlan && (
        <CardNote>
          Hier kannst du die Einrichtung ansehen. Ein Plan kann in dieser
          Verbindung noch nicht gespeichert werden.
        </CardNote>
      )}
      <div className="ac-paths">
        <button
          type="button"
          className="ac-btn ac-path primary-path"
          disabled={disabled}
          aria-label="Plan mit Arnold erstellen"
          aria-describedby={`${ids}-arnold`}
          onClick={() => onChoose("arnold_plan")}
        >
          <span className="ac-path-icon">
            <Sparkles size={20} aria-hidden="true" />
          </span>
          <span className="ac-path-text">
            <strong>Plan mit Arnold erstellen</strong>
            <span id={`${ids}-arnold`}>
              4 kurze Fragen und deine Wünsche, etwa 2 Minuten
            </span>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ac-btn ac-path"
          disabled={disabled}
          aria-label="Eigenen Plan übernehmen"
          aria-describedby={`${ids}-own`}
          onClick={() => onChoose("own_plan")}
        >
          <span className="ac-path-icon muted">
            <FileText size={20} aria-hidden="true" />
          </span>
          <span className="ac-path-text">
            <strong>Eigenen Plan übernehmen</strong>
            <span id={`${ids}-own`}>Als Text oder Foto in den Chat</span>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

const ICON = 18;

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
  onCancel,
  onReload,
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
  onCancel?: () => void;
  onReload?: () => void;
  sessionKey?: string;
  suppressIssues?: boolean;
  onQuestion?: (title: string) => void;
}) {
  const [page, setPage] = useState<Page>(() => initialProfileQuestion(profile));
  const [fromReview, setFromReview] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const person = profile.person;
  const training = profile.training;

  // Local answers of the page on screen, seeded from what the server holds.
  const [personDraft, setPersonDraft] = useState<Person>(person);
  const [goals, setGoals] = useState<TrainingGoal[]>([]);
  const [experience, setExperience] = useState<string | undefined>();
  const [days, setDays] = useState<number | undefined>();
  const [minutesText, setMinutesText] = useState("");
  const [environment, setEnvironment] = useState<string | undefined>();
  const [wishes, setWishes] = useState({
    training_days: [] as string[],
    split: undefined as string | undefined,
    focus_muscle_groups: [] as string[],
    equipment: [] as string[],
    preferred_exercise_ids: [] as string[],
    avoided_exercise_ids: [] as string[],
    notes: "",
  });
  const [fold, setFold] = useState(-1);
  // Number fields whose text is outside the allowed range.
  const [invalidNumbers, setInvalidNumbers] = useState<string[]>([]);

  const TITLE: Record<Page, string> = {
    person: "Ein paar Angaben über dich?",
    goal: "Was ist dein Ziel?",
    experience: "Wie lange trainierst du schon?",
    rhythm: "Wie oft und wie lange?",
    environment: "Wo trainierst du?",
    wishes: "Deine Wünsche für den Plan",
    review: "So wird dein Plan",
  };

  useEffect(() => {
    onQuestion?.(TITLE[page]);
    setError("");
    setFold(page === "wishes" ? 0 : -1);
    setPersonDraft(person);
    setInvalidNumbers([]);
    setGoals(
      training.primary_goal
        ? [training.primary_goal, ...(training.secondary_goals ?? [])]
        : [],
    );
    setExperience(training.experience ?? undefined);
    setDays(training.days_per_week ?? undefined);
    setMinutesText(
      training.session_minutes !== null ? String(training.session_minutes) : "",
    );
    setEnvironment(training.environment ?? undefined);
    setWishes({
      training_days: training.training_days ?? [],
      split: training.split,
      focus_muscle_groups: training.focus_muscle_groups ?? [],
      equipment: training.equipment ?? [],
      preferred_exercise_ids: training.preferred_exercise_ids ?? [],
      avoided_exercise_ids: training.avoided_exercise_ids ?? [],
      notes: training.notes ?? "",
    });
    // Seeded once per page; later server updates must not overwrite typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const minutes = Number(minutesText.trim());
  const minutesOk =
    minutesText.trim() !== "" &&
    Number.isInteger(minutes) &&
    minutes >= SESSION_MINUTES_MIN &&
    minutes <= SESSION_MINUTES_MAX;

  const answered =
    page === "goal"
      ? goals.length > 0
      : page === "experience"
        ? !!experience
        : page === "rhythm"
          ? days !== undefined && minutesOk
          : page === "environment"
            ? !!environment
            : true;

  const after = (current: Page): Page => {
    if (fromReview) return "review";
    if (current === "person") return "goal";
    const index = QUESTIONS.indexOf(current);
    if (index >= 0 && index < QUESTIONS.length - 1) return QUESTIONS[index + 1];
    if (current === "environment") return "wishes";
    return "review";
  };
  const before = (current: Page): Page | null => {
    if (current === "person") return null;
    if (current === "goal") return "person";
    const index = QUESTIONS.indexOf(current);
    if (index > 0) return QUESTIONS[index - 1];
    if (current === "wishes") return "environment";
    if (current === "review") return "wishes";
    return null;
  };
  const go = (next: Page, edit = false) => {
    setFromReview(edit);
    setPage(next);
  };

  function patchFor(current: Page): OnboardingProfilePatch | null {
    switch (current) {
      case "person": {
        const p: Record<string, unknown> = {};
        for (const key of [
          "age_years",
          "height_cm",
          "body_weight_kg",
          "sex",
        ] as const)
          if (personDraft[key] !== person[key])
            p[key] = personDraft[key] ?? null;
        const areas = personDraft.protect_areas ?? [];
        if (areas.join() !== (person.protect_areas ?? []).join())
          p.protect_areas = areas;
        return Object.keys(p).length ? { person: p as Person } : null;
      }
      case "goal":
        return {
          training: { primary_goal: goals[0], secondary_goals: goals.slice(1) },
        };
      case "experience":
        return { training: { experience: experience as never } };
      case "rhythm":
        return { training: { days_per_week: days, session_minutes: minutes } };
      case "environment":
        return { training: { environment: environment as never } };
      case "wishes":
        return {
          training: {
            training_days: wishes.training_days as never,
            // "Arnold entscheidet" is the stored default for an empty choice.
            split: (wishes.split ?? "auto") as never,
            focus_muscle_groups: wishes.focus_muscle_groups as never,
            equipment: wishes.equipment as never,
            preferred_exercise_ids: wishes.preferred_exercise_ids as never,
            avoided_exercise_ids: wishes.avoided_exercise_ids as never,
            notes: wishes.notes.trim() ? wishes.notes.trim() : null,
          },
        };
      default:
        return null;
    }
  }

  async function next(skip = false) {
    if (guard.current || busy) return;
    if (!skip && !answered) {
      setError("Wähle eine Antwort aus.");
      return;
    }
    if (!skip && page === "person" && invalidNumbers.length) {
      setError("Prüf die markierten Zahlen oder lass das Feld leer.");
      return;
    }
    // Fixed weekdays set the number of training days; a partial pick would
    // silently change it.
    if (
      !skip &&
      page === "wishes" &&
      wishes.training_days.length > 0 &&
      training.days_per_week !== null &&
      wishes.training_days.length !== training.days_per_week
    ) {
      setError(
        `Wähle bei den festen Trainingstagen genau ${training.days_per_week} ${training.days_per_week === 1 ? "Tag" : "Tage"} oder keinen.`,
      );
      setFold(0);
      return;
    }
    guard.current = true;
    setError("");
    try {
      if (!skip) {
        const patch = patchFor(page);
        if (patch && !(await onSave(patch))) return;
      }
      go(after(page));
    } finally {
      guard.current = false;
    }
  }
  const back = () => {
    if (fromReview) return go("review");
    const previous = before(page);
    if (previous) go(previous);
    else onBack();
  };

  const menu = [
    ...(onReload
      ? [{ label: "Stand neu laden", onClick: onReload, disabled: busy }]
      : []),
    ...(onCancel
      ? [
          {
            label: "Einrichtung abbrechen",
            onClick: onCancel,
            danger: true,
            disabled: busy,
          },
        ]
      : []),
  ];
  const questionIndex = QUESTIONS.indexOf(page);
  const head = (
    <SetupHead
      label={
        page === "person"
          ? "Angaben"
          : questionIndex >= 0
            ? `Angaben · Frage ${questionIndex + 1} von ${QUESTIONS.length}`
            : page === "wishes"
              ? "Wünsche · freiwillig"
              : "Prüfen"
      }
      phase={page === "wishes" ? 1 : page === "review" ? 2 : 0}
      within={
        page === "person"
          ? 0.1
          : questionIndex >= 0
            ? (questionIndex + 1) / QUESTIONS.length
            : 0.6
      }
      onBack={back}
      menu={menu}
    />
  );

  // B19: the server's "missing" finding only while nothing is chosen locally
  // and no save is pending, so it never contradicts a visible selection.
  const pageField: Record<Page, string[]> = {
    person: [],
    goal: ["training.primary_goal"],
    experience: ["training.experience"],
    rhythm: ["training.days_per_week", "training.session_minutes"],
    environment: ["training.environment"],
    wishes: [],
    review: [],
  };
  const issue =
    busy || suppressIssues || answered
      ? undefined
      : validation.errors.find(
          (e) => e.field && pageField[page].includes(e.field),
        );

  const actions = (optional: boolean) => (
    <CardActions
      primary={{
        label: busy ? "Wird gespeichert …" : "Weiter",
        onClick: () => void next(),
        disabled: busy || (!optional && !answered),
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
  );
  const errorNote = (error || issue) && (
    <CardNote tone="error">{error || issue?.message}</CardNote>
  );

  /* ---------------------------------------------------------------- person */
  if (page === "person") {
    const set = (key: keyof Person, value: unknown) =>
      setPersonDraft((d) => {
        const nextDraft: Record<string, unknown> = { ...d, [key]: value };
        if (value === undefined) delete nextDraft[key];
        return nextDraft as Person;
      });
    const number =
      (key: "age_years" | "height_cm" | "body_weight_kg") =>
      (value: number | undefined, valid: boolean) => {
        setInvalidNumbers((current) =>
          valid
            ? current.filter((k) => k !== key)
            : [...new Set([...current, key])],
        );
        if (valid) set(key, value);
      };
    const areas = personDraft.protect_areas ?? [];
    return (
      <section
        className="ac"
        aria-label={TITLE.person}
        aria-busy={busy || undefined}
      >
        {head}
        <div>
          <h2 className="ac-title">{TITLE.person}</h2>
          <p className="ac-sub">
            Alles freiwillig. Hilft bei den Startgewichten.
          </p>
        </div>
        <div className="ac-mini-grid">
          <MiniNumber
            label="Alter"
            unit="Jahre"
            value={personDraft.age_years}
            min={14}
            max={100}
            onChange={number("age_years")}
            disabled={busy}
          />
          <MiniNumber
            label="Größe"
            unit="cm"
            value={personDraft.height_cm}
            min={120}
            max={230}
            onChange={number("height_cm")}
            disabled={busy}
          />
          <MiniNumber
            label="Gewicht"
            unit="kg"
            value={personDraft.body_weight_kg}
            min={30}
            max={300}
            decimals
            onChange={number("body_weight_kg")}
            disabled={busy}
          />
        </div>
        <p
          className={`ac-hint-line ${personDraft.body_weight_kg !== undefined ? "on" : ""}`}
        >
          <TrendingUp size={16} aria-hidden="true" />
          Dein Gewicht wird dein erster Eintrag bei den Zielen.
        </p>
        <div className="ac-folds">
          <Fold
            title="Geschlecht"
            value={
              personDraft.sex ? SEX_LABEL[personDraft.sex] : "Keine Angabe"
            }
            set={!!personDraft.sex}
            open={fold === 0}
            onToggle={() => setFold(fold === 0 ? -1 : 0)}
          >
            <OptionChips
              label="Geschlecht"
              options={SEXES.map((s) => ({ value: s, label: SEX_LABEL[s] }))}
              values={personDraft.sex ? [personDraft.sex] : []}
              onChange={(v) => set("sex", v[0])}
              single
              disabled={busy}
            />
          </Fold>
          <Fold
            title="Bereiche schonen"
            value={
              areas.length
                ? areas.map((a) => BODY_AREA_LABEL[a]).join(", ")
                : "Keine"
            }
            set={areas.length > 0}
            open={fold === 1}
            onToggle={() => setFold(fold === 1 ? -1 : 1)}
          >
            <OptionChips
              label="Bereiche schonen"
              options={BODY_AREAS.map((a) => ({
                value: a,
                label: BODY_AREA_LABEL[a],
              }))}
              values={areas}
              onChange={(v) => set("protect_areas", v)}
              disabled={busy}
            />
          </Fold>
        </div>
        {errorNote}
        {actions(true)}
      </section>
    );
  }

  /* ------------------------------------------------------------- questions */
  if (QUESTIONS.includes(page)) {
    let content: ReactNode = null;
    if (page === "goal")
      content = (
        <OptionTiles
          label={TITLE.goal}
          multiple
          options={TRAINING_GOALS.map((g) => ({
            value: g,
            label: GOAL_LABEL[g],
            hint: GOAL_HINT[g],
          }))}
          values={goals}
          onChange={(v) => setGoals(v as TrainingGoal[])}
          disabled={busy}
        />
      );
    else if (page === "experience")
      content = (
        <OptionTiles
          label={TITLE.experience}
          options={EXPERIENCE_LEVELS.map((e) => ({
            value: e,
            label: EXPERIENCE_LABEL[e],
            hint: EXPERIENCE_HINT[e],
          }))}
          values={experience ? [experience] : []}
          onChange={(v) => setExperience(v[0])}
          disabled={busy}
        />
      );
    else if (page === "environment")
      content = (
        <OptionTiles
          label={TITLE.environment}
          options={TRAINING_ENVIRONMENTS.map((e) => ({
            value: e,
            label: ENVIRONMENT_LABEL[e],
            hint: ENVIRONMENT_HINT[e],
          }))}
          values={environment ? [environment] : []}
          onChange={(v) => setEnvironment(v[0])}
          disabled={busy}
        />
      );
    else
      content = (
        <>
          <fieldset className="ac-field">
            <legend className="ac-field-label">Trainingstage pro Woche</legend>
            <div className="ac-day-count">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <label key={n} className={`ac-count ${days === n ? "on" : ""}`}>
                  <input
                    className="visually-hidden"
                    type="radio"
                    name="days_per_week"
                    checked={days === n}
                    disabled={busy}
                    onChange={() => setDays(n)}
                  />
                  {n}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="ac-minutes">
            <label htmlFor="session-minutes">
              Minuten pro Training, mit Pausen
            </label>
            <span>
              <input
                id="session-minutes"
                inputMode="numeric"
                value={minutesText}
                disabled={busy}
                aria-invalid={(minutesText !== "" && !minutesOk) || undefined}
                aria-describedby="session-minutes-hint"
                onChange={(event) =>
                  setMinutesText(event.target.value.replace(/[^0-9]/g, ""))
                }
              />
              <small>Min.</small>
            </span>
            <p
              id="session-minutes-hint"
              className={minutesText !== "" && !minutesOk ? "bad" : ""}
            >
              {minutesText !== "" && !minutesOk
                ? `Bitte eine Zahl zwischen ${SESSION_MINUTES_MIN} und ${SESSION_MINUTES_MAX}.`
                : "Arnold plant die Sätze so, dass es passt."}
            </p>
          </div>
        </>
      );
    return (
      <section
        className="ac"
        aria-label={TITLE[page]}
        aria-busy={busy || undefined}
      >
        {head}
        <div>
          <h2 className="ac-title">{TITLE[page]}</h2>
          <p className="ac-sub">
            {page === "goal"
              ? "Mehrere möglich. Das erste ist dein Hauptziel."
              : page === "experience"
                ? "Ehrlich ist besser, der Plan passt sich später an."
                : page === "rhythm"
                  ? "Feste Tage kannst du gleich bei den Wünschen festlegen."
                  : "Damit nur Übungen kommen, die du machen kannst."}
          </p>
        </div>
        {content}
        {errorNote}
        {actions(false)}
      </section>
    );
  }

  /* ---------------------------------------------------------------- wishes */
  if (page === "wishes") {
    const w = wishes;
    const update = (patch: Partial<typeof wishes>) =>
      setWishes((d) => ({ ...d, ...patch }));
    const names = (ids: string[]) =>
      ids
        .map(
          (id) =>
            exerciseChoices.find((e) => e.exercise_id === id)?.name_de ?? id,
        )
        .join(", ");
    const sections = [
      {
        icon: <Calendar size={ICON} />,
        title: "Feste Trainingstage",
        value: w.training_days.length
          ? `${w.training_days
              .map((d) =>
                WEEKDAY_LABEL[d as keyof typeof WEEKDAY_LABEL].slice(0, 2),
              )
              .join(", ")}${
              training.days_per_week &&
              w.training_days.length !== training.days_per_week
                ? ` · noch ${training.days_per_week - w.training_days.length}`
                : ""
            }`
          : "Flexibel",
        set: w.training_days.length > 0,
        body: (
          <>
            <p className="ac-text">
              {training.days_per_week
                ? `Wähle genau ${training.days_per_week} ${training.days_per_week === 1 ? "Tag" : "Tage"} oder keinen. Ohne feste Tage zählt nur, wie oft du trainierst.`
                : "Ohne feste Tage zählt nur, wie oft du trainierst."}
            </p>
            <OptionChips
              label="Feste Trainingstage"
              options={WEEKDAYS.map((d) => ({
                value: d,
                label: WEEKDAY_LABEL[d].slice(0, 2),
              }))}
              values={w.training_days}
              onChange={(v) => update({ training_days: v })}
              max={training.days_per_week ?? 7}
              grid
              disabled={busy}
            />
          </>
        ),
      },
      {
        icon: <LayoutGrid size={ICON} />,
        title: "Aufteilung",
        value:
          w.split && w.split !== "auto"
            ? SPLIT_LABEL[w.split as keyof typeof SPLIT_LABEL]
            : "Arnold entscheidet",
        set: !!w.split && w.split !== "auto",
        body: (
          <OptionChips
            label="Aufteilung"
            options={splitOptions.map((s) => ({
              value: s,
              label: SPLIT_LABEL[s],
            }))}
            values={w.split ? [w.split] : []}
            onChange={(v) => update({ split: v[0] })}
            single
            disabled={busy}
          />
        ),
      },
      {
        icon: <Crosshair size={ICON} />,
        title: "Schwerpunkt",
        value: w.focus_muscle_groups.length
          ? w.focus_muscle_groups
              .map(
                (m) => MUSCLE_GROUP_LABEL[m as keyof typeof MUSCLE_GROUP_LABEL],
              )
              .join(", ")
          : "Ausgewogen",
        set: w.focus_muscle_groups.length > 0,
        body: (
          <>
            <p className="ac-text">Bis zu drei Muskelgruppen.</p>
            <OptionChips
              label="Schwerpunkt"
              options={MUSCLE_GROUPS.map((m) => ({
                value: m,
                label: MUSCLE_GROUP_LABEL[m],
              }))}
              values={w.focus_muscle_groups}
              onChange={(v) => update({ focus_muscle_groups: v })}
              max={3}
              disabled={busy}
            />
          </>
        ),
      },
      {
        icon: <Dumbbell size={ICON} />,
        title: "Geräte",
        value: w.equipment.length
          ? w.equipment
              .map((e) => EQUIPMENT_LABEL[e as keyof typeof EQUIPMENT_LABEL])
              .join(", ")
          : "Was dein Trainingsort hat",
        set: w.equipment.length > 0,
        body: (
          <OptionChips
            label="Geräte"
            options={EQUIPMENT.map((e) => ({
              value: e,
              label: EQUIPMENT_LABEL[e],
            }))}
            values={w.equipment}
            onChange={(v) => update({ equipment: v })}
            disabled={busy}
          />
        ),
      },
      {
        icon: <Heart size={ICON} />,
        title: "Lieblingsübungen",
        value: w.preferred_exercise_ids.length
          ? names(w.preferred_exercise_ids)
          : "Keine Vorgabe",
        set: w.preferred_exercise_ids.length > 0,
        body: (
          <OptionChips
            label="Lieblingsübungen"
            options={exerciseChoices.map((e) => ({
              value: e.exercise_id,
              label: e.name_de,
            }))}
            values={w.preferred_exercise_ids}
            onChange={(v) =>
              update({
                preferred_exercise_ids: v,
                avoided_exercise_ids: w.avoided_exercise_ids.filter(
                  (id) => !v.includes(id),
                ),
              })
            }
            disabled={busy}
          />
        ),
      },
      {
        icon: <Ban size={ICON} />,
        title: "Übungen vermeiden",
        value: w.avoided_exercise_ids.length
          ? names(w.avoided_exercise_ids)
          : "Keine",
        set: w.avoided_exercise_ids.length > 0,
        body: (
          <OptionChips
            label="Übungen vermeiden"
            options={exerciseChoices.map((e) => ({
              value: e.exercise_id,
              label: e.name_de,
            }))}
            values={w.avoided_exercise_ids}
            onChange={(v) =>
              update({
                avoided_exercise_ids: v,
                preferred_exercise_ids: w.preferred_exercise_ids.filter(
                  (id) => !v.includes(id),
                ),
              })
            }
            disabled={busy}
          />
        ),
      },
      {
        icon: <MessageSquare size={ICON} />,
        title: "Sonst noch etwas?",
        value: w.notes.trim() ? w.notes.trim() : "In deinen Worten",
        set: !!w.notes.trim(),
        body: (
          <>
            <label className="visually-hidden" htmlFor="setup-notes">
              Sonst noch etwas für deinen Plan
            </label>
            <textarea
              id="setup-notes"
              className="ac-textarea"
              maxLength={600}
              value={w.notes}
              disabled={busy}
              placeholder="z. B. Ich will Klimmzüge lernen und mein Rücken soll stärker werden."
              onChange={(event) => update({ notes: event.target.value })}
            />
          </>
        ),
      },
    ];
    return (
      <section
        className="ac"
        aria-label={TITLE.wishes}
        aria-busy={busy || undefined}
      >
        {head}
        <div>
          <h2 className="ac-title">{TITLE.wishes}</h2>
          <p className="ac-sub">
            Je mehr du angibst, desto mehr passt der Plan zu dir. Was offen
            bleibt, entscheidet Arnold.
          </p>
        </div>
        <div className="ac-folds">
          {sections.map((s, i) => (
            <Fold
              key={s.title}
              icon={s.icon}
              title={s.title}
              value={s.value}
              set={s.set}
              open={fold === i}
              onToggle={() => setFold(fold === i ? -1 : i)}
            >
              {s.body}
            </Fold>
          ))}
        </div>
        {errorNote}
        {actions(true)}
      </section>
    );
  }

  /* ---------------------------------------------------------------- review */
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
              onClick={() => go(r.edit, true)}
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

/** Tappable chips that behave like checkboxes or, with `single`, radios. */
function OptionChips({
  label,
  options,
  values,
  onChange,
  single,
  max = Infinity,
  grid,
  disabled,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  values: readonly string[];
  onChange: (values: string[]) => void;
  single?: boolean;
  max?: number;
  grid?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`ac-chips ${grid ? "grid7" : ""}`}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const on = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className="ac-chip"
            aria-pressed={on}
            disabled={disabled || (!on && !single && values.length >= max)}
            onClick={() =>
              onChange(
                single
                  ? on
                    ? []
                    : [option.value]
                  : on
                    ? values.filter((v) => v !== option.value)
                    : [...values, option.value],
              )
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
