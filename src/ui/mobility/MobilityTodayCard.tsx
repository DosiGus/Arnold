import { useState } from "react";
import { CheckCircle2, Dumbbell } from "lucide-react";
import type { MobilityCard } from "../../shared/mobility-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldCard, CardActions, CardNote, Rows } from "../components/cards";
import { CardTag, SayHint } from "../components/conversation-cards";
import { dateLabel } from "../format";
import { useModelContext } from "../hooks/useModelContext";
import { mobilityTodayContext } from "../mobility-model-context";
import { Loaded, browserZone, useRunData } from "../run/shared";
import { KIND_LABEL, exerciseName, itemText } from "./format";
import { WriteError, useMobilityWrite } from "./shared";

/**
 * Today's morning routine and mobility session with their exercises. "Erledigt"
 * first asks, then calls `log_mobility` once; the seconds and minutes shown are
 * the server's template, nothing is calculated here.
 */
export function MobilityTodayCard({
  client,
  onOpen,
}: {
  client: ArnoldMcpClient;
  onOpen: (card: MobilityCard, workoutId?: string) => void;
}) {
  const zone = browserZone();
  const [asking, setAsking] = useState<string>();
  const write = useMobilityWrite(client);
  const state = useRunData(() => client.mobilityOverview(zone), [client, zone]);
  useModelContext(
    client,
    state.data ? mobilityTodayContext(state.data) : undefined,
  );

  return (
    <Loaded state={state}>
      {(overview) => {
        const items = overview.today.items;
        if (items.length === 0)
          return (
            <main
              className="arnold-cards"
              id="main-content"
              data-card="mobility_today"
            >
              <ArnoldCard
                label={<CardTag>Status</CardTag>}
                title="Heute steht keine Mobility an"
                subtitle={
                  overview.profile.state === "yes"
                    ? "In deinem Plan ist für heute nichts geplant."
                    : overview.profile.state === "no"
                      ? "Du hast bisher Nein gesagt. Das kannst du jederzeit ändern."
                      : "Du hast noch nicht gesagt, ob Mobility dazukommen soll."
                }
              >
                <SayHint>Bau mir die Morgenroutine in den Plan.</SayHint>
                <CardActions
                  primary={{
                    label: "Mobility einrichten",
                    onClick: () => onOpen("mobility_setup"),
                  }}
                />
              </ArnoldCard>
            </main>
          );
        const confirm = items.find((i) => i.session_id === asking);
        const log = async () => {
          if (!confirm) return;
          const out = await write.send("log_mobility", {
            kind: confirm.kind,
            session_id: confirm.session_id,
            timezone: zone,
          });
          if (out?.ok) {
            setAsking(undefined);
            state.reload();
          }
        };
        return (
          <main
            className="arnold-cards"
            id="main-content"
            data-card="mobility_today"
          >
            <ArnoldCard
              label={<CardTag icon={<Dumbbell size={13} />}>Status</CardTag>}
              title="Mobility heute"
              subtitle={dateLabel(overview.today.date_local, true)}
            >
              {items.map((item) => (
                <section
                  key={item.session_id}
                  className="ac-block"
                  aria-label={item.session_name}
                >
                  <div className="ac-head">
                    <h3 className="ac-section-title">{item.session_name}</h3>
                    {item.done ? (
                      <span className="ac-pill ok">
                        <CheckCircle2 size={13} aria-hidden="true" /> Erledigt
                      </span>
                    ) : (
                      <span className="ac-pill muted">Offen</span>
                    )}
                  </div>
                  <p className="ac-caption">
                    {KIND_LABEL[item.kind]} · {item.minutes} Min.
                  </p>
                  <Rows
                    label={`Übungen: ${item.session_name}`}
                    items={item.template.items.map((ex, i) => ({
                      key: `${ex.exercise_id}-${i}`,
                      label: exerciseName(ex.exercise_id),
                      value: itemText(ex),
                    }))}
                  />
                  {!item.done && (
                    <CardActions
                      primary={{
                        label: "Erledigt",
                        ariaLabel: `Erledigt: ${item.session_name}`,
                        disabled: write.busy,
                        onClick: () => {
                          write.clear();
                          setAsking(item.session_id);
                        },
                      }}
                    />
                  )}
                </section>
              ))}
              {confirm && (
                <div role="group" aria-label="Erledigt eintragen?">
                  <CardNote>
                    Soll Arnold „{confirm.session_name}“ für heute als erledigt
                    eintragen?
                  </CardNote>
                  <CardActions
                    primary={{
                      label: write.busy
                        ? "Wird gespeichert …"
                        : "Ja, eintragen",
                      disabled: write.busy,
                      onClick: () => void log(),
                    }}
                    secondary={{
                      label: "Abbrechen",
                      disabled: write.busy,
                      onClick: () => {
                        write.clear();
                        setAsking(undefined);
                      },
                    }}
                  />
                </div>
              )}
              <WriteError error={write.error} />
            </ArnoldCard>
          </main>
        );
      }}
    </Loaded>
  );
}
