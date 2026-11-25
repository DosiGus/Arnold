import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import {
  GOAL_LABEL,
  modulesOf,
  normalizeKnownLoads,
  KNOWN_LOAD_LIFTS,
  type OnboardingState,
} from "../../../shared/onboarding-contract";
import type { ArnoldDashboardView } from "../../../shared/arnold-view";
import type { ArnoldMcpClient } from "../../client/ArnoldMcpClient";
import { formatNumber } from "../../format";
import { CardFrame } from "./card-frame";
import { modulesLine, personLine, SummaryLine } from "./card-summary";

/**
 * Card "Arnold ist bereit": profile and overview in one card. Every value is
 * what the server stored or the dashboard read tool returns; a value that is
 * not known is left out or reads "noch offen", never 0. The maxima are the
 * user's stated benchmarks and are always called estimated. Two actions:
 * "Einheit ansehen" and "Plan öffnen". The watch fetches the plan itself, so
 * there is no button for that.
 */

export type StartHome = ArnoldDashboardView["home"];
export type StartData = {
  /** The dashboard overview; undefined while unread or when the read failed. */
  home?: StartHome;
  /** Number of paired watches; undefined while unknown. */
  watches?: number;
};

export const OPEN = "noch offen";

/** Reads the overview and the watches once; a failed read stays unknown. */
export function useStartData(client: ArnoldMcpClient): StartData {
  const [data, setData] = useState<StartData>({});
  useEffect(() => {
    let alive = true;
    void client
      .dashboard()
      .then((view) => alive && setData((d) => ({ ...d, home: view.home })))
      .catch(() => {});
    void client
      .listGarminWatches()
      .then(
        (w) => alive && setData((d) => ({ ...d, watches: w.watches.length })),
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client]);
  return data;
}

export function StartCard({
  client,
  state,
  data,
}: {
  client: ArnoldMcpClient;
  state: OnboardingState;
  data: StartData;
}) {
  const [failure, setFailure] = useState("");
  const { profile } = state.session;
  const { training } = profile;
  const known = personLine(profile.person);
  const next = data.home?.next_session ?? null;
  const goal = data.home?.streak.weekly_goal ?? null;
  const days = data.home?.streak.current_week_training_days;
  const goals = [training.primary_goal, ...(training.secondary_goals ?? [])]
    .filter((g): g is NonNullable<typeof g> => !!g)
    .map((g) => GOAL_LABEL[g]);
  const stored = normalizeKnownLoads(training.known_loads);
  const maxima = KNOWN_LOAD_LIFTS.flatMap((lift) => {
    const entry = stored[lift];
    const name = state.exercise_choices.find(
      (c) => c.exercise_id === lift,
    )?.name_de;
    return entry && name
      ? [`${name} ca. ${formatNumber(entry.kg, 1)} kg × ${entry.reps}`]
      : [];
  });

  const open = async (card: "today" | "plan") => {
    setFailure("");
    try {
      await client.openDashboard(card);
    } catch {
      setFailure("Das hat gerade nicht geklappt. Versuch es noch einmal.");
    }
  };

  return (
    <CardFrame tag="Start" title="Arnold ist bereit" card="start">
      {known && <SummaryLine label="Eckdaten">{known}</SummaryLine>}
      <SummaryLine label="Module">
        {modulesLine(modulesOf(training))}
      </SummaryLine>
      <SummaryLine label="Nächste Einheit">
        {next
          ? `${next.session_name}, ${next.exercise_count} ${next.exercise_count === 1 ? "Übung" : "Übungen"}`
          : OPEN}
      </SummaryLine>
      {goal !== null && days !== undefined && (
        <SummaryLine label="Woche">
          {days} von {goal} Trainingstagen
        </SummaryLine>
      )}
      <SummaryLine label="Ziele">
        {goals.length ? goals.join(", ") : OPEN}
      </SummaryLine>
      <SummaryLine label="Richtwerte (geschätzt)">
        {maxima.length ? maxima.join("; ") : `${OPEN}, Arnold schätzt sie`}
      </SummaryLine>
      {data.watches !== undefined && (
        <SummaryLine label="Uhr">
          {data.watches > 0
            ? "Verbunden. Öffne Arnold auf der Uhr."
            : "Noch nicht verbunden. Du kannst sie jederzeit später verbinden."}
        </SummaryLine>
      )}
      <p className="oc-status" role="status" aria-live="polite">
        {failure ? (
          <span className="cc-line warn">
            <TriangleAlert size={15} aria-hidden="true" />
            {failure}
          </span>
        ) : null}
      </p>
      <div className="ac-actions">
        <button
          type="button"
          className="ac-btn primary"
          onClick={(event) => {
            event.stopPropagation();
            void open("today");
          }}
        >
          Einheit ansehen
        </button>
        <button
          type="button"
          className="ac-btn secondary"
          onClick={(event) => {
            event.stopPropagation();
            void open("plan");
          }}
        >
          Plan öffnen
        </button>
      </div>
    </CardFrame>
  );
}

/** The card with its own reads. */
export function StartCardLoader({
  client,
  state,
}: {
  client: ArnoldMcpClient;
  state: OnboardingState;
}) {
  const data = useStartData(client);
  return <StartCard client={client} state={state} data={data} />;
}
