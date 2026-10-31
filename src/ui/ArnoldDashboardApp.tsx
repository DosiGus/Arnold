import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArnoldDashboardView } from "../shared/arnold-view";
import type { ArnoldMcpClient } from "./client/ArnoldMcpClient";
import { useDashboardData } from "./hooks";
import { CardNote, CardSkeleton } from "./components/cards";
import { TrainingCard } from "./views/TrainingCard";
import { WeekCard } from "./views/WeekCard";
import { WorkoutHistoryView } from "./views/WorkoutHistoryView";
import { ExerciseProgressView } from "./views/ExerciseProgressView";
import { PlanCard } from "./views/PlanCard";
import { RecoveryNotice } from "./components/recovery";
import { dateTimeLabel } from "./format";
import { parseCard, type CardId } from "./cards";
import { useModelContext } from "./hooks/useModelContext";
import { weekContext } from "./model-context";

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
    requested ?? previewCard() ?? "today",
  ]);
  // A new request from the chat replaces whatever the card showed before.
  useEffect(() => {
    if (requested) setTrail([requested]);
  }, [requested]);
  const card = trail[trail.length - 1];

  // Only the week card needs to know whether writing is possible; the training
  // card reads the same context through its own logger.
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => {
    if (card !== "week") return;
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
  const open = useCallback((next: CardId) => {
    setTrail((t) => [...t, next]);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
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
      : card === "week"
        ? weekContext(view)
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

  const backLink =
    trail.length > 1 ? (
      <button type="button" className="ac-link" onClick={back}>
        Zurück
      </button>
    ) : undefined;

  return (
    <main className="arnold-cards" id="main-content" data-card={card}>
      {notes}
      {card === "today" && (
        <TrainingCard
          client={client}
          view={view}
          onChanged={dashboard.reload}
          onOpen={open}
        />
      )}
      {card === "week" && (
        <WeekCard view={view} canWrite={canWrite} onOpen={open} />
      )}
      {card === "progress" && (
        <ExerciseProgressView client={client} dashboard={view} />
      )}
      {card === "history" && (
        <WorkoutHistoryView client={client} dashboard={view} />
      )}
      {card === "plan" && (
        <PlanCard client={client} dashboard={view} onChanged={dashboard.reload} />
      )}
      {backLink && <div style={{ paddingInline: 4 }}>{backLink}</div>}
    </main>
  );
}
