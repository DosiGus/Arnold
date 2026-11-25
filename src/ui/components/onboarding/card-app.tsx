import type {
  OnboardingCard,
  OnboardingState,
} from "../../../shared/onboarding-contract";
import type { ArnoldMcpClient } from "../../client/ArnoldMcpClient";
import { useOnboardingCard } from "../../hooks/useOnboardingCard";
import {
  BenchmarksCard,
  BENCHMARKS_NEXT_MESSAGE,
  BENCHMARKS_SKIP_MESSAGE,
} from "./benchmarks-card";
import {
  RunReferenceCard,
  RUN_REFERENCE_NEXT_MESSAGE,
  RUN_REFERENCE_SKIP_MESSAGE,
} from "./run-reference-card";
import { PlanCard, PLAN_NEXT_MESSAGE } from "./plan-card";
import { ChecklistCard } from "./checklist-card";
import { ModulesCard, MODULES_NEXT_MESSAGE } from "./modules-card";
import {
  WearableCard,
  WEARABLE_LATER_MESSAGE,
  WEARABLE_NEXT_MESSAGE,
} from "./wearable-card";
import { StartCardLoader } from "./start-card";
import { PersonCard, PERSON_NEXT_MESSAGE } from "./person-card";

/**
 * Runs one onboarding card in the chat. Each card shows the whole current
 * state; a tap anywhere on it reads the server state again, because a card
 * already in the chat gets no news from the host.
 */
export function OnboardingCardApp({
  client,
  card,
  initial,
}: {
  client: ArnoldMcpClient;
  card: OnboardingCard;
  initial: OnboardingState;
}) {
  const { state, saving, reload, save, confirmPlan } = useOnboardingCard(
    client,
    initial,
  );
  const { profile } = state.session;
  return (
    <div onClick={() => void reload()}>
      {card === "person" ? (
        <PersonCard
          person={profile.person}
          saving={saving}
          onSave={save}
          onDone={() => void client.askChat(PERSON_NEXT_MESSAGE)}
        />
      ) : card === "modules" ? (
        <ModulesCard
          profile={profile}
          saving={saving}
          onSave={save}
          onDone={() => void client.askChat(MODULES_NEXT_MESSAGE)}
        />
      ) : card === "benchmarks" ? (
        <BenchmarksCard
          state={state}
          saving={saving}
          onSave={save}
          onDone={(skipped) =>
            void client.askChat(
              skipped ? BENCHMARKS_SKIP_MESSAGE : BENCHMARKS_NEXT_MESSAGE,
            )
          }
        />
      ) : card === "run_reference" ? (
        <RunReferenceCard
          state={state}
          saving={saving}
          onSave={save}
          onDone={(skipped) =>
            void client.askChat(
              skipped ? RUN_REFERENCE_SKIP_MESSAGE : RUN_REFERENCE_NEXT_MESSAGE,
            )
          }
        />
      ) : card === "plan" ? (
        <PlanCard
          client={client}
          state={state}
          saving={saving}
          onConfirm={confirmPlan}
          onChanged={reload}
          onDone={() => void client.askChat(PLAN_NEXT_MESSAGE)}
        />
      ) : card === "wearable" ? (
        <WearableCard
          client={client}
          state={state}
          onDone={(later) =>
            void client.askChat(
              later ? WEARABLE_LATER_MESSAGE : WEARABLE_NEXT_MESSAGE,
            )
          }
        />
      ) : card === "start" ? (
        <StartCardLoader client={client} state={state} />
      ) : (
        <ChecklistCard state={state} />
      )}
    </div>
  );
}
