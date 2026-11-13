/**
 * What a run card tells the model, in plain German (same pattern as
 * model-context.ts): silent, replaced by the next state, and only what the
 * server delivered. Nothing is computed here; unknown stays "unbekannt".
 */
import type {
  RunAnalysisResponse,
  RunWeekResponse,
  ScheduleRunWeekResult,
  RunView,
} from "../shared/run-contract";
import { dateLabel } from "./format";
import {
  RUN_TYPE_LABEL,
  UNKNOWN,
  clockLabel,
  distanceLabel,
  minutesLabel,
  paceLabel,
  readMetric,
  num,
} from "./run/format";

const SEEN =
  "Die Karte zeigt das bereits; im Chat nicht wiederholen, nur kurz einordnen. Tempi, Zonen, Dauern und Belastung nie selbst festlegen oder nachrechnen.";

export function runTodayContext(view?: RunView, today?: string) {
  if (!view)
    return [
      "Arnold zeigt gerade die Karte „Heutiger Lauf“: heute ist kein Lauf geplant.",
      "Einen Lauf plant plan_run (Arnold berechnet die Vorgabe), die ganze Woche schedule_run_week.",
      SEEN,
    ].join("\n");
  return [
    `Arnold zeigt gerade den Lauf „${view.name ?? RUN_TYPE_LABEL[view.run_type]}“ am ${dateLabel(view.workout_date_local, true)}${today === view.workout_date_local ? " (heute)" : ""} [workout_id ${view.workout_id}, row_revision ${view.row_revision}], Status ${view.status}.`,
    view.planned
      ? `Vorgabe: ${view.planned.total_s === null ? UNKNOWN : minutesLabel(view.planned.total_s / 60)}${view.hint ? `; ${view.hint}` : ""}.`
      : "",
    view.status === "planned"
      ? "Die Knöpfe „Kürzer“ und „Verschieben“ rufen update_planned_run auf. Wünscht der Nutzer das im Chat, update_planned_run mit workout_id und expected_row_revision nutzen; Arnold berechnet die Vorgabe neu."
      : "",
    SEEN,
  ]
    .filter(Boolean)
    .join("\n");
}

export function runResultContext(analysis: RunAnalysisResponse) {
  const view = analysis.run?.view;
  if (!view)
    return `Arnold zeigt gerade die Karte „Lauf-Ergebnis“ ohne Lauf. ${SEEN}`;
  const m = analysis.run!.metrics;
  const distance = readMetric(m, "distance_m").value;
  const timer = readMetric(m, "timer_s").value;
  const pace = readMetric(m, "pace_s_per_km").value;
  return [
    `Arnold zeigt gerade das Ergebnis des Laufs „${view.name ?? RUN_TYPE_LABEL[view.run_type]}“ vom ${dateLabel(view.workout_date_local, true)} [workout_id ${view.workout_id}, row_revision ${view.row_revision}].`,
    view.result
      ? `Distanz ${distanceLabel(num(distance))}, Zeit ${clockLabel(num(timer))}, Tempo ${paceLabel(num(pace))}, Anstrengung ${view.result.rpe ?? UNKNOWN}. Fehlendes ist unbekannt, nicht 0.`
      : "Der Lauf ist noch nicht gelaufen: keine Kennzahlen.",
    view.result?.hr_status && view.result.hr_status !== "recorded"
      ? "Ohne Einwilligung für Gesundheitsdaten (oder ohne Sensor) hat Arnold keinen Puls; die Zone zeigt dann die Uhr („Zone 2 laut Uhr“)."
      : "",
    "Anstrengung nachtragen: rate_run (nur den Wert des Nutzers).",
    SEEN,
  ]
    .filter(Boolean)
    .join("\n");
}

export function runWeekContext(
  week: RunWeekResponse,
  preview?: ScheduleRunWeekResult | null,
) {
  const s = week.summary;
  return [
    `Arnold zeigt gerade die Trainingswoche ${dateLabel(week.week_start)} bis ${dateLabel(week.week_end, true)}: Läufe ${s.runs_completed} von ${s.runs_planned} erledigt, ${s.runs_missed} verpasst; Kraft ${s.strength_completed} von ${s.strength_planned}.`,
    preview
      ? `Die Karte zeigt eine Vorschau der nächsten Woche (preview_hash ${preview.preview_hash}). Gespeichert ist noch nichts; gespeichert wird erst, wenn der Nutzer in der Karte „Woche bestätigen“ tippt. Bestätigt er im Chat, schedule_run_week mit confirm true, request_id und genau diesem preview_hash aufrufen.`
      : "Eine Vorschau der Woche gibt schedule_run_week ohne confirm; sie speichert nichts.",
    SEEN,
  ].join("\n");
}

export function runStatsContext(analysis: RunAnalysisResponse) {
  return [
    `Arnold zeigt gerade den Laufverlauf der letzten ${analysis.weeks.length} Wochen bis ${dateLabel(analysis.reference_date, true)}.`,
    analysis.load_ratio && readMetric(analysis, "load_ratio").reason === null
      ? ""
      : "",
    "Unbekannte Werte stehen mit Grund in der Karte (nie 0). Teilweise bekannte Summen heißen „aus x von y Läufen“.",
    SEEN,
  ]
    .filter(Boolean)
    .join("\n");
}

export function runSetupContext(hasProfile: boolean, missing: string[]) {
  return [
    hasProfile
      ? "Arnold zeigt gerade das Laufprofil zum Bearbeiten."
      : "Arnold zeigt gerade die Einrichtung des Laufprofils (noch keines vorhanden).",
    missing.length ? `Es fehlt noch: ${missing.join("; ")}.` : "",
    "Speichern geht über update_run_profile; nur Angaben des Nutzers übernehmen, nie schätzen.",
    SEEN,
  ]
    .filter(Boolean)
    .join("\n");
}
