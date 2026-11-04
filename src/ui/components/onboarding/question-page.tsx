import type { ReactNode } from "react";
import type { TrainingGoal } from "../../../shared/onboarding-contract";
import {
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
import type { PageFrame } from "./page-frame";
import { TITLE, type Page } from "./pages";

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
      {actions}
    </section>
  );
}
