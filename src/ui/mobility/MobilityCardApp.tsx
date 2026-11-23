import { useEffect, useState } from "react";
import type {
  MobilityCard,
  MobilityCardView,
} from "../../shared/mobility-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { MobilityResultCard } from "./MobilityResultCard";
import { MobilitySetupCard } from "./MobilitySetupCard";
import { MobilityTodayCard } from "./MobilityTodayCard";

/**
 * The mobility cards. `show_arnold_mobility` picks the card; each card loads
 * its own numbers from `get_mobility_overview` and can open a neighbour.
 */
export function MobilityCardApp({
  client,
  initial,
}: {
  client: ArnoldMcpClient;
  initial: MobilityCardView;
}) {
  const [card, setCard] = useState<MobilityCard>(initial.card);
  const [workoutId, setWorkoutId] = useState<string | null>(initial.workout_id);
  useEffect(() => {
    setCard(initial.card);
    setWorkoutId(initial.workout_id);
  }, [initial]);
  const open = (next: MobilityCard, id?: string) => {
    setCard(next);
    setWorkoutId(id ?? null);
  };
  switch (card) {
    case "mobility_today":
      return <MobilityTodayCard client={client} onOpen={open} />;
    case "mobility_result":
      return (
        <MobilityResultCard
          client={client}
          workoutId={workoutId}
          onOpen={open}
        />
      );
    case "mobility_setup":
      return <MobilitySetupCard client={client} onOpen={open} />;
  }
}
