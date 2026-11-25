import type {
  OnboardingCard,
  OnboardingState,
} from "../../../shared/onboarding-contract";
import type { ArnoldMcpClient } from "../../client/ArnoldMcpClient";
import { useOnboardingCard } from "../../hooks/useOnboardingCard";
import { ChecklistCard } from "./checklist-card";
import { ModulesCard, MODULES_NEXT_MESSAGE } from "./modules-card";
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
  const { state, saving, reload, save } = useOnboardingCard(client, initial);
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
      ) : (
        <ChecklistCard state={state} />
      )}
    </div>
  );
}
