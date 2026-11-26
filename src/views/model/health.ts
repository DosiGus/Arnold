/**
 * `get_health_data` → the Health Data screen. Mapping only: averages and the
 * choice of the newest day come from `src/analytics/health-summary.ts`; here
 * values are labelled, Garmin's wording is translated and seconds become
 * hours and minutes for reading. Unknown stays null and is shown as "–".
 */
import type { HealthSummaryView } from "../../shared/health-contract.js";
import type { HealthData } from "../demo/dashboard.js";
import { num, shortDate } from "./dashboard.js";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** "2026-11-26" → "Do" (calendar day, never via a time zone). */
const weekday = (iso: string) =>
  WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]!;

const HRV_STATUS: Record<string, string> = {
  balanced: "ausgeglichen",
  unbalanced: "unausgeglichen",
  low: "niedrig",
  poor: "schwach",
};

const READINESS: Record<string, string> = {
  prime: "Bestform",
  high: "hoch",
  moderate: "mittel",
  low: "niedrig",
  poor: "sehr niedrig",
};

const TRAINING_STATUS: Record<string, string> = {
  peaking: "Höchstform",
  productive: "Produktiv",
  maintaining: "Erhaltend",
  recovery: "Erholung",
  unproductive: "Unproduktiv",
  detraining: "Leistungsabbau",
  overreaching: "Überlastung",
  strained: "Angespannt",
  no_status: "Kein Status",
};

const minutes = (seconds: number | null) =>
  seconds === null ? null : Math.round(seconds / 60);

/** "heute" when the newest values are from today, else "Stand 25. Nov.". */
export function healthDayLabel(s: HealthSummaryView): string {
  if (s.latest_date === null || s.latest_date === s.reference_date)
    return "heute";
  return `Stand ${shortDate(s.latest_date)}`;
}

export function healthModel(s: HealthSummaryView): HealthData {
  const l = s.latest;
  const a = s.avg7;
  const f = s.fitness;
  const phases = (
    [
      ["Tief", l.sleep_deep_seconds],
      ["Leicht", l.sleep_light_seconds],
      ["REM", l.sleep_rem_seconds],
      ["Wach", l.sleep_awake_seconds],
    ] as const
  ).flatMap(([label, sec]) =>
    sec === null ? [] : [{ label, minutes: minutes(sec)! }],
  );
  return {
    today: [
      {
        key: "rhr",
        label: "Ruhepuls",
        value: l.resting_hr_bpm,
        unit: "bpm",
        avg7: a.resting_hr_bpm,
      },
      {
        key: "hrv",
        label: "HRV",
        value: l.hrv_last_night_ms,
        unit: "ms",
        avg7: a.hrv_last_night_ms,
        note: l.hrv_status ? HRV_STATUS[l.hrv_status] : undefined,
      },
      {
        key: "bb",
        label: "Body Battery",
        value: l.body_battery_high,
        unit: "",
        avg7: a.body_battery_high,
      },
      {
        key: "spo2",
        label: "Blutsauerstoff",
        value: l.spo2_avg_pct,
        unit: "%",
        avg7: a.spo2_avg_pct,
      },
    ],
    sleep: {
      hours:
        l.sleep_seconds === null
          ? null
          : Math.round(l.sleep_seconds / 360) / 10,
      score: l.sleep_score,
      avg7: a.sleep_score,
      phases,
      week: s.sleep_week.map((w) => ({
        day: weekday(w.local_date),
        score: w.score,
      })),
    },
    fitness: [
      {
        label: "VO2max",
        value:
          f.vo2max_running === null
            ? "–"
            : `${num(f.vo2max_running)} ml/kg/min`,
      },
      {
        label: "Fitnessalter",
        value:
          f.fitness_age === null
            ? "–"
            : `${f.fitness_age} Jahre${f.chronological_age === null ? "" : ` (du bist ${f.chronological_age})`}`,
      },
      {
        label: "Trainingsbereitschaft",
        value:
          f.training_readiness_score === null
            ? "–"
            : `${f.training_readiness_score} von 100`,
        note: f.training_readiness_level
          ? READINESS[f.training_readiness_level]
          : undefined,
      },
      {
        label: "Trainingszustand",
        value: f.training_status
          ? (TRAINING_STATUS[f.training_status] ?? f.training_status)
          : "–",
      },
    ],
    activity: [
      {
        key: "steps",
        label: "Schritte",
        value: l.steps,
        unit: "",
        avg7: a.steps === null ? null : Math.round(a.steps),
      },
      {
        key: "int",
        label: "Intensitätsminuten",
        value: l.intensity_minutes,
        unit: "Min.",
        avg7: a.intensity_minutes,
      },
      {
        key: "kcal",
        label: "Kilokalorien",
        value: l.kcal_total,
        unit: "kcal",
        avg7: a.kcal_total === null ? null : Math.round(a.kcal_total),
      },
    ],
  };
}
