import type { PlanMobilitySession } from "../../shared/plan-contract";
import { exerciseName } from "../mobility/format";
import { WEEKDAY_LONG } from "../run/format";
import { Rows } from "./cards";

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * When a mobility routine happens, as the plan stores it: its weekdays, or
 * "nach <Krafteinheit>". Names come from the plan version; nothing is derived.
 */
function whenText(
  s: PlanMobilitySession,
  strengthName: (id: string | null) => string | undefined,
): string {
  if (s.placement === "after_strength") {
    const name = strengthName(s.after_session_id);
    return name ? `nach ${name}` : "nach einer Krafteinheit";
  }
  const days = [...s.weekdays].sort((a, b) => a - b);
  if (days.length === 7) return "jeden Tag";
  if (days.length === 1) return WEEKDAY_LONG[days[0] - 1] ?? "Tag frei";
  return days.map((d) => WEEKDAY_SHORT[d - 1]).join(", ");
}

/**
 * The mobility routines of a plan version, labelled "Morgenroutine" or
 * "Mobility-Einheit". Read only: they are changed through the chat. Removed
 * routines are not part of the plan any more and are not listed.
 */
export function PlanMobilitySessions({
  sessions,
  strengthSessions = [],
}: {
  sessions: readonly PlanMobilitySession[] | undefined;
  /** The strength sessions of the same version, for "nach <Krafteinheit>". */
  strengthSessions?: readonly { session_id: string; session_name: string }[];
}) {
  const active = (sessions ?? []).filter((s) => s.status === "active");
  if (!active.length) return null;
  const strengthName = (id: string | null) =>
    strengthSessions.find((s) => s.session_id === id)?.session_name;
  return (
    <Rows
      label="Mobility"
      items={[...active]
        .sort((a, b) => a.session_order - b.session_order)
        .map((s) => ({
          key: s.session_id,
          label: (
            <>
              {s.session_name}{" "}
              <span className="ac-pill muted">
                {s.kind === "morning" ? "Morgenroutine" : "Mobility-Einheit"}
              </span>
              <span className="ac-plan-mobility-exercises">
                {s.template.exercise_ids.map(exerciseName).join(", ")}
              </span>
            </>
          ),
          value: `${s.minutes} Min. · ${whenText(s, strengthName)}`,
        }))}
    />
  );
}
