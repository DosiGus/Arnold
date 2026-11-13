import type { RunAnalysisResponse } from "../../shared/run-contract";
import type { RunCard } from "../../shared/run-card-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldCard, CardActions, CardNote, Rows } from "../components/cards";
import { dateLabel, formatNumber } from "../format";
import { useModelContext } from "../hooks/useModelContext";
import { runResultContext } from "../run-model-context";
import {
  ENVIRONMENT_LABEL,
  RUN_TYPE_LABEL,
  UNKNOWN,
  clockLabel,
  distanceLabel,
  num,
  paceLabel,
  percentLabel,
  readMetric,
  reasonText,
} from "./format";
import { Loaded, browserZone, useRunData } from "./shared";

const BEST_LABEL: Record<string, string> = {
  "1k": "1 km",
  "5k": "5 km",
  "10k": "10 km",
  half_marathon: "Halbmarathon",
};
const HR_STATUS_LABEL: Record<string, string> = {
  recorded: "",
  no_consent:
    "Ohne deine Einwilligung für Gesundheitsdaten nutzt Arnold keinen Puls.",
  no_sensor: "Kein Pulssensor verbunden.",
  not_provided: "Kein Puls angegeben.",
  consent_revoked: "Die Einwilligung für den Puls ist widerrufen.",
};

type Loadout = { analysis: RunAnalysisResponse } | { none: true };

/** A value of a metric, or UNKNOWN with the reason underneath. */
function metricValue(
  metrics: unknown,
  key: string,
  format: (n: number) => string,
) {
  const m = readMetric(metrics, key);
  const n = num(m.value);
  return n === null
    ? { text: UNKNOWN, reason: reasonText(m.reason) }
    : { text: format(n), reason: "" };
}

/**
 * The result of one run, from `get_run_analysis(view: run)`. Every figure is
 * what Arnold delivered; a missing one is "–" with its reason, never 0. Without
 * the heart-rate consent the zone is the server's own sentence ("Zone 2 laut
 * Uhr"), not a number.
 */
export function RunResultCard({
  client,
  workoutId,
  onOpen,
}: {
  client: ArnoldMcpClient;
  workoutId: string | null;
  onOpen: (card: RunCard, workoutId?: string) => void;
}) {
  const zone = browserZone();
  const state = useRunData<Loadout>(async () => {
    let id = workoutId;
    if (!id) {
      const week = await client.runWeek({ timezone: zone });
      const done = week.days
        .flatMap((d) => d.runs)
        .filter((r) => r.status === "completed" && r.workout_id);
      id = done.length ? (done[done.length - 1].workout_id as string) : null;
    }
    if (!id) return { none: true };
    return {
      analysis: await client.runAnalysis({
        view: "run",
        workout_id: id,
        timezone: zone,
      }),
    };
  }, [client, zone, workoutId]);
  useModelContext(
    client,
    state.data && "analysis" in state.data
      ? runResultContext(state.data.analysis)
      : undefined,
  );

  return (
    <Loaded state={state}>
      {(data) => {
        const run = "analysis" in data ? data.analysis.run : null;
        if (!run)
          return (
            <main
              className="arnold-cards"
              id="main-content"
              data-card="run_result"
            >
              <ArnoldCard
                label="Lauf"
                title="Noch kein Lauf gelaufen"
                subtitle="Sobald ein Lauf gespeichert ist, erscheint hier sein Ergebnis."
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
        const { view, metrics } = run;
        const result = view.result;
        const completed = view.status === "completed" && result !== null;
        const distance = metricValue(metrics, "distance_m", distanceLabel);
        const timer = metricValue(metrics, "timer_s", clockLabel);
        const pace = metricValue(metrics, "pace_s_per_km", paceLabel);
        const fulfilment = readMetric(metrics, "fulfilment");
        const zones = readMetric(metrics, "zones");
        const zoneValue = zones.value as {
          seconds?: unknown;
          share?: unknown;
        } | null;
        const zoneSeconds = Array.isArray(zoneValue?.seconds)
          ? (zoneValue.seconds as unknown[])
          : null;
        const zoneShare = Array.isArray(zoneValue?.share)
          ? (zoneValue.share as unknown[])
          : null;
        const load = readMetric(
          (metrics as Record<string, unknown>).load,
          "primary",
        );
        const loadValue = load.value as {
          basis?: unknown;
          value?: unknown;
        } | null;
        const loadNumber = num(loadValue?.value);
        const km = readMetric(metrics, "kilometre_times_s");
        const kmTimes = Array.isArray(km.value)
          ? (km.value as unknown[])
          : null;
        const bestRecord =
          (metrics as Record<string, unknown>).best_efforts &&
          typeof (metrics as Record<string, unknown>).best_efforts === "object"
            ? ((metrics as Record<string, unknown>).best_efforts as Record<
                string,
                unknown
              >)
            : {};
        const bests = Object.keys(BEST_LABEL).flatMap((key) => {
          const best = readMetric(bestRecord, key);
          const v = best.value as { time_s?: unknown } | null;
          const t = num(v?.time_s);
          return t === null ? [] : [{ key, time: t }];
        });
        const hrNote = result ? HR_STATUS_LABEL[result.hr_status] : "";
        return (
          <main
            className="arnold-cards"
            id="main-content"
            data-card="run_result"
          >
            <ArnoldCard
              label="Lauf-Ergebnis"
              aside={
                <span className="ac-pill muted">
                  {completed ? "Gelaufen" : "Nicht gelaufen"}
                </span>
              }
              title={view.name ?? RUN_TYPE_LABEL[view.run_type]}
              subtitle={`${dateLabel(view.workout_date_local, true)} · ${ENVIRONMENT_LABEL[view.environment]}`}
            >
              {!completed && (
                <CardNote>
                  Dieser Lauf ist noch nicht gelaufen. Es gibt keine Kennzahlen.
                </CardNote>
              )}
              {completed && (
                <>
                  <Rows
                    label="Ergebnis"
                    items={[
                      {
                        key: "distance",
                        label: "Distanz",
                        value: distance.text,
                      },
                      { key: "timer", label: "Zeit", value: timer.text },
                      { key: "pace", label: "Tempo", value: pace.text },
                      {
                        key: "rpe",
                        label: "Anstrengung (1–10)",
                        value:
                          result.rpe === null ? UNKNOWN : String(result.rpe),
                      },
                      {
                        key: "hr",
                        label: "Puls Ø / max.",
                        value:
                          result.hr_avg_bpm === null &&
                          result.hr_max_bpm === null
                            ? UNKNOWN
                            : `${result.hr_avg_bpm ?? UNKNOWN} / ${result.hr_max_bpm ?? UNKNOWN} /min`,
                      },
                      {
                        key: "load",
                        label: `Belastung${loadValue?.basis === "edwards" ? " (Edwards)" : loadValue?.basis === "srpe" ? " (sRPE)" : ""}`,
                        value:
                          loadNumber === null
                            ? UNKNOWN
                            : formatNumber(loadNumber, 0),
                      },
                      {
                        key: "fulfilment",
                        label: "Vorgabe erfüllt",
                        value: percentLabel(num(fulfilment.value)),
                      },
                    ]}
                  />
                  {distance.reason && (
                    <p className="ac-caption">Distanz: {distance.reason}</p>
                  )}
                  {timer.reason && (
                    <p className="ac-caption">Zeit: {timer.reason}</p>
                  )}
                  {result.rpe === null && (
                    <p className="ac-caption">
                      Die Anstrengung fehlt; ohne sie ist die Belastung nur über
                      den Puls bekannt.
                    </p>
                  )}
                  {view.hint && <p className="ac-text">{view.hint}</p>}
                  {zoneSeconds && zoneShare ? (
                    <>
                      <p className="ac-caption">Zeit in den Pulszonen</p>
                      <Rows
                        label="Zeit in den Pulszonen"
                        items={zoneSeconds.map((s, i) => ({
                          key: `z${i + 1}`,
                          label: `Zone ${i + 1}`,
                          value: `${clockLabel(num(s))} · ${percentLabel(num(zoneShare[i]))}`,
                        }))}
                      />
                    </>
                  ) : (
                    <p className="ac-caption" data-testid="zones-unknown">
                      Pulszonen: {hrNote || reasonText(zones.reason)}
                    </p>
                  )}
                  {bests.length > 0 && (
                    <>
                      <p className="ac-caption">Bestzeiten in diesem Lauf</p>
                      <Rows
                        label="Bestzeiten in diesem Lauf"
                        items={bests.map((b) => ({
                          key: b.key,
                          label: BEST_LABEL[b.key],
                          value: clockLabel(b.time),
                        }))}
                      />
                    </>
                  )}
                  {kmTimes && kmTimes.length > 0 && (
                    <>
                      <p className="ac-caption">Kilometerzeiten</p>
                      <Rows
                        label="Kilometerzeiten"
                        items={kmTimes.map((t, i) => ({
                          key: `km${i + 1}`,
                          label: `Km ${i + 1}`,
                          value: clockLabel(num(t)),
                        }))}
                      />
                    </>
                  )}
                  {view.unknown.length > 0 && (
                    <ul className="run-notes" aria-label="Nicht bekannt">
                      {view.unknown.map((u) => (
                        <li key={u.field} className="ac-caption">
                          {u.field}: {reasonText(u.reason)}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <CardActions
                primary={{
                  label: "Verlauf ansehen",
                  onClick: () => onOpen("run_stats"),
                }}
                secondary={{
                  label: "Woche ansehen",
                  onClick: () => onOpen("run_week"),
                }}
              />
            </ArnoldCard>
          </main>
        );
      }}
    </Loaded>
  );
}
