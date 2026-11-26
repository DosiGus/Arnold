import type { OnboardingRun } from "../../../shared/onboarding-contract";
import { RUN_LIMITS, type RunEnvironment } from "../../../shared/run-contract";

type RunGoal = OnboardingRun["goal"];

/** The local answers of the run page; texts stay texts until they are read. */
export type RunDraft = {
  goal: RunGoal | undefined;
  runsPerWeek: number;
  baseMinutes: number | undefined;
  longestMinutes: number | undefined;
  environment: RunEnvironment;
  raceDate: string;
  targetText: string;
  /** Metres of the reference distance, as text; "" while nothing is chosen. */
  referenceMeters: string;
  referenceTimeText: string;
  referenceDate: string;
};

export const RUN_DRAFT_DEFAULT: RunDraft = {
  goal: undefined,
  runsPerWeek: 3,
  baseMinutes: undefined,
  longestMinutes: undefined,
  environment: "outdoor",
  raceDate: "",
  targetText: "",
  referenceMeters: "",
  referenceTimeText: "",
  referenceDate: "",
};

/** The common reference distances; a stored other distance is added as is. */
export const REFERENCE_DISTANCES = [
  { value: "5000", label: "5 km" },
  { value: "10000", label: "10 km" },
  { value: "21097", label: "Halbmarathon" },
] as const;

/**
 * Reads "h:mm:ss" or "m:ss" as seconds. Empty text is `undefined` (nothing
 * entered), unreadable or out-of-range text is `null`. Only converts what was
 * typed; nothing is estimated.
 */
export function parseDuration(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d{1,2}$/.test(p))) return null;
  const [seconds, minutes, hours = 0] = parts.map(Number).reverse();
  if (seconds > 59 || (parts.length === 3 && minutes > 59)) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 && total <= RUN_LIMITS.maxSeconds ? total : null;
}

/** Seconds as "h:mm:ss" for the input field. */
export function durationText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${h}:${two(m)}:${two(s)}`;
}

export function draftFromRun(run: OnboardingRun | undefined): RunDraft {
  if (!run) return RUN_DRAFT_DEFAULT;
  return {
    goal: run.goal,
    runsPerWeek: run.runs_per_week ?? RUN_DRAFT_DEFAULT.runsPerWeek,
    baseMinutes: run.base_minutes_per_week ?? RUN_DRAFT_DEFAULT.baseMinutes,
    longestMinutes: run.longest_run_4w_min ?? RUN_DRAFT_DEFAULT.longestMinutes,
    environment: run.preferred_environment ?? RUN_DRAFT_DEFAULT.environment,
    raceDate: run.race_date ?? "",
    targetText: run.target_time_s ? durationText(run.target_time_s) : "",
    referenceMeters: run.reference ? String(run.reference.distance_m) : "",
    referenceTimeText: run.reference ? durationText(run.reference.time_s) : "",
    referenceDate: run.reference?.date ?? "",
  };
}

export type RunDraftResult = {
  /** The run answers, when every required one is there and all texts read. */
  run: OnboardingRun | undefined;
  /** Plain-language problems with optional fields that were started. */
  problems: { target?: string; reference?: string };
};

/** Turns the local answers into the contract object, or says what is off. */
export function runFromDraft(draft: RunDraft): RunDraftResult {
  const problems: RunDraftResult["problems"] = {};
  const target = parseDuration(draft.targetText);
  if (target === null)
    problems.target =
      "Bitte als Stunden:Minuten:Sekunden eintragen, z. B. 0:50:00.";
  const referenceTime = parseDuration(draft.referenceTimeText);
  const anyReference =
    draft.referenceMeters !== "" ||
    draft.referenceTimeText.trim() !== "" ||
    draft.referenceDate !== "";
  if (anyReference) {
    if (referenceTime === null)
      problems.reference =
        "Bitte die Zeit als Stunden:Minuten:Sekunden eintragen, z. B. 0:25:30.";
    else if (
      draft.referenceMeters === "" ||
      referenceTime === undefined ||
      draft.referenceDate === ""
    )
      problems.reference =
        "Für die Referenzzeit brauchen wir Strecke, Zeit und Datum – oder lass alles leer.";
  }
  if (
    problems.target ||
    problems.reference ||
    draft.goal === undefined ||
    draft.baseMinutes === undefined ||
    draft.longestMinutes === undefined
  )
    return { run: undefined, problems };
  const run: OnboardingRun = {
    goal: draft.goal,
    runs_per_week: draft.runsPerWeek,
    base_minutes_per_week: draft.baseMinutes,
    longest_run_4w_min: draft.longestMinutes,
    preferred_environment: draft.environment,
  };
  if (draft.raceDate) run.race_date = draft.raceDate;
  if (target !== undefined && target !== null) run.target_time_s = target;
  if (anyReference && typeof referenceTime === "number")
    run.reference = {
      distance_m: Number(draft.referenceMeters),
      time_s: referenceTime,
      date: draft.referenceDate,
      source: "user",
    };
  return { run, problems };
}
