/**
 * `get_mobility_overview` → the three mobility cards, and the setup answers in
 * the contract format. Minutes, seconds and counts come from the server; an
 * unknown value stays unknown.
 */
import { formatShortDay, UNKNOWN } from "../../shared/arnold-format.js";
import {
  MOBILITY_AREAS,
  MOBILITY_CATALOG,
  type MobilityArea,
} from "../../shared/mobility-catalog.js";
import {
  MOBILITY_DEFAULTS,
  type MobilityKind,
  type MobilityOverview,
  type MobilityPlacement,
  type MobilityPreference,
} from "../../shared/mobility-contract.js";
import { WEEKDAYS, type Weekday } from "../../shared/weekdays.js";

export const KIND_LABEL: Record<MobilityKind, string> = {
  morning: "Morgenroutine",
  session: "Mobility-Einheit",
};

const NAMES = new Map<string, string>(
  MOBILITY_CATALOG.map((e) => [e.id, e.name_de]),
);

export function mobilityTodayModel(overview: MobilityOverview) {
  return {
    date: formatShortDay(overview.today.date_local),
    empty:
      overview.profile.state === "yes"
        ? "In deinem Plan ist für heute nichts geplant."
        : overview.profile.state === "no"
          ? "Du hast bisher Nein gesagt. Das kannst du jederzeit ändern."
          : "Du hast noch nicht gesagt, ob Mobility dazukommen soll.",
    items: overview.today.items.map((item) => ({
      id: item.session_id,
      kind: item.kind,
      name: item.session_name,
      meta: `${KIND_LABEL[item.kind]} · ${item.minutes} Min.`,
      done: item.done,
      exercises: item.template.items.map((ex, i) => ({
        key: `${ex.exercise_id}-${i}`,
        label: NAMES.get(ex.exercise_id) ?? UNKNOWN,
        value: `${ex.sides === 2 ? "2 Seiten" : "1 Seite"} · ${
          ex.reps === null ? `${ex.seconds_per_side} s` : `${ex.reps} Wdh.`
        }`,
      })),
    })),
  };
}

/** One routine done today; no minutes: only the user may name them. */
export const logMobilityInput = (
  item: { id: string; kind: MobilityKind },
  timezone: string,
  requestId: string,
  confirmDuplicate = false,
) => ({
  request_id: requestId,
  kind: item.kind,
  session_id: item.id,
  timezone,
  ...(confirmDuplicate ? { confirm_duplicate: true } : {}),
});

/** "Dranbleiben" from the server's counts; without a plan it says so. */
export function adherenceText(a: MobilityOverview["adherence"]): string {
  if (a.ratio === null) return "Dranbleiben: noch kein Plan.";
  const streak =
    a.streak_days > 0
      ? `, ${a.streak_days} ${a.streak_days === 1 ? "Tag" : "Tage"} in Folge`
      : "";
  return `Dranbleiben: ${a.done_count} von ${a.planned_count} Routinen in ${a.days} Tagen${streak}.`;
}

/** The chosen routine, otherwise the latest; null when there is none. */
export function mobilityResultModel(
  overview: MobilityOverview,
  workoutId: string | null,
) {
  const r = workoutId
    ? overview.recent.find((x) => x.workout_id === workoutId)
    : overview.recent[0];
  if (!r) return null;
  return {
    name: r.session_name ?? KIND_LABEL[r.kind],
    date: formatShortDay(r.date_local),
    rows: [
      { key: "kind", label: "Art", value: KIND_LABEL[r.kind] },
      {
        key: "duration",
        label: "Dauer",
        value:
          r.timer_s === null
            ? UNKNOWN
            : r.timer_s < 60
              ? `${r.timer_s} s`
              : `${Math.round(r.timer_s / 60)} Min.`,
      },
      {
        key: "exercises",
        label: "Übungen",
        value:
          r.exercises_total > 0
            ? `${r.exercises_done} von ${r.exercises_total}`
            : UNKNOWN,
      },
      {
        key: "source",
        label: "Quelle",
        value: r.source === "watch" ? "Uhr" : "Chat",
      },
      ...(r.ended_early === true
        ? [{ key: "ended", label: "Ende", value: "vorzeitig beendet" }]
        : []),
    ],
  };
}

/* ------------------------------------------------------------------ setup */

export type MobilityChoice = "morning" | "sessions" | "both" | "none";

export type MobilityDraft = {
  choice: MobilityChoice | null;
  weekdays: Weekday[];
  morningMinutes: 5 | 10 | 15;
  placement: MobilityPlacement;
  /** Kept from a stored answer; the card does not ask for them. */
  sessionsPerWeek: number;
  sessionsMinutes: 15 | 20 | 30;
  areas: MobilityArea[];
};

export const CHOICE_OPTIONS = [
  { value: "morning", label: "Morgenroutine" },
  { value: "sessions", label: "Mobility-Einheiten" },
  { value: "both", label: "Beides" },
  { value: "none", label: "Nein danke" },
] as const;

export const PLACEMENT_OPTIONS = [
  { value: "own_days", label: "Eigene Tage" },
  { value: "after_strength", label: "Nach dem Krafttraining" },
  { value: "arnold_decides", label: "Arnold entscheidet" },
] as const;

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

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

export const wantsMorning = (c: MobilityChoice | null) =>
  c === "morning" || c === "both";
export const wantsSessions = (c: MobilityChoice | null) =>
  c === "sessions" || c === "both";

/** Seeds the card from the stored answer; nothing stored means the defaults. */
export function mobilityDraft(
  stored: MobilityPreference | null,
): MobilityDraft {
  const base: MobilityDraft = {
    choice: null,
    weekdays: [...MOBILITY_DEFAULTS.morning.weekdays],
    morningMinutes: MOBILITY_DEFAULTS.morning.minutes,
    placement: "arnold_decides",
    sessionsPerWeek: MOBILITY_DEFAULTS.sessions.per_week,
    sessionsMinutes: MOBILITY_DEFAULTS.sessions.minutes,
    areas: [],
  };
  if (!stored) return base;
  if (!stored.wants) return { ...base, choice: "none" };
  return {
    choice:
      stored.morning && stored.sessions
        ? "both"
        : stored.morning
          ? "morning"
          : "sessions",
    weekdays: stored.morning ? [...stored.morning.weekdays] : base.weekdays,
    morningMinutes: stored.morning?.minutes ?? base.morningMinutes,
    placement: stored.sessions?.placement ?? base.placement,
    sessionsPerWeek: stored.sessions?.per_week ?? base.sessionsPerWeek,
    sessionsMinutes: stored.sessions?.minutes ?? base.sessionsMinutes,
    areas: [...stored.stiff_areas],
  };
}

/** The answer in the contract format, or why it cannot be saved yet. */
export function mobilityPreference(
  draft: MobilityDraft,
): { ok: true; preference: MobilityPreference } | { ok: false; hint: string } {
  if (!draft.choice) return { ok: false, hint: "Wähle eine Antwort aus." };
  if (draft.choice === "none")
    return { ok: true, preference: { wants: false } };
  const morning = wantsMorning(draft.choice);
  if (morning && draft.weekdays.length === 0)
    return {
      ok: false,
      hint: "Wähle mindestens einen Tag für die Morgenroutine.",
    };
  return {
    ok: true,
    preference: {
      wants: true,
      morning: morning
        ? {
            // Calendar order, however the days were tapped.
            weekdays: WEEKDAYS.filter((d) => draft.weekdays.includes(d)),
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
      stiff_areas: MOBILITY_AREAS.filter((a) => draft.areas.includes(a)),
    },
  };
}
