import type { RunAnalysisResponse } from "../../shared/run-contract";
import type { RunCard } from "../../shared/run-card-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldCard, CardActions, CardNote, Rows } from "../components/cards";
import { dateLabel, formatNumber } from "../format";
import { useModelContext } from "../hooks/useModelContext";
import { runStatsContext } from "../run-model-context";
import {
  UNKNOWN,
  clockLabel,
  distanceLabel,
  num,
  paceLabel,
  partialNote,
  percentLabel,
  readMetric,
  readSum,
  reasonText,
  type Sum,
} from "./format";
import { Loaded, browserZone, useRunData } from "./shared";

const BASIS_LABEL = {
  hr: "nach Puls",
  run_type: "nach Lauftyp",
  mixed: "nach Puls und Lauftyp",
} as const;

/** A sum with the server's own "aus x von y Läufen"; unknown with its reason. */
function sumRow(
  key: string,
  label: string,
  sum: Sum,
  format: (n: number) => string,
) {
  const note = partialNote(sum);
  return {
    key,
    label,
    value:
      sum.value === null ? (
        <span title={reasonText(sum.reason)}>
          {UNKNOWN} <span className="ac-caption">{reasonText(sum.reason)}</span>
        </span>
      ) : (
        <span>
          {format(sum.value)}
          {note && <span className="ac-caption"> {note}</span>}
        </span>
      ),
  };
}

function WeekBlock({ week }: { week: RunAnalysisResponse["weeks"][number] }) {
  const running = week.running;
  const count = num(running.run_count) ?? 0;
  const pace = readMetric(running, "pace_s_per_km");
  const intensity = (running.intensity ?? {}) as Record<string, unknown>;
  const share = readMetric(intensity, "share");
  const shareValue = share.value as {
    low?: unknown;
    moderate?: unknown;
    high?: unknown;
  } | null;
  const basis = BASIS_LABEL[intensity.basis as keyof typeof BASIS_LABEL];
  const fulfil = (running.fulfilment ?? {}) as Record<string, unknown>;
  const rate = readMetric(fulfil, "rate");
  const planned = num(fulfil.planned);
  const completed = num(fulfil.completed);
  return (
    <section
      className="run-week-block"
      aria-label={`Woche ab ${dateLabel(week.week_start)}`}
    >
      <h3 className="run-week-title">
        {dateLabel(week.week_start)} bis {dateLabel(week.week_end)}
      </h3>
      {count === 0 ? (
        <p className="ac-caption">Keine Läufe gelaufen.</p>
      ) : (
        <Rows
          items={[
            { key: "count", label: "Läufe", value: String(count) },
            sumRow(
              "dist",
              "Distanz",
              readSum(running, "distance_m"),
              distanceLabel,
            ),
            sumRow("time", "Zeit", readSum(running, "timer_s"), clockLabel),
            {
              key: "pace",
              label: "Tempo (Ø)",
              value:
                num(pace.value) === null ? (
                  <span>
                    {UNKNOWN}{" "}
                    <span className="ac-caption">
                      {reasonText(pace.reason)}
                    </span>
                  </span>
                ) : (
                  paceLabel(num(pace.value))
                ),
            },
            {
              key: "intensity",
              label: `Intensität${basis ? ` (${basis})` : ""}`,
              value:
                shareValue && num(shareValue.low) !== null ? (
                  `leicht ${percentLabel(num(shareValue.low))} · mittel ${percentLabel(num(shareValue.moderate))} · hart ${percentLabel(num(shareValue.high))}`
                ) : (
                  <span>
                    {UNKNOWN}{" "}
                    <span className="ac-caption">
                      {reasonText(share.reason)}
                    </span>
                  </span>
                ),
            },
          ]}
        />
      )}
      {planned !== null && planned > 0 && (
        <p className="ac-caption">
          Geplant: {completed ?? UNKNOWN} von {planned} erledigt
          {num(rate.value) !== null
            ? ` · Erfüllung ${percentLabel(num(rate.value))}`
            : ""}
        </p>
      )}
      <p className="ac-caption">
        Kraft daneben: {week.strength.workouts}{" "}
        {week.strength.workouts === 1 ? "Einheit" : "Einheiten"},{" "}
        {week.strength.working_sets} Arbeitssätze
      </p>
    </section>
  );
}

/**
 * The last four weeks of running from `get_run_analysis(view: four_weeks)`.
 * Sums that only some runs feed say "aus x von y Läufen"; the 7:28 ratio is
 * unknown with its reason until 28 days of history exist. Nothing is scaled.
 */
export function RunStatsCard({
  client,
  onOpen,
}: {
  client: ArnoldMcpClient;
  onOpen: (card: RunCard, workoutId?: string) => void;
}) {
  const zone = browserZone();
  const state = useRunData(
    () =>
      client.runAnalysis({
        view: "four_weeks",
        timezone: zone,
      }),
    [client, zone],
  );
  useModelContext(client, state.data ? runStatsContext(state.data) : undefined);

  return (
    <Loaded state={state}>
      {(analysis) => {
        const rawRatio = (analysis.load_ratio ?? {}) as Record<string, unknown>;
        const ratioValue = rawRatio.value as {
          ratio?: unknown;
          known_runs?: unknown;
          total_runs?: unknown;
        } | null;
        const ratioNumber = num(ratioValue?.ratio);
        const knownRuns = num(ratioValue?.known_runs);
        const totalRuns = num(ratioValue?.total_runs);
        const reason =
          typeof rawRatio.reason === "string" ? rawRatio.reason : null;
        const partial =
          knownRuns !== null && totalRuns !== null && knownRuns < totalRuns
            ? `aus ${knownRuns} von ${totalRuns} ${totalRuns === 1 ? "Lauf" : "Läufen"}`
            : "";
        if (analysis.weeks.length === 0)
          return (
            <main
              className="arnold-cards"
              id="main-content"
              data-card="run_stats"
            >
              <ArnoldCard
                label="Laufverlauf"
                title="Noch kein Verlauf"
                subtitle="Sobald Läufe gespeichert sind, erscheinen hier die Wochen."
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
        return (
          <main
            className="arnold-cards"
            id="main-content"
            data-card="run_stats"
          >
            <ArnoldCard
              label="Laufverlauf"
              title="Die letzten vier Wochen"
              subtitle={`Bis ${dateLabel(analysis.reference_date, true)}`}
            >
              <Rows
                label="Belastung"
                items={[
                  {
                    key: "ratio",
                    label: "Belastung 7 : 28 Tage",
                    value:
                      ratioNumber === null ? (
                        <span>
                          {UNKNOWN}{" "}
                          <span className="ac-caption">
                            {reasonText(reason)}
                          </span>
                        </span>
                      ) : (
                        <span>
                          {formatNumber(ratioNumber, 2)}
                          {partial && (
                            <span className="ac-caption"> {partial}</span>
                          )}
                        </span>
                      ),
                  },
                ]}
              />
              <p className="ac-caption">
                Das Verhältnis ist eine Orientierung, keine Diagnose.
              </p>
              {analysis.weeks.map((week) => (
                <WeekBlock key={week.week_start} week={week} />
              ))}
              {analysis.notes
                .filter((n) => !n.startsWith("Krafttraining steht daneben"))
                .map((n) => (
                  <CardNote key={n}>{n}</CardNote>
                ))}
              <CardActions
                primary={{
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
