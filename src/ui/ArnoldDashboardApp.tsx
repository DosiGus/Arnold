import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArnoldDashboardView } from "../shared/arnold-view";
import type { ArnoldMcpClient } from "./client/ArnoldMcpClient";
import type { WorkoutContext } from "../shared/workout-contract";
import { ArrowLeft } from "lucide-react";
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
    /** The training card opened for another workout today. */
    fresh?: boolean;
    goal_id?: string;
    newGoal?: boolean;
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
  const [workoutContext, setWorkoutContext] = useState<WorkoutContext | null>(
    null,
  );
  const open = useCallback(
    (
      next: CardId,
      focus: {
        exercise_id?: string;
        workout_id?: string;
        fresh?: boolean;
        goal_id?: string;
        newGoal?: boolean;
      } = {},
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
  useEffect(() => {
    if (card !== "home" && card !== "goals") return;
    let active = true;
    setCanWrite(false);
    setWorkoutContext(null);
    void client
      .workout()
      .then((context) => {
        if (!active) return;
        setCanWrite(context.can_write);
        setWorkoutContext(context);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client, card, view.source.generated_at]);
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
  const ownBack =
    card === "stats" ||
    card === "goals" ||
    card === "records" ||
    card === "history";
  const goBack = trail.length > 1 ? back : () => open("home");
  const backLink =
    card !== "home" && !ownBack ? (
      <button type="button" className="ac-link ac-page-back" onClick={goBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        {trail.length <= 1 || trail.at(-2) === "home"
          ? "Zurück zur Übersicht"
          : "Zurück"}
      </button>
    ) : undefined;

  return (
    <main className="arnold-cards" id="main-content" data-card={card}>
      {notes}
      {backLink}
      {card === "home" && (
        <HomeCard
          view={view}
          canWrite={canWrite}
          workoutContext={workoutContext}
          client={client}
          onOpen={open}
        />
      )}
      {card === "stats" && (
        <StatsView view={view} onBack={goBack} onOpen={open} />
      )}
      {card === "goals" && (
        <GoalsView
          client={client}
          view={view}
          canWrite={canWrite}
          initialGoalId={target.goal_id}
          startAdding={target.newGoal}
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
          fresh={target.fresh}
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
          onBack={goBack}
        />
      )}
      {(card === "plan" || card === "plan_change") && (
        <PlanCard
          client={client}
          dashboard={view}
          onChanged={dashboard.reload}
          change={card === "plan_change"}
        />
      )}
    </main>
  );
}
