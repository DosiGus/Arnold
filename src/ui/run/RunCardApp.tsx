import { useEffect, useState } from "react";
import type { RunCard, RunCardView } from "../../shared/run-card-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldCard } from "../components/cards";
import { RunTodayCard } from "./RunTodayCard";

/**
 * The run cards. `show_arnold_run` picks the card; each card loads its own
 * numbers from the run tools. TODO (RUN-010, siehe Übergabe): run_result,
 * run_week, run_stats and run_setup are not built yet.
 */
export function RunCardApp({
  client,
  initial,
}: {
  client: ArnoldMcpClient;
  initial: RunCardView;
}) {
  const [card, setCard] = useState<RunCard>(initial.card);
  const [, setWorkoutId] = useState<string | null>(initial.workout_id);
  useEffect(() => {
    setCard(initial.card);
    setWorkoutId(initial.workout_id);
  }, [initial]);
  const open = (next: RunCard, id?: string) => {
    setCard(next);
    setWorkoutId(id ?? null);
  };
  if (card === "run_today")
    return <RunTodayCard client={client} onOpen={open} />;
  return (
    <main className="arnold-cards" id="main-content" data-card={card}>
      <ArnoldCard
        label="Lauf"
        title="Diese Karte folgt"
        subtitle="Sie ist noch nicht gebaut."
      />
    </main>
  );
}
