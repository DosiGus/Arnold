import type { CSSProperties } from "react";
import type { ArnoldScores } from "../../shared/scores-contract";

/**
 * The three scores of the overview (UX-009). Every number comes from the
 * server (`src/analytics/scores.ts`); this file only words the parts the
 * engine hands over. Too little data is said plainly, never shown as 0.
 */

type Score = { name: string; value: number | null; sentence: string };

const RUN_LABEL: Record<
  ArnoldScores["progress"]["runs"][number]["metric"],
  string
> = {
  easy_pace: "Tempo ruhiger Läufe",
  easy_efficiency: "Tempo pro Herzschlag bei ruhigen Läufen",
  fast_pace: "Tempo schneller Läufe",
  longest_run: "längster Lauf",
};
const VERDICT: Record<"up" | "same" | "down", string> = {
  up: "besser",
  same: "gehalten",
  down: "schwächer",
};
const PART_LABEL: Record<
  ArnoldScores["recovery"]["parts"][number]["kind"],
  string
> = {
  sleep: "Schlaf",
  resting_hr: "Ruhepuls",
  hrv: "HRV",
  body_battery: "Body Battery",
};

function consistency(s: ArnoldScores["consistency"]): Score {
  const sentence =
    s.status === "ok"
      ? `In ${s.weeks_goal_met} von ${s.weeks_counted} Wochen Wochenziel erreicht.`
      : s.reason === "no_weekly_goal"
        ? "Noch zu wenig Daten: Es gibt noch kein Wochenziel. Du legst es in deinem Plan fest."
        : s.reason === "too_few_weeks"
          ? `Noch zu wenig Daten: Dafür braucht es drei abgeschlossene Wochen, bisher ${s.weeks_counted}.`
          : "Noch zu wenig Daten: Es gibt noch kein Training.";
  return { name: "Konstanz", value: s.value, sentence };
}

function progress(s: ArnoldScores["progress"]): Score {
  const runs = s.runs.map(
    (r) => `${RUN_LABEL[r.metric]} ${VERDICT[r.verdict]}`,
  );
  const sentence =
    s.status === "ok"
      ? `${s.improved} von ${s.compared} Werten gesteigert${runs.length ? `; ${runs.join(", ")}` : ""}.`
      : s.compared === 0
        ? "Noch zu wenig Daten: Es fehlen Übungen oder Läufe, die du in den letzten sechs Wochen zweimal verglichen hast."
        : `Noch zu wenig Daten: Dafür braucht es drei Vergleichswerte aus den letzten sechs Wochen, bisher ${s.compared}.`;
  return { name: "Fortschritt", value: s.value, sentence };
}

function recovery(s: ArnoldScores["recovery"]): Score {
  if (s.status !== "ok")
    return {
      name: "Erholung",
      value: null,
      sentence:
        s.reason === "too_short_history"
          ? "Noch zu wenig Daten: Dafür braucht es vier Wochen seit deinem ersten Training."
          : s.reason === "too_few_training_weeks"
            ? "Noch zu wenig Daten: In den vier Wochen davor brauchst du mindestens zwei Trainingswochen."
            : s.reason === "no_base_load"
              ? "Noch zu wenig Daten: Die Belastung der Wochen davor ist unbekannt."
              : "Noch zu wenig Daten: Es gibt noch kein Training.",
    };
  const d = s.strongest_deduction;
  const deduction = !d
    ? "kein Abzug"
    : d.kind === "load_increase"
      ? `stärkster Abzug mehr Belastung als in den Wochen davor (−${d.points})`
      : d.kind === "consecutive_days"
        ? `stärkster Abzug ${s.consecutive_days} Trainingstage in Folge (−${d.points})`
        : `stärkster Abzug ${PART_LABEL[d.kind]} (−${d.points})`;
  const best = s.best
    ? s.best.kind === "training"
      ? `Training ${s.best.value}`
      : `${PART_LABEL[s.best.kind]} ${s.best.value}`
    : null;
  const head = `${deduction[0].toUpperCase()}${deduction.slice(1)}${best ? `, bester Wert ${best}` : ""}.`;
  return {
    name: "Erholung",
    value: s.value,
    sentence:
      s.watch === "used" ? head : `${head} Nur aus deinem Training geschätzt.`,
  };
}

/** Konstanz, Fortschritt, Erholung in this order, each with its sentence. */
export function scoreLines(scores: ArnoldScores | undefined): Score[] | null {
  if (!scores) return null;
  return [
    consistency(scores.consistency),
    progress(scores.progress),
    recovery(scores.recovery),
  ];
}

/** Figure for the tile: the three values, a dash for too little data. */
export function ScoresFigure({ lines }: { lines: Score[] | null }) {
  return (
    <span
      className="ac-home-tile-figure"
      aria-label={
        lines
          ? lines
              .map(
                (l) =>
                  `${l.name} ${l.value === null ? "noch zu wenig Daten" : l.value}`,
              )
              .join(", ")
          : "Noch keine Scores"
      }
    >
      {lines
        ? lines.map((l) => (l.value === null ? "–" : l.value)).join(" · ")
        : "–"}
    </span>
  );
}

/** Detail of the tile: a ring per score and its one sentence. */
export function ScoresDetail({ lines }: { lines: Score[] | null }) {
  if (!lines)
    return <p className="ac-text">Die Scores sind gerade nicht verfügbar.</p>;
  return (
    <>
      <div className="ac-scores">
        {lines.map((s) => (
          <div className="ac-score" key={s.name}>
            <span>{s.name}</span>
            <span
              className={`ac-widget-ring ${s.value === null ? "no-goal" : ""}`}
              style={
                {
                  "--ring-angle": `${(s.value ?? 0) * 3.6}deg`,
                } as CSSProperties
              }
              role="img"
              aria-label={
                s.value === null
                  ? `${s.name}: noch zu wenig Daten`
                  : `${s.name}: ${s.value} von 100`
              }
            >
              {s.value ?? "–"}
            </span>
            {s.value === null && <small>zu wenig Daten</small>}
          </div>
        ))}
      </div>
      <ul className="ac-score-lines">
        {lines.map((s) => (
          <li key={s.name}>
            <strong>{s.name}:</strong> {s.sentence}
          </li>
        ))}
      </ul>
    </>
  );
}
