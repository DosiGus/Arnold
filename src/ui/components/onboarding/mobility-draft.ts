import type { MobilityArea } from "../../../shared/mobility-catalog";
import { MOBILITY_AREAS } from "../../../shared/mobility-catalog";
import {
  MOBILITY_DEFAULTS,
  type MobilityPlacement,
  type MobilityPreference,
} from "../../../shared/mobility-contract";
import { WEEKDAYS, type Weekday } from "../../../shared/weekdays";

/** What the person wants: a morning routine, sessions, both or neither. */
export type MobilityChoice = "morning" | "sessions" | "both" | "none";

/** The local answers of the mobility page. */
export type MobilityDraft = {
  choice: MobilityChoice | undefined;
  weekdays: Weekday[];
  morningMinutes: 5 | 10 | 15;
  placement: MobilityPlacement;
  /** Kept from a stored answer; the page does not ask for them. */
  sessionsPerWeek: number;
  sessionsMinutes: 15 | 20 | 30;
  areas: MobilityArea[];
};

export const MOBILITY_DRAFT_DEFAULT: MobilityDraft = {
  choice: undefined,
  weekdays: [...MOBILITY_DEFAULTS.morning.weekdays],
  morningMinutes: MOBILITY_DEFAULTS.morning.minutes,
  placement: "arnold_decides",
  sessionsPerWeek: MOBILITY_DEFAULTS.sessions.per_week,
  sessionsMinutes: MOBILITY_DEFAULTS.sessions.minutes,
  areas: [],
};

export const CHOICE_OPTIONS = [
  { value: "morning", label: "Morgenroutine" },
  { value: "sessions", label: "Mobility-Einheiten" },
  { value: "both", label: "Beides" },
  { value: "none", label: "Nein danke" },
] as const satisfies readonly { value: MobilityChoice; label: string }[];

export const MORNING_MINUTES = [
  { value: "5", label: "5 Min." },
  { value: "10", label: "10 Min." },
  { value: "15", label: "15 Min." },
] as const;

export const PLACEMENT_LABEL: Record<MobilityPlacement, string> = {
  own_days: "Eigene Tage",
  after_strength: "Nach dem Krafttraining",
  arnold_decides: "Arnold entscheidet",
};

export const PLACEMENT_OPTIONS = (
  ["own_days", "after_strength", "arnold_decides"] as const
).map((value) => ({ value, label: PLACEMENT_LABEL[value] }));

/** "Steif" is a feeling, not pain: the labels name body areas only. */
export const AREA_LABEL: Record<MobilityArea, string> = {
  neck: "Nacken",
  shoulders: "Schultern",
  upper_back: "Oberer Rücken",
  lower_back: "Unterer Rücken",
  hips: "Hüfte",
  hamstrings: "Beinrückseite",
  calves_ankles: "Waden/Sprunggelenke",
  wrists: "Handgelenke",
};

export const AREA_OPTIONS = MOBILITY_AREAS.map((value) => ({
  value,
  label: AREA_LABEL[value],
}));

export const WEEKDAY_OPTIONS: readonly { value: Weekday; label: string }[] = [
  { value: "mon", label: "Mo" },
  { value: "tue", label: "Di" },
  { value: "wed", label: "Mi" },
  { value: "thu", label: "Do" },
  { value: "fri", label: "Fr" },
  { value: "sat", label: "Sa" },
  { value: "sun", label: "So" },
];

export const wantsMorning = (choice: MobilityChoice | undefined) =>
  choice === "morning" || choice === "both";
export const wantsSessions = (choice: MobilityChoice | undefined) =>
  choice === "sessions" || choice === "both";

/** Seeds the page from the stored answer; nothing stored means the defaults. */
export function draftFromMobility(
  stored: MobilityPreference | undefined,
): MobilityDraft {
  if (!stored) return MOBILITY_DRAFT_DEFAULT;
  if (!stored.wants) return { ...MOBILITY_DRAFT_DEFAULT, choice: "none" };
  return {
    choice:
      stored.morning && stored.sessions
        ? "both"
        : stored.morning
          ? "morning"
          : "sessions",
    weekdays: stored.morning
      ? [...stored.morning.weekdays]
      : MOBILITY_DRAFT_DEFAULT.weekdays,
    morningMinutes:
      stored.morning?.minutes ?? MOBILITY_DRAFT_DEFAULT.morningMinutes,
    placement: stored.sessions?.placement ?? MOBILITY_DRAFT_DEFAULT.placement,
    sessionsPerWeek:
      stored.sessions?.per_week ?? MOBILITY_DRAFT_DEFAULT.sessionsPerWeek,
    sessionsMinutes:
      stored.sessions?.minutes ?? MOBILITY_DRAFT_DEFAULT.sessionsMinutes,
    areas: [...stored.stiff_areas],
  };
}

/**
 * The answer in the contract format, or undefined while nothing is chosen
 * (or a morning routine has no day). Only maps what was picked.
 */
export function mobilityFromDraft(
  draft: MobilityDraft,
): MobilityPreference | undefined {
  if (draft.choice === undefined) return undefined;
  if (draft.choice === "none") return { wants: false };
  const morning = wantsMorning(draft.choice);
  if (morning && draft.weekdays.length === 0) return undefined;
  return {
    wants: true,
    morning: morning
      ? {
          // Calendar order, however the days were tapped.
          weekdays: WEEKDAYS.filter((day) => draft.weekdays.includes(day)),
          minutes: draft.morningMinutes,
        }
      : null,
    sessions: wantsSessions(draft.choice)
      ? {
          placement: draft.placement,
          per_week: draft.sessionsPerWeek,
          minutes: draft.sessionsMinutes,
        }
      : null,
    stiff_areas: MOBILITY_AREAS.filter((area) => draft.areas.includes(area)),
  };
}
