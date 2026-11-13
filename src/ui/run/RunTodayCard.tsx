import { useState } from "react";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import {
  ArnoldCard,
  CardActions,
  CardNote,
  Rows,
  Stepper,
} from "../components/cards";
import { dateLabel } from "../format";
import { useModelContext } from "../hooks/useModelContext";
import { runTodayContext } from "../run-model-context";
import type { RunCard } from "../../shared/run-card-contract";
import {
  ENVIRONMENT_LABEL,
  RUN_TYPE_LABEL,
  UNKNOWN,
  minutesLabel,
} from "./format";
import {
  Loaded,
  WriteError,
  browserZone,
  useRunData,
  useRunWrite,
} from "./shared";

/**
 * The run of today (or the next planned one). The two buttons only call
 * `update_planned_run`; Arnold computes the new prescription. The minutes of
 * "Kürzer" are the user's own choice and can only go below what is planned.
 */
export function RunTodayCard({
  client,
  onOpen,
}: {
  client: ArnoldMcpClient;
  onOpen: (card: RunCard, workoutId?: string) => void;
}) {
  const zone = browserZone();
  const [mode, setMode] = useState<"shorter" | "move">();
  const [minutes, setMinutes] = useState<number>();
  const [day, setDay] = useState("");
  const [saved, setSaved] = useState("");
  const write = useRunWrite(client);
  const state = useRunData(async () => {
    const week = await client.runWeek({ timezone: zone });
    const upcoming = week.days
      .filter((d) => d.date >= week.today)
      .flatMap((d) =>
        d.runs.map((run) => ({ ...run, date: d.date, is_today: d.is_today })),
      )
      .filter((r) => r.workout_id && r.status !== "cancelled");
    const chosen =
      upcoming.find((r) => r.is_today && r.status === "planned") ??
      upcoming.find((r) => r.is_today) ??
      upcoming.find((r) => r.status === "planned");
    const analysis = chosen?.workout_id
      ? await client.runAnalysis({
          view: "run",
          workout_id: chosen.workout_id,
          timezone: zone,
        })
      : null;
    return { week, chosen, view: analysis?.run?.view ?? null };
  }, [client, zone]);
  useModelContext(
    client,
    state.data
      ? runTodayContext(state.data.view ?? undefined, state.data.week.today)
      : undefined,
  );

  return (
    <Loaded state={state}>
      {({ week, chosen, view }) => {
        if (!chosen || !view)
          return (
            <main
              className="arnold-cards"
              id="main-content"
              data-card="run_today"
            >
              <ArnoldCard
                label="Lauf"
                title="Heute ist kein Lauf geplant"
                subtitle="Plane einen Lauf oder deine Laufwoche im Chat oder hier."
              >
                <CardActions
                  primary={{
                    label: "Woche ansehen",
                    onClick: () => onOpen("run_week"),
                  }}
                />
              </ArnoldCard>
            </main>
          );
        const isToday = chosen.date === week.today;
        const planned = view.planned?.total_s ?? null;
        const plannedMin = planned === null ? null : Math.round(planned / 60);
        const canChange = view.status === "planned";
        const shown = minutes ?? plannedMin ?? 0;
        const finish = async (
          input: Record<string, unknown>,
          label: string,
        ) => {
          const out = await write.send("update_planned_run", {
            workout_id: view.workout_id,
            expected_row_revision: view.row_revision,
            ...input,
          });
          if (out.ok) {
            setSaved(label);
            setMode(undefined);
            setMinutes(undefined);
            setDay("");
            state.reload();
          }
        };
        return (
          <main
            className="arnold-cards"
            id="main-content"
            data-card="run_today"
          >
            <ArnoldCard
              label={isToday ? "Heutiger Lauf" : "Nächster Lauf"}
              aside={
                <span className="ac-pill muted">
                  {view.status === "completed" ? "Gelaufen" : "Geplant"}
                </span>
              }
              title={view.name ?? RUN_TYPE_LABEL[view.run_type]}
              subtitle={`${dateLabel(view.workout_date_local, true)} · ${ENVIRONMENT_LABEL[view.environment]}`}
            >
              <Rows
                label="Vorgabe"
                items={[
                  {
                    key: "type",
                    label: "Art",
                    value: RUN_TYPE_LABEL[view.run_type],
                  },
                  {
                    key: "minutes",
                    label: "Dauer",
                    value:
                      planned === null ? UNKNOWN : minutesLabel(planned / 60),
                  },
                  ...(chosen.level !== null
                    ? [
                        {
                          key: "level",
                          label: "Stufe",
                          value: String(chosen.level),
                        },
                      ]
                    : []),
                ]}
              />
              {view.hint && <p className="ac-text">{view.hint}</p>}
              {chosen.changed && (
                <p className="ac-caption">
                  Arnold hat diese Einheit für diese Woche angepasst.
                </p>
              )}
              {planned === null && canChange && (
                <CardNote>
                  Die geplante Dauer ist nicht bekannt. Kürzen geht erst, wenn
                  sie bekannt ist.
                </CardNote>
              )}
              {mode === "shorter" && plannedMin !== null && (
                <div className="run-panel">
                  <Stepper
                    label="Neue Dauer"
                    unit="Min."
                    step={5}
                    min={5}
                    max={plannedMin}
                    value={shown}
                    onChange={setMinutes}
                  />
                  <p className="ac-caption">
                    Arnold berechnet Abschnitte, Tempi und Pulsbereiche neu.
                  </p>
                  <CardActions
                    primary={{
                      label: write.busy
                        ? "Wird gespeichert …"
                        : "Kürzer speichern",
                      disabled: write.busy || shown >= plannedMin,
                      onClick: () =>
                        void finish(
                          { run_type: view.run_type, minutes: shown },
                          "Gekürzt und gespeichert.",
                        ),
                    }}
                    secondary={{
                      label: "Abbrechen",
                      onClick: () => setMode(undefined),
                    }}
                  />
                </div>
              )}
              {mode === "move" && (
                <div className="run-panel">
                  <label className="ac-field">
                    <span>Neuer Tag</span>
                    <input
                      type="date"
                      value={day}
                      min={week.today}
                      onChange={(e) => setDay(e.target.value)}
                    />
                  </label>
                  <CardActions
                    primary={{
                      label: write.busy ? "Wird gespeichert …" : "Verschieben",
                      disabled:
                        write.busy || !day || day === view.workout_date_local,
                      onClick: () =>
                        void finish(
                          { workout_date_local: day, timezone: zone },
                          "Verschoben und gespeichert.",
                        ),
                    }}
                    secondary={{
                      label: "Abbrechen",
                      onClick: () => setMode(undefined),
                    }}
                  />
                </div>
              )}
              <WriteError error={write.error} />
              {saved && !write.error && (
                <p className="ac-caption" role="status">
                  {saved}
                </p>
              )}
              {!mode && view.status === "completed" && (
                <CardActions
                  primary={{
                    label: "Ergebnis ansehen",
                    onClick: () => onOpen("run_result", view.workout_id),
                  }}
                />
              )}
              {!mode && canChange && (
                <CardActions
                  primary={{
                    label: "Kürzer",
                    disabled: plannedMin === null,
                    onClick: () => {
                      setSaved("");
                      write.clear();
                      setMode("shorter");
                    },
                  }}
                  secondary={{
                    label: "Verschieben",
                    onClick: () => {
                      setSaved("");
                      write.clear();
                      setMode("move");
                    },
                  }}
                />
              )}
            </ArnoldCard>
          </main>
        );
      }}
    </Loaded>
  );
}
