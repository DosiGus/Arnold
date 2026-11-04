import { useEffect, useRef, useState } from "react";
import type {
  OnboardingProfile,
  OnboardingProfilePatch,
  OnboardingProgress,
  OnboardingValidationResult,
  Person,
  TrainingGoal,
} from "../../../shared/onboarding-contract";
import {
  SPLIT_LABEL,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
} from "../../../shared/onboarding-contract";
import { CardActions, CardNote } from "../cards";
import {
  PAGE_FIELD,
  QUESTIONS,
  TITLE,
  initialProfileQuestion,
  nextPage,
  previousPage,
  type Page,
  type WishesDraft,
} from "./pages";
import { SetupHead } from "./setup-head";
import { renderPersonPage } from "./person-page";
import { renderQuestionPage } from "./question-page";
import { renderWishesPage } from "./wishes-page";
import { renderReviewPage } from "./review-page";

/**
 * The setup as one guided card: a few people facts (optional), four
 * questions, the user's wishes, then a review in plain words.
 *
 * Every page saves its answers as one patch through `onSave`, which buffers
 * and retries on its own; the card moves on immediately.
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
  const [wishes, setWishes] = useState<WishesDraft>({
    training_days: [],
    split: undefined,
    focus_muscle_groups: [],
    equipment: [],
    preferred_exercise_ids: [],
    avoided_exercise_ids: [],
    notes: "",
  });
  const [fold, setFold] = useState(-1);
  // Number fields whose text is outside the allowed range.
  const [invalidNumbers, setInvalidNumbers] = useState<string[]>([]);

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
      go(nextPage(page, fromReview));
    } finally {
      guard.current = false;
    }
  }
  const back = () => {
    if (fromReview) return go("review");
    const previous = previousPage(page);
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
  const issue =
    busy || suppressIssues || answered
      ? undefined
      : validation.errors.find(
          (e) => e.field && PAGE_FIELD[page].includes(e.field),
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

  if (page === "person")
    return renderPersonPage({
      head,
      errorNote,
      actions: actions(true),
      busy,
      personDraft,
      setPersonDraft,
      fold,
      setFold,
      setInvalidNumbers,
    });

  if (QUESTIONS.includes(page))
    return renderQuestionPage({
      head,
      errorNote,
      actions: actions(false),
      busy,
      page,
      goals,
      setGoals,
      experience,
      setExperience,
      days,
      setDays,
      minutesText,
      setMinutesText,
      minutesOk,
      environment,
      setEnvironment,
    });

  if (page === "wishes")
    return renderWishesPage({
      head,
      errorNote,
      actions: actions(true),
      busy,
      wishes,
      setWishes,
      training,
      exerciseChoices,
      splitOptions,
      fold,
      setFold,
    });

  return renderReviewPage({
    head,
    busy,
    person,
    training,
    exerciseChoices,
    progress,
    canWritePlan,
    onRequestPlan,
    onEdit: (edit) => go(edit, true),
  });
}
