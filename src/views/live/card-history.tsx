/**
 * The chat cards "Verlauf einer Übung" (`get_arnold_exercise_progress`) and
 * "Alle Einheiten" (`get_arnold_workouts`). Reading only; corrections go
 * through the chat.
 */
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { Select } from "@openai/apps-sdk-ui/components/Select";
import { useState } from "react";
import { DataLLM } from "skybridge/web";
import {
  ArnoldExerciseProgressViewSchema,
  ArnoldWorkoutHistoryViewSchema,
  type ArnoldDashboardView,
  type ProgressMetricKey,
  type ViewWorkoutDetail,
} from "../../shared/arnold-view.js";
import { WorkoutContextSchema } from "../../shared/workout-contract.js";
import { useArnoldTool } from "../arnold-client.js";
import {
  appendWorkouts,
  historyEntry,
  PROGRESS_METRICS,
  progressChoices,
  progressModel,
} from "../model/history.js";
import { Chart } from "../onboarding/screens.js";
import { Box, Card, Loading, LoadError, Note, useLoad } from "./card-kit.js";

export function ProgressCard({
  source,
  exerciseId,
  metric: wanted,
  onBack,
}: {
  source: ArnoldDashboardView;
  exerciseId: string | null;
  metric: ProgressMetricKey | null;
  onBack: () => void;
}) {
  const choices = progressChoices(source);
  const [exercise, setExercise] = useState(
    exerciseId ?? choices[0]?.value ?? null,
  );
  const [metric, setMetric] = useState<ProgressMetricKey>(wanted ?? "max_load");
  const progress = useArnoldTool(
    "get_arnold_exercise_progress",
    ArnoldExerciseProgressViewSchema,
  );
  const load = useLoad(
    async () =>
      exercise
        ? progressModel(await progress.call({ exercise_id: exercise, metric }))
        : null,
    [exercise, metric],
  );
  const title = "Übungsverlauf";
  if (!exercise)
    return (
      <Card title={title} onBack={onBack}>
        <Box>
          <Note>Dein Verlauf beginnt mit dem ersten gespeicherten Satz.</Note>
        </Box>
      </Card>
    );
  const m = load.data;
  return (
    <Card title={title} onBack={onBack}>
      <Select
        block
        options={choices}
        value={exercise}
        onChange={(o) => setExercise(o.value)}
      />
      <SegmentedControl
        aria-label="Kennzahl"
        block
        pill
        value={metric}
        onChange={(v) => setMetric(v as ProgressMetricKey)}
      >
        {PROGRESS_METRICS.map((x) => (
          <SegmentedControl.Option key={x.value} value={x.value}>
            {x.label}
          </SegmentedControl.Option>
        ))}
      </SegmentedControl>
      {load.failed ? (
        <Button
          color="secondary"
          variant="soft"
          block
          onClick={() => void load.reload()}
        >
          Verlauf erneut laden
        </Button>
      ) : !m ? (
        <p role="status" className="m-0 text-secondary">
          Wird geladen …
        </p>
      ) : (
        <DataLLM
          content={`Übungsverlauf-Karte: ${m.name}, ${m.caption}: ${m.value}. Die Karte zeigt die Werte bereits.`}
        >
          <Box>
            <div className="flex flex-col">
              <span className="font-medium">{m.name}</span>
              <span className="text-sm text-secondary">{m.caption}</span>
              <span className="heading-lg tabular-nums">{m.value}</span>
              {m.change && (
                <span className="text-sm text-secondary">{m.change}</span>
              )}
              {m.comparison && (
                <span className="text-sm text-secondary">{m.comparison}</span>
              )}
            </div>
            {m.points.filter((p) => p !== null).length >= 2 ? (
              <Chart points={m.points} unit={m.unit} />
            ) : (
              <Note>Noch zu wenige Messwerte für eine Kurve.</Note>
            )}
            {m.range && <Note>{m.range}</Note>}
            {m.notes.map((n) => (
              <Note key={n}>{n}</Note>
            ))}
          </Box>
        </DataLLM>
      )}
    </Card>
  );
}

const PAGE = 12;

export function HistoryCard({
  source,
  workoutId,
  onBack,
  onAsk,
}: {
  source: ArnoldDashboardView;
  workoutId: string | null;
  onBack: () => void;
  onAsk: (sentence: string) => void;
}) {
  const workouts = useArnoldTool(
    "get_arnold_workouts",
    ArnoldWorkoutHistoryViewSchema,
  );
  const one = useArnoldTool("get_workout", WorkoutContextSchema);
  const [open, setOpen] = useState<string | null>(workoutId);
  const [more, setMore] = useState<ViewWorkoutDetail[]>([]);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const [offset, setOffset] = useState(PAGE);
  const [moreFailed, setMoreFailed] = useState(false);
  const [fromNewest, setFromNewest] = useState(workoutId === null);
  // Opened on one workout (from the chat): the list starts at its date and
  // includes it even when it is open or cancelled.
  const load = useLoad(async () => {
    const date = fromNewest
      ? null
      : ((await one.call({ workout_id: workoutId })).workout
          ?.workout_date_local ?? null);
    const page = await workouts.call({
      limit: PAGE,
      offset: 0,
      ...(date ? { to: date } : {}),
    });
    let rows = page.workouts;
    if (date && !rows.some((w) => w.workout_id === workoutId)) {
      const day = await workouts.call({
        from: date,
        to: date,
        workout_statuses: [
          "planned",
          "in_progress",
          "completed",
          "cancelled",
          "voided",
        ],
        limit: 200,
      });
      rows = appendWorkouts(
        day.workouts.filter((w) => w.workout_id === workoutId),
        rows,
      );
    }
    return { rows, total: page.total, hasMore: page.has_more, to: date };
  }, [fromNewest]);
  const title = "Deine Einheiten";
  if (load.failed)
    return (
      <LoadError
        title={title}
        onBack={onBack}
        onRetry={() => void load.reload()}
      />
    );
  if (!load.data) return <Loading title={title} onBack={onBack} />;
  const data = load.data;
  const rows = appendWorkouts(data.rows, more);
  const entries = rows.map((w) => historyEntry(w, source.home.records));
  const selected = entries.find((e) => e.id === open);
  return (
    <DataLLM
      content={
        selected
          ? `Verlaufskarte: geöffnet ist „${selected.title}“ vom ${selected.date}, workout_id ${selected.id}. Für Korrekturen die aktuelle Revision mit get_workout lesen.`
          : `Verlaufskarte: ${data.total} Einheiten gespeichert.`
      }
    >
      <Card
        title={title}
        subtitle={
          entries.length
            ? data.to
              ? "Ab der gewählten Einheit zurück"
              : `${data.total} ${data.total === 1 ? "Einheit" : "Einheiten"} gespeichert`
            : "Dein erstes gespeichertes Training erscheint hier."
        }
        onBack={onBack}
      >
        {!fromNewest && (
          <Button
            color="secondary"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => {
              setMore([]);
              setHasMore(null);
              setOffset(PAGE);
              setFromNewest(true);
            }}
          >
            Neueste Einheiten zeigen
          </Button>
        )}
        {entries.map((e) => (
          <Box key={e.id}>
            <button
              type="button"
              aria-expanded={open === e.id}
              className="flex w-full cursor-pointer items-start justify-between gap-3 border-0 bg-transparent p-0 text-left"
              onClick={() => setOpen(open === e.id ? null : e.id)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{e.title}</span>
                <span className="text-sm text-secondary">
                  {e.date} · {e.meta}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                {e.record && (
                  <Badge color="success" variant="soft" size="sm" pill>
                    Rekord
                  </Badge>
                )}
                {e.fromWatch && (
                  <Badge color="secondary" variant="soft" size="sm" pill>
                    Uhr
                  </Badge>
                )}
              </span>
            </button>
            {open === e.id && (
              <>
                {e.watch.length > 0 && <Note>{e.watch.join(" · ")}</Note>}
                {e.exercises.length ? (
                  <ul
                    aria-label={`Übungen ${e.title}`}
                    className="m-0 flex list-none flex-col gap-2 p-0"
                  >
                    {e.exercises.map((x) => (
                      <li key={x.key} className="flex flex-col">
                        <span>
                          {x.name}
                          {x.record ? " · Rekord" : ""}
                        </span>
                        <span className="text-sm text-secondary">{x.line}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Note>Keine Arbeitssätze gespeichert.</Note>
                )}
                <Button
                  color="secondary"
                  variant="soft"
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    onAsk(
                      `Ich möchte im Training „${e.title}“ vom ${e.date} einen Satz korrigieren.`,
                    )
                  }
                >
                  Satz korrigieren
                </Button>
              </>
            )}
          </Box>
        ))}
        {moreFailed && <Note>Ältere Einheiten ließen sich nicht laden.</Note>}
        {(hasMore ?? data.hasMore) && (
          <Button
            color="secondary"
            variant="soft"
            block
            loading={workouts.pending}
            onClick={async () => {
              setMoreFailed(false);
              try {
                const page = await workouts.call({
                  limit: PAGE,
                  offset,
                  ...(data.to ? { to: data.to } : {}),
                });
                setMore((shown) => appendWorkouts(shown, page.workouts));
                setHasMore(page.has_more);
                setOffset(offset + PAGE);
              } catch {
                setMoreFailed(true);
              }
            }}
          >
            Ältere Einheiten
          </Button>
        )}
      </Card>
    </DataLLM>
  );
}
