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
import { AREA_LABEL, PLACEMENT_LABEL, WEEKDAY_OPTIONS } from "./mobility-draft";
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
      t.environment !== null ||
      t.mobility !== undefined)
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
  openQuestions: readonly string[] = [],
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
  rows.push(...mobilityRows(t.mobility, openQuestions, open));
  return rows;
}

/** "Jeden Tag · 10 Min." or "Mo, Mi, Fr · 5 Min."; stored values only. */
function morningText(
  morning: { weekdays: readonly string[]; minutes: number } | null,
): string {
  if (!morning) return "keine";
  const days =
    morning.weekdays.length === 7
      ? "Jeden Tag"
      : WEEKDAY_OPTIONS.filter((day) => morning.weekdays.includes(day.value))
          .map((day) => day.label)
          .join(", ");
  return `${days} · ${morning.minutes} Min.`;
}

/**
 * The mobility rows. They show "fehlt noch" only when the server lists the
 * question as open (`open_questions`); mobility never blocks the plan, so
 * these rows are not counted as gaps for it (see `isMobilityRow`).
 */
function mobilityRows(
  mobility: OnboardingProfile["training"]["mobility"],
  openQuestions: readonly string[],
  open: (page: Page) => void,
): UnderstoodItem[] {
  const select = () => open("mobility");
  if (mobility === undefined)
    return openQuestions.includes("mobility")
      ? [
          {
            key: "mobility",
            label: "Mobility",
            value: undefined,
            onSelect: select,
          },
        ]
      : [];
  if (!mobility.wants)
    return [
      {
        key: "mobility",
        label: "Mobility",
        value: "nicht gewünscht",
        onSelect: select,
      },
    ];
  const rows: UnderstoodItem[] = [
    {
      key: "morning",
      label: "Morgenroutine",
      value: morningText(mobility.morning),
      onSelect: select,
    },
    {
      key: "mobility",
      label: "Mobility",
      value: mobility.sessions
        ? `${PLACEMENT_LABEL[mobility.sessions.placement]} · ${mobility.sessions.per_week}× pro Woche · ${mobility.sessions.minutes} Min.`
        : "keine Einheiten",
      onSelect: select,
    },
  ];
  if (mobility.stiff_areas.length > 0)
    rows.push({
      key: "stiff",
      label: "Steif",
      value: mobility.stiff_areas.map((area) => AREA_LABEL[area]).join(", "),
      onSelect: select,
    });
  else if (openQuestions.includes("mobility_details"))
    rows.push({
      key: "stiff",
      label: "Steif",
      value: undefined,
      onSelect: select,
    });
  return rows;
}

/** Rows of the optional mobility answer; a gap there never blocks a plan. */
const isMobilityRow = (row: UnderstoodItem) =>
  row.key === "morning" || row.key === "mobility" || row.key === "stiff";

/** One example sentence per row: what to say to fill exactly that gap. */
const SAY_EXAMPLE: Record<string, string> = {
  goal: "Ich möchte Muskeln aufbauen",
  experience: "Ich trainiere seit etwa einem Jahr",
  scope: "Ich trainiere dreimal pro Woche, 60 Minuten",
  place: "Ich trainiere im Fitnessstudio",
  run: "Ich laufe zweimal pro Woche, ungefähr 5 Kilometer",
  mobility: "Morgens 10 Minuten, meine Hüfte ist steif.",
  stiff: "Meine Hüfte und der untere Rücken sind morgens steif.",
};

/**
 * The example sentence for the first row that is still a gap, in asking
 * order. Which rows are gaps comes from the server; nothing is guessed here.
 */
export function sayExample(items: readonly UnderstoodItem[]): string | null {
  const gap = items.find(
    (row) => row.value === undefined || row.value === null,
  );
  return gap ? (SAY_EXAMPLE[gap.key] ?? null) : null;
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
  openQuestions = [],
}: {
  profile: OnboardingProfile;
  progress: OnboardingProgress;
  canWritePlan: boolean;
  busy: boolean;
  menu: React.ComponentProps<typeof SetupHead>["menu"];
  onOpen: (page: Page) => void;
  onForm: () => void;
  onRequestPlan: () => void;
  /** Ids of the open questions the server lists (`state.open_questions`). */
  openQuestions?: readonly string[];
}) {
  const rows = understoodRows(
    profile,
    progress.missing_fields,
    onOpen,
    openQuestions,
  );
  // Only the required rows count: a missing mobility answer is shown, not asked for.
  const gaps = rows.filter(
    (row) =>
      !isMobilityRow(row) && (row.value === undefined || row.value === null),
  ).length;
  const example = sayExample(rows);
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
      {example && <SayHint>{example}</SayHint>}
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
