import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArnoldDashboardView } from "../shared/arnold-view";
import type { ArnoldMcpClient } from "./client/ArnoldMcpClient";
import { useDashboardData } from "./hooks";
import { CardNote, CardSkeleton } from "./components/cards";
import { TrainingCard } from "./views/TrainingCard";
import { WorkoutHistoryView } from "./views/WorkoutHistoryView";
import { ExerciseProgressView } from "./views/ExerciseProgressView";
import { PlanCard } from "./views/PlanCard";
import { HomeCard } from "./views/HomeCard";
import { StatsView } from "./views/StatsView";
import { GoalsView } from "./views/GoalsView";
import { RecordsView } from "./views/RecordsView";
import { RecoveryNotice } from "./components/recovery";
import { dateTimeLabel } from "./format";
import { parseCard, shownCard, type CardId } from "./cards";
import { useModelContext } from "./hooks/useModelContext";
import { homeContext, pageContext } from "./model-context";

function previewCard(): CardId | undefined {
  if (typeof window === "undefined") return undefined;
  const query = new URLSearchParams(window.location.search);
  return parseCard(query.get("card") ?? query.get("view"));
}

/**
 * Arnold inside the chat: one card at a time, no app frame around it.
 *
 * ChatGPT already shows the app's name, logo and theme, and the chat itself is
 * the navigation. So there is no header, menu or theme switch here; the model
 * opens the right card, and a card's buttons may lead to the next one.
 */
export function ArnoldDashboardApp({
  client,
  initial,
  bridgeError,
  stale,
  card: requested,
}: {
  client: ArnoldMcpClient;
  initial: ArnoldDashboardView;
  bridgeError: string;
  stale: boolean;
  /** The card the model asked for, if any. */
  card?: CardId;
}) {
  const [trail, setTrail] = useState<CardId[]>(() => [
    initial.focus?.card ?? requested ?? previewCard() ?? "home",
  ]);
  // A tile or button may open a card on one exercise or one workout.
  const [target, setTarget] = useState<{
    exercise_id?: string;
    workout_id?: string;
  }>({});
  // A new request from the chat replaces whatever the card showed before.
  useEffect(() => {
    const card = initial.focus?.card ?? requested;
    if (card) setTrail([card]);
    setTarget({});
  }, [requested, initial.focus]);
  // "week" is an older name of the start screen.
  const card = shownCard(trail[trail.length - 1]);

  // Start screen and goals need to know whether writing is possible; the
  // training card reads the same context through its own logger.
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => {
    if (card !== "home" && card !== "goals") return;
    let active = true;
    void client
      .workout()
      .then((context) => {
        if (active) setCanWrite(context.can_write);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client, card]);
  const open = useCallback(
    (
      next: CardId,
      focus: { exercise_id?: string; workout_id?: string } = {},
    ) => {
      setTarget(focus);
      setTrail((t) => [...t, next]);
      window.scrollTo({ top: 0, behavior: "instant" });
    },
    [],
  );
  const back = useCallback(() => setTrail((t) => t.slice(0, -1)), []);

  const dashboard = useDashboardData(client, {}, initial);
  // A fresh host push must still win over an older local response.
  const view = useMemo(() => {
    const loaded = dashboard.data;
    if (!loaded) return initial;
    return initial.source.generated_at > loaded.source.generated_at
      ? initial
      : loaded;
  }, [dashboard.data, initial]);
  const showStale = stale && view === initial;
  // The training card reports its own state; the others are reported here.
  useModelContext(
    client,
    card === "today"
      ? undefined
      : card === "home"
        ? homeContext(view)
        : card === "stats" || card === "goals" || card === "records"
          ? pageContext(card)
          : undefined,
  );

  const notes = (
    <>
      {showStale && (
        <CardNote>
          Möglicherweise veraltet · Stand{" "}
          {dateTimeLabel(view.source.generated_at)}.{" "}
          <button type="button" className="ac-link" onClick={dashboard.reload}>
            Aktualisieren
          </button>
        </CardNote>
      )}
      {bridgeError && (
        <CardNote tone="error">
          Deine Ansicht konnte nicht aktualisiert werden.{" "}
          <button className="ac-link" onClick={dashboard.reload}>
            Erneut laden
          </button>
        </CardNote>
      )}
      {dashboard.error && (
        <RecoveryNotice
          recovery={dashboard.failure?.recovery ?? "retry_same_request"}
          onAction={dashboard.reload}
        />
      )}
    </>
  );

  if (dashboard.loading && !dashboard.data)
    return (
      <main className="arnold-cards" id="main-content">
        {notes}
        <CardSkeleton />
      </main>
    );

  // The views behind the start screen tiles bring their own back button.
  const ownBack = card === "stats" || card === "goals" || card === "records";
  const goBack = trail.length > 1 ? back : undefined;
  const backLink =
    trail.length > 1 && !ownBack ? (
      <button type="button" className="ac-link" onClick={back}>
        Zurück
      </button>
    ) : undefined;

  return (
    <main className="arnold-cards" id="main-content" data-card={card}>
      {notes}
      {card === "home" && (
        <HomeCard view={view} canWrite={canWrite} onOpen={open} />
      )}
      {card === "stats" && (
        <StatsView view={view} onBack={goBack} onOpen={open} />
      )}
      {card === "goals" && (
        <GoalsView
          client={client}
          view={view}
          canWrite={canWrite}
          onBack={goBack}
          onChanged={dashboard.reload}
          onOpenProgress={(exercise_id) => open("progress", { exercise_id })}
        />
      )}
      {card === "records" && (
        <RecordsView
          view={view}
          onBack={goBack}
          onOpenWorkout={(workout_id) => open("history", { workout_id })}
          onOpenGoals={() => open("goals")}
        />
      )}
      {card === "today" && (
        <TrainingCard
          client={client}
          view={view}
          onChanged={dashboard.reload}
          onOpen={open}
        />
      )}
      {card === "progress" && (
        <ExerciseProgressView
          key={`${initial.focus ? initial.source.generated_at : "default"}-${target.exercise_id ?? initial.focus?.exercise_id ?? ""}-${initial.focus?.metric ?? ""}`}
          client={client}
          dashboard={view}
          initialExerciseId={
            target.exercise_id ?? initial.focus?.exercise_id ?? undefined
          }
          initialMetric={initial.focus?.metric ?? undefined}
        />
      )}
      {card === "history" && (
        <WorkoutHistoryView
          key={`${initial.focus ? initial.source.generated_at : "default"}-${target.workout_id ?? initial.focus?.workout_id ?? "history"}`}
          client={client}
          dashboard={view}
          initialWorkoutId={
            target.workout_id ?? initial.focus?.workout_id ?? undefined
          }
        />
      )}
      {card === "plan" && (
        <PlanCard
          client={client}
          dashboard={view}
          onChanged={dashboard.reload}
        />
      )}
      {backLink && <div style={{ paddingInline: 4 }}>{backLink}</div>}
    </main>
  );
}
