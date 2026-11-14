import type { PlanRunSession } from "../../shared/plan-contract";
import { RUN_TYPE_LABEL, WEEKDAY_LONG } from "../run/format";
import { Rows } from "./cards";

/**
 * The run sessions of a plan version, labelled "Laufeinheit". Read only: they
 * are changed through the chat. Everything shown is stored on the version.
 */
export function PlanRunSessions({
  sessions,
}: {
  sessions: readonly PlanRunSession[];
}) {
  if (!sessions.length) return null;
  return (
    <Rows
      label="Laufeinheiten"
      items={[...sessions]
        .sort((a, b) => a.session_order - b.session_order)
        .map((s) => ({
          key: s.session_id,
          label: (
            <>
              {s.session_name}{" "}
              <span className="ac-pill muted">Laufeinheit</span>
            </>
          ),
          value: [
            RUN_TYPE_LABEL[s.run_type],
            s.preferred_weekday
              ? WEEKDAY_LONG[s.preferred_weekday - 1]
              : "Tag frei",
            s.status === "active" ? "Aktiv" : "Entfernt",
          ].join(" · "),
        }))}
    />
  );
}
