import { Check, ChevronRight } from "lucide-react";
import type { ArnoldHome } from "../../shared/arnold-view";

/**
 * The mobility line of the start screen (MOB-013). Everything shown is the
 * line the presenter delivered (`home.mobility`, MOB-005): today's state of the
 * morning routine and the "Dranbleiben" counts. Nothing is computed here; an
 * unknown ratio ("noch kein Plan") is never shown as 0. Without the line (no
 * profile, or the user said no) nothing is rendered.
 */
export type HomeMobilityLine = NonNullable<ArnoldHome["mobility"]>;

/** The "Dranbleiben" sentence from the server's counts. */
export function stayText(line: HomeMobilityLine): string {
  const a = line.adherence;
  if (a.ratio === null || a.planned_count === 0)
    return "Dranbleiben: noch kein Plan.";
  return `Dranbleiben: ${a.done_count} von ${a.planned_count} Routinen in ${a.days} Tagen${a.streak_days >= 2 ? `, ${a.streak_days} Tage in Folge` : ""}.`;
}

export function HomeMobility({
  line,
  onOpen,
}: {
  line: HomeMobilityLine | undefined;
  /** Opens the mobility card; without it the line is only text. */
  onOpen?: () => void;
}) {
  if (!line) return null;
  const title = line.morning === null ? "Mobility" : "Morgenroutine";
  const state =
    line.morning === "done"
      ? "erledigt"
      : line.morning === "open"
        ? "offen"
        : null;
  const body = (
    <>
      <span className="ac-home-mobility-text">
        <span className="ac-caption">{title}</span>
        <strong>
          {state === "erledigt" ? (
            <>
              Heute erledigt <Check size={15} aria-hidden="true" />
            </>
          ) : state === "offen" ? (
            "Heute noch offen"
          ) : line.sessions_open > 0 ? (
            `${line.sessions_open} ${line.sessions_open === 1 ? "Einheit" : "Einheiten"} heute offen`
          ) : (
            "Heute nichts geplant"
          )}
        </strong>
        <span className="ac-home-mobility-meta">{stayText(line)}</span>
      </span>
      {onOpen && <ChevronRight size={16} aria-hidden="true" />}
    </>
  );
  const label = `${title}: ${state ? `heute ${state}` : ""}${state ? ". " : ""}${stayText(line)}`;
  return onOpen ? (
    <button
      type="button"
      className="ac-home-mobility"
      data-state={state ?? "none"}
      aria-label={label}
      onClick={onOpen}
    >
      {body}
    </button>
  ) : (
    <div className="ac-home-mobility" data-state={state ?? "none"} role="note">
      {body}
    </div>
  );
}
