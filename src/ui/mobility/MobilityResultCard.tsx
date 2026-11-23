import type { MobilityCard } from "../../shared/mobility-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldCard, CardActions, Rows } from "../components/cards";
import { CardTag, SayHint } from "../components/conversation-cards";
import { dateLabel } from "../format";
import { useModelContext } from "../hooks/useModelContext";
import { mobilityResultContext } from "../mobility-model-context";
import { Loaded, browserZone, useRunData } from "../run/shared";
import { KIND_LABEL, UNKNOWN, durationText } from "./format";

/**
 * The result of a routine: the chosen one, otherwise the latest. Duration and
 * exercises are what the server stored; an unknown duration is "unbekannt".
 * The "Dranbleiben" sentence is built from the server's counts; without a plan
 * (`ratio` null) it says so instead of showing 0.
 */
export function MobilityResultCard({
  client,
  workoutId,
  onOpen,
}: {
  client: ArnoldMcpClient;
  workoutId: string | null;
  onOpen: (card: MobilityCard, workoutId?: string) => void;
}) {
  const zone = browserZone();
  const state = useRunData(() => client.mobilityOverview(zone), [client, zone]);
  useModelContext(
    client,
    state.data ? mobilityResultContext(state.data, workoutId) : undefined,
  );
  return (
    <Loaded state={state}>
      {(overview) => {
        const recent =
          overview.recent.find((r) => r.workout_id === workoutId) ??
          (workoutId ? undefined : overview.recent[0]);
        const a = overview.adherence;
        const stay =
          a.ratio === null
            ? "Dranbleiben: noch kein Plan."
            : `Dranbleiben: ${a.done_count} von ${a.planned_count} Routinen in ${a.days} Tagen${a.streak_days > 0 ? `, ${a.streak_days} ${a.streak_days === 1 ? "Tag" : "Tage"} in Folge` : ""}.`;
        if (!recent)
          return (
            <main
              className="arnold-cards"
              id="main-content"
              data-card="mobility_result"
            >
              <ArnoldCard
                label={<CardTag>Status</CardTag>}
                title="Noch kein Ergebnis"
                subtitle={
                  workoutId
                    ? "Diese Routine finde ich nicht in deinen letzten Routinen."
                    : "Sobald du eine Routine gemacht hast, steht sie hier."
                }
              >
                <p className="ac-caption">{stay}</p>
                <SayHint>Morgenroutine gemacht.</SayHint>
                <CardActions
                  primary={{
                    label: "Heute ansehen",
                    onClick: () => onOpen("mobility_today"),
                  }}
                />
              </ArnoldCard>
            </main>
          );
        return (
          <main
            className="arnold-cards"
            id="main-content"
            data-card="mobility_result"
          >
            <ArnoldCard
              label={<CardTag>Status</CardTag>}
              title={recent.session_name ?? KIND_LABEL[recent.kind]}
              subtitle={dateLabel(recent.date_local, true)}
            >
              <Rows
                label="Ergebnis"
                items={[
                  { key: "kind", label: "Art", value: KIND_LABEL[recent.kind] },
                  {
                    key: "duration",
                    label: "Dauer",
                    value: durationText(recent.timer_s),
                  },
                  {
                    key: "exercises",
                    label: "Übungen",
                    value:
                      recent.exercises_total > 0
                        ? `${recent.exercises_done} von ${recent.exercises_total}`
                        : UNKNOWN,
                  },
                  {
                    key: "source",
                    label: "Quelle",
                    value: recent.source === "watch" ? "Uhr" : "Chat",
                  },
                ]}
              />
              <p className="ac-caption" data-testid="stay">
                {stay}
              </p>
              <CardActions
                primary={{
                  label: "Heute ansehen",
                  onClick: () => onOpen("mobility_today"),
                }}
              />
            </ArnoldCard>
          </main>
        );
      }}
    </Loaded>
  );
}
