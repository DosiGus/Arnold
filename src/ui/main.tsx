import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { ArnoldClient, type ArnoldPayload } from "./client";
import { ArnoldDashboardApp } from "./ArnoldDashboardApp";
import { ArnoldMcpClient } from "./client/ArnoldMcpClient";
import { OnboardingView } from "./views/OnboardingView";
import "./style.css";
import { AccountCard } from "./views/AccountCard";
import { GarminCard } from "./views/GarminCard";
import { RunCardApp } from "./run/RunCardApp";
import { MobilityCardApp } from "./mobility/MobilityCardApp";
import { CardSkeleton } from "./components/cards";
import { RecoveryCard } from "./components/recovery";
import type { UiFailure } from "./recovery";
import { ConversationCardsKit } from "./components/conversation-cards-kit";
import { parseCard, type CardId } from "./cards";

/**
 * Boots the app and picks the interface for the contract the server speaks.
 *
 * The dashboard and the setup wizard are deliberately separate components:
 * their data models disagree about what they describe, so one component
 * serving both would have to guess. The contract in the payload decides.
 */
function Boot() {
  const [client] = useState(() => new ArnoldClient());
  const [mcp] = useState(() => new ArnoldMcpClient(client));
  const [payload, setPayload] = useState<ArnoldPayload>();
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [failure, setFailure] = useState<UiFailure>();
  const [card, setCard] = useState<CardId>();

  useEffect(() => {
    document.documentElement.dataset.embedded = String(client.embedded);
    document.documentElement.dataset.theme = matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches
      ? "dark"
      : "light";
    client.onPayload = (next) => {
      // A freshly started setup arrives with its session secret. It is stored
      // in the client immediately, because every later onboarding call needs
      // it — a session id alone is not a permission.
      if (next.contract === "onboarding" && next.onboarding.session_token)
        mcp.rememberOnboarding({
          onboarding_session_id:
            next.onboarding.state.session.onboarding_session_id,
          session_token: next.onboarding.session_token,
        });
      setPayload(next);
      setError("");
    };
    client.onTheme = (theme) => {
      document.documentElement.dataset.embedded = String(client.embedded);
      document.documentElement.dataset.theme = theme;
    };
    client.onError = setError;
    client.onFailure = (next) => {
      if (next.recovery === "finish_setup" || !payload) setFailure(next);
    };
    client.onStale = setStale;
    // The model picks the card through the tool's `card` argument.
    client.onInput = (args) => setCard(parseCard(args.card));
    void client.connect().catch((e) => setError(e.message));
    return () => {
      void client.close();
    };
  }, [client, mcp]);

  const content = !payload ? (
    <main className="arnold-cards">
      {error || failure ? (
        <RecoveryCard
          recovery={failure?.recovery ?? "retry_same_request"}
          onAction={() => {
            if (failure?.recovery === "finish_setup")
              void mcp.showOnboarding().catch(() => {});
            else location.reload();
          }}
        />
      ) : (
        <CardSkeleton />
      )}
    </main>
  ) : payload.contract === "account" ? (
    <AccountCard client={mcp} initial={payload.account} />
  ) : payload.contract === "garmin" ? (
    <GarminCard client={mcp} initial={payload.garmin} />
  ) : payload.contract === "run" ? (
    <RunCardApp client={mcp} initial={payload.run} />
  ) : payload.contract === "mobility" ? (
    <MobilityCardApp client={mcp} initial={payload.mobility} />
  ) : payload.contract === "onboarding" ? (
    <OnboardingView
      client={mcp}
      initial={payload.onboarding.state}
      resumed={payload.onboarding.resumed}
    />
  ) : (
    <ArnoldDashboardApp
      client={mcp}
      initial={payload.dashboard}
      bridgeError={error}
      stale={stale}
      card={card}
    />
  );
  return failure?.recovery === "finish_setup" ? (
    <main className="arnold-cards">
      <RecoveryCard
        recovery="finish_setup"
        onAction={() => {
          void mcp
            .showOnboarding()
            .then(() => setFailure(undefined))
            .catch(() => {});
        }}
      />
    </main>
  ) : (
    content
  );
}

// `?kit=1` shows the example page of the conversation cards (tests, sign-off).
const showKit = new URLSearchParams(location.search).has("kit");
createRoot(document.getElementById("root")!).render(
  showKit ? <ConversationCardsKit /> : <Boot />,
);
