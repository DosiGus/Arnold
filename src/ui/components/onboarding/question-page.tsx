import type { ReactNode } from "react";
import type { TrainingGoal } from "../../../shared/onboarding-contract";
import {
  DAYS_PER_WEEK_MAX,
  DAYS_PER_WEEK_MIN,
  ENVIRONMENT_HINT,
  ENVIRONMENT_LABEL,
  EXPERIENCE_HINT,
  EXPERIENCE_LABEL,
  EXPERIENCE_LEVELS,
  GOAL_HINT,
  GOAL_LABEL,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
  TRAINING_ENVIRONMENTS,
  TRAINING_GOALS,
} from "../../../shared/onboarding-contract";
import { OptionTiles } from "./controls";
import { PlusMinusRow } from "../plus-minus-row";
import type { PageFrame } from "./page-frame";
import { MINUTES_STEP, RHYTHM_DEFAULT, TITLE, type Page } from "./pages";

/** One of the four questions: goal, experience, rhythm or environment. */
export function renderQuestionPage({
  head,
  errorNote,
  actions,
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
}: PageFrame & {
  page: Page;
  goals: TrainingGoal[];
  setGoals: (goals: TrainingGoal[]) => void;
  experience: string | undefined;
  setExperience: (experience: string | undefined) => void;
  days: number | undefined;
  setDays: (days: number | undefined) => void;
  minutesText: string;
  setMinutesText: (text: string) => void;
  minutesOk: boolean;
  environment: string | undefined;
  setEnvironment: (environment: string | undefined) => void;
}) {
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
  else {
    // Two plus/minus rows; the page starts on 3 days and 60 minutes.
    const shownDays = days ?? RHYTHM_DEFAULT.days;
    const shownMinutes = minutesOk
      ? Number(minutesText)
      : RHYTHM_DEFAULT.minutes;
    const stepMinutes = (delta: number) =>
      setMinutesText(
        String(
          Math.min(
            SESSION_MINUTES_MAX,
            Math.max(SESSION_MINUTES_MIN, shownMinutes + delta),
          ),
        ),
      );
    content = (
      <div className="ac-rhythm">
        <PlusMinusRow
          label="Tage pro Woche"
          disabled={busy}
          minusDisabled={shownDays <= DAYS_PER_WEEK_MIN}
          plusDisabled={shownDays >= DAYS_PER_WEEK_MAX}
          onMinus={() => setDays(shownDays - 1)}
          onPlus={() => setDays(shownDays + 1)}
        >
          <output className="ac-day-count" aria-live="polite">
            {shownDays}
          </output>
        </PlusMinusRow>
        <PlusMinusRow
          label="Minuten pro Training"
          disabled={busy}
          minusDisabled={shownMinutes <= SESSION_MINUTES_MIN}
          plusDisabled={shownMinutes >= SESSION_MINUTES_MAX}
          onMinus={() => stepMinutes(-MINUTES_STEP)}
          onPlus={() => stepMinutes(MINUTES_STEP)}
        >
          <output className="ac-day-count" aria-live="polite">
            {shownMinutes} Min.
          </output>
        </PlusMinusRow>
        <p className="ac-rhythm-hint">
          Mit Pausen. Arnold plant die Sätze so, dass es passt.
        </p>
      </div>
    );
  }
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
      {actions}
    </section>
  );
}
