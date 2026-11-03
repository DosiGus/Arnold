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
import type {
  ArnoldExercise,
  ArnoldPlanItem,
  ArnoldSet,
  ArnoldWorkout,
} from "../shared/arnold-schema-v1";
import type {
  ArnoldDashboardView,
  ViewRecord,
  ViewWorkoutSummary,
} from "../shared/arnold-view";
import { dateLabel, formatNumber, formatSetLine, UNKNOWN } from "./format";

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

export function todayContext(input: {
  sessionName: string;
  planName?: string;
  day?: { order: number; of: number };
  exercises: readonly { name: string; target: string }[];
  canWrite: boolean;
}) {
  const where = input.planName
    ? ` aus dem Plan „${input.planName}“${input.day ? `, Tag ${input.day.order} von ${input.day.of}` : ""}`
    : " ohne aktiven Plan";
  return [
    `Arnold zeigt gerade die Heute-Karte: vorgeschlagen ist „${input.sessionName}“${where}.`,
    ...input.exercises.map((e) => `- ${e.name}: ${e.target}`),
    input.canWrite
      ? "Der Nutzer startet das Training mit „Training starten“ in der Karte."
      : "Diese Verbindung kann keine Trainings speichern.",
    SEEN,
  ].join("\n");
}

export function workoutContext(input: {
  workout: ArnoldWorkout;
  sets: readonly ArnoldSet[];
  exercises: ReadonlyMap<string, ArnoldExercise>;
  items: readonly ArnoldPlanItem[];
  current?: string;
  pending: boolean;
}) {
  const { workout } = input;
  const active = input.sets.filter((s) => s.status === "active");
  const byExercise = new Map<string, ArnoldSet[]>();
  for (const set of active) {
    const list = byExercise.get(set.exercise_id) ?? [];
    list.push(set);
    byExercise.set(set.exercise_id, list);
  }
  const name = (id: string) => input.exercises.get(id)?.name_de ?? "Übung";
  const lines = [
    `Arnold zeigt gerade ein laufendes Training: „${workout.session_name_snapshot}“ am ${dateLabel(workout.workout_date_local, true)} (workout_id ${workout.workout_id}).`,
  ];
  if (input.current) lines.push(`Aktuelle Übung: ${name(input.current)}.`);
  if (!active.length) lines.push("Noch kein Satz gespeichert.");
  else {
    lines.push("Gespeicherte Sätze:");
    for (const [id, sets] of byExercise)
      lines.push(
        `- ${name(id)}: ${sets
          .map(
            (s) =>
              `Satz ${s.set_number} ${formatSetLine(s)}${s.set_type === "warmup" ? " (Aufwärmen)" : ""} [set_id ${s.set_id}]`,
          )
          .join("; ")}`,
      );
  }
  const open = input.items.filter((i) => !byExercise.has(i.exercise_id));
  if (open.length)
    lines.push(
      `Noch offen laut Plan: ${open.map((i) => name(i.exercise_id)).join(", ")}.`,
    );
  if (input.pending)
    lines.push(
      "Achtung: Eine Speicherung ist unbestätigt. Nichts Neues speichern, bis der Nutzer in der Karte „Erneut prüfen“ getippt hat.",
    );
  lines.push(
    "Korrekturen aus dem Chat mit update_set oder void_set und der set_id; die aktuelle row_revision vorher mit get_workout laden. Die Karte aktualisiert sich beim nächsten Öffnen.",
    SEEN,
  );
  return lines.join("\n");
}

export function summaryContext(input: {
  workout: ArnoldWorkout;
  summary?: ViewWorkoutSummary;
  record?: ViewRecord;
}) {
  const { workout, summary, record } = input;
  return [
    `Arnold zeigt gerade ein abgeschlossenes Training: „${workout.session_name_snapshot}“ am ${dateLabel(workout.workout_date_local, true)} (workout_id ${workout.workout_id}).`,
    summary ? `${counts(summary)}.` : "Die Auswertung wird noch aktualisiert.",
    record ? `Neuer Rekord: ${recordLine(record)}.` : "",
    SEEN,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The visible chat message when the user taps "Training beenden". */
export function finishMessage(input: {
  workout: ArnoldWorkout;
  summary?: ViewWorkoutSummary;
  record?: ViewRecord;
}) {
  const { workout, summary, record } = input;
  const parts = [`Training beendet: ${workout.session_name_snapshot}`];
  if (summary) parts.push(counts(summary));
  if (record) parts.push(`neuer Rekord: ${recordLine(record)}`);
  return `${parts.join(" · ")}.`;
}

export function weekContext(view: ArnoldDashboardView) {
  const week =
    view.weeks.find((w) => w.is_current_week) ??
    view.weeks[view.weeks.length - 1];
  const last = view.recent_workouts.find((w) => w.status === "completed");
  if (!week)
    return `Arnold zeigt gerade die Wochenkarte; es gibt noch keine Trainings. ${SEEN}`;
  const goal = view.active_plan?.days_per_week;
  return [
    `Arnold zeigt gerade die Wochenkarte (${week.is_current_week ? "diese Woche" : `Woche ${week.label}`}): ${week.training_days}${goal ? ` von ${goal} Trainingstagen` : ` ${week.training_days === 1 ? "Trainingstag" : "Trainingstage"}`}, ${count(week.working_sets, "Arbeitssatz", "Arbeitssätze")}, ${volume(week.nominal_volume)} Volumen.`,
    last ? `Zuletzt: „${last.title}“ am ${dateLabel(last.date, true)}.` : "",
    SEEN,
  ]
    .filter(Boolean)
    .join("\n");
}

export function homeContext(view: ArnoldDashboardView) {
  const home = view.home;
  const parts = [
    "Arnold zeigt gerade die Startansicht mit den Kacheln Training, Fortschritt, Ziele und Rekorde.",
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
