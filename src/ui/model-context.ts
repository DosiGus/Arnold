/**
 * What a card tells the model, in plain German.
 *
 * Cards report silently (`ui/update-model-context`): the model reads this with
 * the user's next chat message, so "der letzte Satz waren 10 Wiederholungen"
 * works without the user repeating anything. Only finishing a workout posts a
 * visible chat message, because every message scrolls the card out of view.
 *
 * Pure text assembly: every number is either stored data or the engine's own
 * result from the dashboard view. Nothing is computed here.
 */
import type { ArnoldSet, ArnoldWorkout } from "../shared/arnold-schema-v1";
import type { SessionProposal } from "../shared/workout-contract";
import type {
  ArnoldDashboardView,
  ViewRecord,
  ViewWorkoutSummary,
} from "../shared/arnold-view";
import { dateLabel, formatNumber, formatSetLine, UNKNOWN } from "./format";
import { progressionForModel } from "./workout-draft";
import { scoreLines } from "./components/home-scores";

const SEEN =
  "Die Karte zeigt das bereits; im Chat nicht wiederholen, nur kurz einordnen.";

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function counts(summary: ViewWorkoutSummary) {
  return `${count(summary.exercise_count, "Übung", "Übungen")}, ${count(summary.working_set_count, "Arbeitssatz", "Arbeitssätze")}, ${volume(summary.nominal_volume)} Volumen`;
}

function volume(value: number | null) {
  return value === null ? `${UNKNOWN} kg` : `${formatNumber(value, 0)} kg`;
}

function recordLine(record: ViewRecord) {
  const unit = record.unit === "reps" ? "Wdh." : record.unit;
  const gain =
    record.improvement !== null && record.improvement > 0
      ? ` (+${formatNumber(record.improvement, 1)} ${unit})`
      : "";
  return `${record.exercise_name} ${formatNumber(record.value, 1)} ${unit}${gain}`;
}

/** One proposed or saved exercise as a line for the model, with its IDs. */
function proposalLines(proposal: SessionProposal) {
  return proposal.exercises.map((e) => {
    const sets = e.sets.length
      ? e.sets
          .map((s) =>
            formatSetLine({
              ...s,
              load_basis: e.conventions.load_basis,
              reps_basis: e.conventions.reps_basis,
            }),
          )
          .join("; ")
      : UNKNOWN;
    const gaps = e.missing.length
      ? ` – fehlt: ${e.missing.map((m) => MISSING[m]).join(", ")}`
      : "";
    const why = progressionForModel(e);
    const from = why
      ? ` (${why})`
      : e.source === "last_time" && e.last_date
        ? ` (wie am ${dateLabel(e.last_date, true)})`
        : " (Planziel)";
    return `- ${e.exercise_name} [plan_item_id ${e.plan_item_id}, exercise_id ${e.exercise_id}]: ${sets}${from}${gaps}`;
  });
}

const MISSING = { sets: "Sätze", reps: "Wiederholungen", load: "Gewicht" };

export function todayContext(input: {
  proposal?: SessionProposal;
  planName?: string;
  of: number;
  editing: boolean;
  canWrite: boolean;
  /** The user switched the card from Arnold's recommendation to last time. */
  lastTime?: boolean;
}) {
  const { proposal } = input;
  if (!proposal)
    return [
      "Arnold zeigt gerade die Trainingskarte ohne aktiven Plan.",
      input.canWrite
        ? "Berichtet der Nutzer, was er gemacht hat, mit log_workout (session_name und vollständige exercises) eintragen."
        : "Diese Verbindung kann keine Trainings speichern.",
      SEEN,
    ].join("\n");
  return [
    `Arnold zeigt gerade den Trainingstag „${proposal.session_name}“${input.planName ? ` aus dem Plan „${input.planName}“` : ""}${input.of > 1 ? `, Tag ${proposal.session_order} von ${input.of}` : ""} (plan_version_id ${proposal.plan_version_id}, session_id ${proposal.session_id}). So würde „So gemacht, speichern“ eintragen:`,
    ...proposalLines(proposal),
    proposal.exercises.some((e) => e.progression)
      ? "Die Empfehlungen rechnet Arnold nach festen Regeln (doppelte Progression). Gewichte nie selbst ändern oder schätzen; auf Nachfrage die Begründung in eigenen Worten nennen."
      : "",
    input.lastTime
      ? "Der Nutzer hat in der Karte „Wie letztes Mal“ gewählt: Sie zeigt die Werte vom letzten Training statt Arnolds Empfehlung."
      : "",
    input.editing ? "Der Nutzer passt die Werte gerade in der Karte an." : "",
    input.canWrite
      ? "Sagt der Nutzer im Chat, dass er das Training gemacht hat, sofort mit log_workout speichern (diese session_id, nur Abweichungen in exercises) und danach show_arnold_dashboard mit card today zeigen. Sagt er ausdrücklich „alles wie letztes Mal“, same_as_last_time: true senden; dann gelten die Werte vom letzten Mal statt Arnolds Empfehlung."
      : "Diese Verbindung kann keine Trainings speichern.",
    SEEN,
  ]
    .filter(Boolean)
    .join("\n");
}

function setLines(sets: readonly ArnoldSet[]) {
  const byExercise = new Map<number, ArnoldSet[]>();
  for (const set of sets)
    if (set.status === "active")
      byExercise.set(set.exercise_order, [
        ...(byExercise.get(set.exercise_order) ?? []),
        set,
      ]);
  return [...byExercise.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([, list]) =>
        `- ${list[0].exercise_name_snapshot}: ${list
          .map(
            (s) =>
              `Satz ${s.set_number} ${formatSetLine(s)}${s.set_type === "warmup" ? " (Aufwärmen)" : ""} [set_id ${s.set_id}, row_revision ${s.row_revision}]`,
          )
          .join("; ")}`,
    );
}

export function savedContext(input: {
  workout: ArnoldWorkout;
  sets: readonly ArnoldSet[];
  editing: boolean;
}) {
  const { workout } = input;
  return [
    `Arnold zeigt gerade ein gespeichertes Training: „${workout.session_name_snapshot}“ am ${dateLabel(workout.workout_date_local, true)} (workout_id ${workout.workout_id}, row_revision ${workout.row_revision}).`,
    ...setLines(input.sets),
    input.editing ? "Der Nutzer bearbeitet es gerade in der Karte." : "",
    "Einzelne Werte im Chat mit update_set (correct_completed: true, correction_reason) korrigieren; „alles zurück“ mit void_workout nur auf ausdrücklichen Wunsch.",
    SEEN,
  ]
    .filter(Boolean)
    .join("\n");
}

export function runningContext(input: {
  workout: ArnoldWorkout;
  sets: readonly ArnoldSet[];
}) {
  const { workout } = input;
  const lines = setLines(input.sets);
  return [
    `Arnold zeigt gerade ein laufendes Training: „${workout.session_name_snapshot}“ am ${dateLabel(workout.workout_date_local, true)} (workout_id ${workout.workout_id}).`,
    ...(lines.length
      ? ["Gespeicherte Sätze:", ...lines]
      : ["Noch kein Satz gespeichert."]),
    "Weitere Sätze mit log_workout_sets, Korrekturen mit update_set oder void_set; die Karte schließt das Training mit „Training abschließen“ ab.",
    SEEN,
  ].join("\n");
}

/** The visible chat message when the user saves a workout in the card. */
export function finishMessage(input: {
  workout: ArnoldWorkout;
  summary?: ViewWorkoutSummary;
  record?: ViewRecord;
}) {
  const { workout, summary, record } = input;
  const parts = [`Training gespeichert: ${workout.session_name_snapshot}`];
  if (summary) parts.push(counts(summary));
  if (record) parts.push(`neuer Rekord: ${recordLine(record)}`);
  return `${parts.join(" · ")}.`;
}

/** The three scores as the card shows them: value or too little data, with the sentence. */
function scoresContext(view: ArnoldDashboardView): string {
  const lines = scoreLines(view.scores);
  if (!lines) return "";
  return `Scores: ${lines
    .map(
      (l) =>
        `${l.name} ${l.value === null ? "noch zu wenig Daten" : `${l.value} von 100`} (${l.sentence})`,
    )
    .join("; ")}.`;
}

export function homeContext(view: ArnoldDashboardView) {
  const home = view.home;
  const parts = [
    "Arnold zeigt gerade die Startansicht: oben das nächste Training, darunter die Kacheln Woche, Scores, Ziele und Rekorde, unter der Karte vier Aktionsknöpfe. Alle Werte stammen aus den Trainingsdaten; die Erholung nutzt mit Einwilligung zusätzlich Werte der Garmin-Uhr. Die Scores nie medizinisch deuten.",
    scoresContext(view),
    home.next_session
      ? `Als Nächstes im Plan: „${home.next_session.session_name}“.`
      : "",
    home.streak.current !== null
      ? `Serie: ${home.streak.current} ${home.streak.current === 1 ? "Woche" : "Wochen"} am Stück mit erreichtem Wochenziel.`
      : "",
    home.goals.length
      ? `Ziele: ${home.goals
          .map(
            (g) =>
              `${g.name} ${g.progress === null ? "ohne Messwert" : `${Math.round(g.progress * 100)} %`}`,
          )
          .join(", ")}.`
      : "Noch keine Ziele gesetzt.",
    SEEN,
  ];
  return parts.filter(Boolean).join("\n");
}

const PAGE: Record<string, string> = {
  stats: "die Fortschritt-Ansicht mit Serie und Muskelgruppen",
  goals: "die Ziele mit Körpergewicht und Übungszielen",
  records: "alle Rekorde",
  progress: "die Fortschritt-Ansicht",
  history: "den Trainingsverlauf",
  plan: "den Trainingsplan",
};

export function pageContext(card: string) {
  return `Arnold zeigt gerade ${PAGE[card] ?? "eine Ansicht"}. Der Nutzer bedient sie selbst; im Chat nur auf Fragen antworten.`;
}
