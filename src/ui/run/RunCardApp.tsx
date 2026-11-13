import { useEffect, useState } from "react";
import type { RunCard, RunCardView } from "../../shared/run-card-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { RunResultCard } from "./RunResultCard";
import { RunSetupCard } from "./RunSetupCard";
import { RunStatsCard } from "./RunStatsCard";
import { RunTodayCard } from "./RunTodayCard";
import { RunWeekCard } from "./RunWeekCard";

/**
 * The run cards. `show_arnold_run` picks the card; each card loads its own
 * numbers from the run tools and can open a neighbouring card.
 */
export function RunCardApp({
  client,
  initial,
}: {
  client: ArnoldMcpClient;
  initial: RunCardView;
}) {
  const [card, setCard] = useState<RunCard>(initial.card);
  const [workoutId, setWorkoutId] = useState<string | null>(initial.workout_id);
  useEffect(() => {
    setCard(initial.card);
    setWorkoutId(initial.workout_id);
  }, [initial]);
  const open = (next: RunCard, id?: string) => {
    setCard(next);
    setWorkoutId(id ?? null);
  };
  switch (card) {
    case "run_today":
      return <RunTodayCard client={client} onOpen={open} />;
    case "run_result":
      return (
        <RunResultCard client={client} workoutId={workoutId} onOpen={open} />
      );
    case "run_week":
      return <RunWeekCard client={client} onOpen={open} />;
    case "run_stats":
      return <RunStatsCard client={client} onOpen={open} />;
    case "run_setup":
      return <RunSetupCard client={client} onOpen={open} />;
  }
}
