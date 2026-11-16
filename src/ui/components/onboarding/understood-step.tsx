import { PencilLine } from "lucide-react";
import type {
  OnboardingProfile,
  OnboardingProgress,
} from "../../../shared/onboarding-contract";
import {
  ENVIRONMENT_LABEL,
  EXPERIENCE_LABEL,
  GOAL_LABEL,
  WEEKDAY_LABEL,
} from "../../../shared/onboarding-contract";
import { runSetupState } from "../../../shared/onboarding-profile";
import { ArnoldCard, CardActions } from "../cards";
import {
  CardTag,
  SayHint,
  UnderstoodRows,
  type UnderstoodItem,
} from "../conversation-cards";
import type { Page } from "./pages";
import { SetupHead } from "./setup-head";

/**
 * Whether the card "Das habe ich verstanden" replaces the welcome: the Arnold
 * path is chosen and at least one answer is stored (typically told in the
 * chat). Nothing is computed here beyond "is anything stored".
 */
export function hasUnderstood(profile: OnboardingProfile): boolean {
  const t = profile.training;
  return (
    profile.path === "arnold_plan" &&
    (t.primary_goal !== null ||
      t.experience !== null ||
      t.days_per_week !== null ||
      t.session_minutes !== null ||
      t.environment !== null)
  );
}

/**
 * The rows of the card. Which of them are gaps is decided by the server
 * (`progress.missing_fields`); this only maps stored values to labels.
 */
export function understoodRows(
  profile: OnboardingProfile,
  missing: readonly string[],
  open: (page: Page) => void,
): UnderstoodItem[] {
  const t = profile.training;
  const gap = (...fields: string[]) =>
    fields.some((field) => missing.includes(`training.${field}`));
  const goals = t.primary_goal
    ? [t.primary_goal, ...(t.secondary_goals ?? [])]
        .map((goal) => GOAL_LABEL[goal])
        .join(", ")
    : undefined;
  const scope =
    t.days_per_week !== null && t.session_minutes !== null
      ? `${t.days_per_week} ${t.days_per_week === 1 ? "Tag" : "Tage"} · ${t.session_minutes} Min.`
      : undefined;
  const place = t.environment
    ? [
        ENVIRONMENT_LABEL[t.environment],
        ...((t.equipment ?? []).length ? ["eigene Geräte"] : []),
      ].join(", ")
    : undefined;
  const rows: UnderstoodItem[] = [
    {
      key: "goal",
      label: "Ziele",
      value: gap("primary_goal") ? undefined : goals,
      onSelect: () => open("goal"),
    },
    {
      key: "experience",
      label: "Erfahrung",
      value: gap("experience")
        ? undefined
        : t.experience
          ? EXPERIENCE_LABEL[t.experience]
          : undefined,
      onSelect: () => open("experience"),
    },
    {
      key: "scope",
      label: "Umfang",
      value: gap("days_per_week", "session_minutes") ? undefined : scope,
      onSelect: () => open("rhythm"),
    },
    {
      key: "place",
      label: "Ort und Geräte",
      value: gap("environment") ? undefined : place,
      onSelect: () => open("environment"),
    },
    {
      // Optional: no gap, only "frei", so Arnold never asks for it.
      key: "days",
      label: "Wunschtage",
      value: t.training_days?.length
        ? t.training_days.map((day) => WEEKDAY_LABEL[day]).join(" ")
        : "frei wählbar",
      onSelect: () => open("wishes"),
    },
  ];
  if (runSetupState(t).required)
    rows.push({
      key: "run",
      label: "Laufen",
      value: t.run ? "angegeben" : undefined,
      onSelect: () => open("run"),
    });
  return rows;
}

export function UnderstoodStep({
  profile,
  progress,
  canWritePlan,
  busy,
  menu,
  onOpen,
  onForm,
  onRequestPlan,
}: {
  profile: OnboardingProfile;
  progress: OnboardingProgress;
  canWritePlan: boolean;
  busy: boolean;
  menu: React.ComponentProps<typeof SetupHead>["menu"];
  onOpen: (page: Page) => void;
  onForm: () => void;
  onRequestPlan: () => void;
}) {
  const rows = understoodRows(profile, progress.missing_fields, onOpen);
  const gaps = rows.filter(
    (row) => row.value === undefined || row.value === null,
  ).length;
  const ready = gaps === 0 && progress.can_request_plan && canWritePlan;
  return (
    <ArnoldCard
      label={<SetupHead label="Angaben" phase={0} within={0.6} menu={menu} />}
      title="Das habe ich verstanden"
      subtitle={
        gaps === 0
          ? "Stimmt das so? Dann baut Arnold deinen Plan."
          : `${gaps === 1 ? "Eine Angabe fehlt" : `${gaps} Angaben fehlen`} noch. Erzähl es mir im Chat oder tipp auf die Zeile.`
      }
    >
      <CardTag icon={<PencilLine size={13} />}>Aus deinem Gespräch</CardTag>
      <UnderstoodRows items={rows} />
      {gaps > 0 && (
        <SayHint>Ich trainiere dreimal pro Woche, 60 Minuten</SayHint>
      )}
      <CardActions
        primary={
          ready
            ? {
                label: "Plan erstellen",
                disabled: busy,
                onClick: onRequestPlan,
              }
            : {
                label: "Formular öffnen",
                disabled: busy,
                onClick: onForm,
              }
        }
        secondary={
          ready
            ? { label: "Formular öffnen", disabled: busy, onClick: onForm }
            : undefined
        }
      />
    </ArnoldCard>
  );
}
