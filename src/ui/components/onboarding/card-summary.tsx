import type { ReactNode } from "react";
import { Check } from "lucide-react";
import {
  ENVIRONMENT_LABEL,
  EXPERIENCE_LABEL,
  GOAL_LABEL,
  PATH_LABEL,
  WEEKDAY_LABEL,
  modulesOf,
  type OnboardingModules,
  type OnboardingProfile,
  type RequiredProfileField,
} from "../../../shared/onboarding-contract";
import { formatNumber } from "../../format";

/**
 * Words for the onboarding cards. Everything here only formats what the server
 * stored; nothing is computed, and a value that is not stored stays unknown.
 */

const RUN_PLACE: Record<string, string> = {
  outdoor: "Draußen",
  treadmill: "Laufband",
  track: "Bahn",
};

/** "31 Jahre, 182 cm, 78,5 kg" – only what is known; undefined if nothing. */
export function personLine(person: OnboardingProfile["person"]) {
  const parts = [
    person.age_years !== undefined ? `${person.age_years} Jahre` : undefined,
    person.height_cm !== undefined
      ? `${formatNumber(person.height_cm, 0)} cm`
      : undefined,
    person.body_weight_kg !== undefined
      ? `${formatNumber(person.body_weight_kg, 1)} kg`
      : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length ? parts.join(", ") : undefined;
}

/** "Krafttraining, Laufen, Mobility mit Morgenroutine". */
export function modulesLine(modules: OnboardingModules) {
  return [
    "Krafttraining",
    modules.running ? "Laufen" : undefined,
    modules.mobility
      ? modules.morning_routine
        ? "Mobility mit Morgenroutine"
        : "Mobility"
      : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

/** A done line with a check mark: one thing the card already knows. */
export function SummaryLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <p className="cc-line ok oc-summary">
      <Check size={15} aria-hidden="true" />
      <span>
        <strong>{label}:</strong> {children}
      </span>
    </p>
  );
}

/** The stored answer behind one required field, in words; undefined if none. */
export function fieldValue(
  field: RequiredProfileField,
  profile: OnboardingProfile,
): string | undefined {
  const { training } = profile;
  switch (field) {
    case "path":
      return profile.path ? PATH_LABEL[profile.path] : undefined;
    case "training.primary_goal":
      return training.primary_goal
        ? GOAL_LABEL[training.primary_goal]
        : undefined;
    case "training.experience":
      return training.experience
        ? EXPERIENCE_LABEL[training.experience]
        : undefined;
    case "training.days_per_week":
      return training.days_per_week !== null
        ? `${training.days_per_week} pro Woche`
        : undefined;
    case "training.session_minutes":
      return training.session_minutes !== null
        ? `${training.session_minutes} Minuten`
        : undefined;
    case "training.environment":
      return training.environment
        ? ENVIRONMENT_LABEL[training.environment]
        : undefined;
    case "training.run.aims":
    case "training.run.background":
      return training.run?.runs_per_week !== undefined
        ? `${training.run.runs_per_week} pro Woche`
        : training.run
          ? "Angegeben"
          : undefined;
    case "training.job":
      return training.job ? "Angegeben" : undefined;
    case "training.mobility.stiff_areas":
      return training.mobility?.wants
        ? training.mobility.stiff_areas.length
          ? `${training.mobility.stiff_areas.length} Bereiche`
          : "Keine"
        : undefined;
    case "training.mobility.sessions":
      return training.mobility?.wants && training.mobility.sessions
        ? `${training.mobility.sessions.per_week} pro Woche`
        : undefined;
    case "training.mobility.morning.minutes":
      return training.mobility?.wants && training.mobility.morning
        ? `${training.mobility.morning.minutes} Minuten`
        : undefined;
    case "training.mobility.morning.weekdays":
      return training.mobility?.wants && training.mobility.morning
        ? training.mobility.morning.weekdays
            .map((day) => WEEKDAY_LABEL[day])
            .join(", ")
        : undefined;
    case "training.has_mat":
      return training.has_mat === undefined
        ? undefined
        : training.has_mat
          ? "Ja"
          : "Nein";
  }
}

export { modulesOf };
