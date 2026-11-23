/**
 * What a mobility card tells the model, in plain German (same pattern as
 * run-model-context.ts): silent, replaced by the next state, and only what
 * the server delivered. Nothing is computed here; unknown stays "unbekannt".
 */
import type { MobilityOverview } from "../shared/mobility-contract";
import { dateLabel } from "./format";
import { KIND_LABEL, UNKNOWN } from "./mobility/format";

const SEEN =
  "Die Karte zeigt das bereits; im Chat nicht wiederholen, nur kurz einordnen. Dauern, Übungen und Anteile nie selbst festlegen oder nachrechnen. Bei Schmerzen keine Diagnose.";

export function mobilityTodayContext(overview: MobilityOverview) {
  const items = overview.today.items;
  if (items.length === 0)
    return [
      "Arnold zeigt gerade die Karte „Mobility heute“: heute ist keine Routine geplant.",
      "Eine Morgenroutine in den Plan nimmt update_plan_draft (Mobility-Routinen), den Wunsch speichert update_mobility_profile.",
      SEEN,
    ].join("\n");
  return [
    `Arnold zeigt gerade Mobility heute (${dateLabel(overview.today.date_local, true)}): ${items
      .map(
        (i) =>
          `${i.session_name} (${KIND_LABEL[i.kind]}, ${i.minutes} Min., ${i.done ? "erledigt" : "offen"}) [session_id ${i.session_id}]`,
      )
      .join("; ")}.`,
    "Der Knopf „Erledigt“ fragt nach und ruft dann log_mobility auf. Sagt der Nutzer im Chat, er habe es gemacht, log_mobility mit session_id aufrufen, ohne Minuten zu schätzen.",
    SEEN,
  ].join("\n");
}

export function mobilityResultContext(
  overview: MobilityOverview,
  workoutId: string | null,
) {
  const recent =
    overview.recent.find((r) => r.workout_id === workoutId) ??
    overview.recent[0];
  if (!recent)
    return `Arnold zeigt gerade die Karte „Mobility-Ergebnis“ ohne Routine. ${SEEN}`;
  const a = overview.adherence;
  return [
    `Arnold zeigt gerade das Ergebnis „${recent.session_name ?? KIND_LABEL[recent.kind]}“ vom ${dateLabel(recent.date_local, true)} [workout_id ${recent.workout_id}]: Dauer ${recent.timer_s === null ? UNKNOWN : `${recent.timer_s} s`}, Übungen ${recent.exercises_done} von ${recent.exercises_total}.`,
    a.ratio === null
      ? "Dranbleiben: noch kein Plan (unbekannt, nicht 0)."
      : `Dranbleiben: ${a.done_count} von ${a.planned_count} Routinen in ${a.days} Tagen, ${a.streak_days} Tage in Folge.`,
    SEEN,
  ].join("\n");
}

export function mobilitySetupContext(overview: MobilityOverview) {
  const state = overview.profile.state;
  return [
    state === "not_asked"
      ? "Arnold zeigt gerade die Einrichtung von Mobility (noch nicht gefragt)."
      : state === "yes"
        ? "Arnold zeigt gerade die Mobility-Einstellungen zum Bearbeiten (Nutzer will Mobility)."
        : "Arnold zeigt gerade die Mobility-Einstellungen (Nutzer hat bisher Nein gesagt).",
    "Speichern geht über update_mobility_profile, danach die Routinen über update_plan_draft; nur Angaben des Nutzers übernehmen.",
    SEEN,
  ].join("\n");
}
