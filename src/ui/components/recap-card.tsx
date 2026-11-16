import { useRef, useState } from "react";
import { Check } from "lucide-react";
import type { ArnoldRecap } from "../../shared/recap-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { formatNumber, recordValue } from "../format";
import { CardTag } from "./conversation-cards";

const kg = (value: number) => `${formatNumber(value, 2)} kg`;

/** "Nächstes Mal: …" from the server's progression; the card computes nothing. */
export function suggestionText(s: NonNullable<ArnoldRecap["suggestion"]>) {
  const weighed =
    s.decision !== "more_reps" &&
    s.next_load_kg !== null &&
    s.last_load_kg !== null;
  const hantel = s.load_basis === "per_implement" ? " pro Hantel" : "";
  return weighed
    ? `Nächstes Mal: ${s.exercise_name} ${kg(s.next_load_kg!)}${hantel} statt ${kg(s.last_load_kg!)}`
    : `Nächstes Mal: ${s.exercise_name} ${s.next_reps} statt ${s.last_reps} Wiederholungen`;
}

/**
 * Rückblick at the top of the overview (UX-006). Shows only what the server
 * delivered. Both buttons set "gesehen"; nothing else is written, so nothing
 * is shown as saved that is not.
 */
export function RecapBanner({
  recap,
  client,
  onNext,
}: {
  recap: ArnoldRecap;
  client?: ArnoldMcpClient;
  /** Opens the next training, where the suggestion is already filled in. */
  onNext: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const busy = useRef(false);
  if (hidden) return null;

  const done = async (then?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    // A failed marker is not shown to the user: at worst the recap returns once.
    try {
      await client?.markRecapSeen(recap.workout_id);
    } catch {
      /* keep going */
    }
    busy.current = false;
    setHidden(true);
    then?.();
  };

  const goal = recap.week_goal;
  const watch = recap.from_watch ? " · Von der Uhr" : "";
  return (
    <section className="ac-recap" aria-label="Rückblick auf dein Training">
      <CardTag icon={<Check size={13} />}>Geschafft</CardTag>
      <h3>Geschafft: {recap.title}</h3>
      <p className="ac-caption">
        {recap.exercise_count}{" "}
        {recap.exercise_count === 1 ? "Übung" : "Übungen"} ·{" "}
        {recap.working_set_count} Arbeitssätze{watch}
      </p>
      {(recap.records.length > 0 || goal) && (
        <ul className="cc-status ac-recap-lines">
          {recap.records.map((r) => (
            <li className="cc-line ok" key={`${r.exercise_id}-${r.metric}`}>
              <Check size={14} aria-hidden="true" />
              Neuer Rekord: {r.exercise_name} {recordValue(r)}
            </li>
          ))}
          {goal && (
            <li className="cc-line ok">
              <Check size={14} aria-hidden="true" />
              Wochenziel erreicht: {goal.training_days} von {goal.goal}{" "}
              Trainingstagen
            </li>
          )}
        </ul>
      )}
      {recap.suggestion && (
        <p className="ac-text ac-recap-next">
          {suggestionText(recap.suggestion)}
        </p>
      )}
      <div className="ac-recap-actions">
        {recap.suggestion && (
          <button
            type="button"
            className="ac-btn primary"
            onClick={() => void done(onNext)}
          >
            Nächstes Training ansehen
          </button>
        )}
        <button
          type="button"
          className={`ac-btn ${recap.suggestion ? "secondary" : "primary"}`}
          onClick={() => void done()}
        >
          Verstanden
        </button>
      </div>
    </section>
  );
}
