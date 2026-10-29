import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { ArnoldClient, type ArnoldPayload } from "./client";
import { ArnoldDashboardApp } from "./ArnoldDashboardApp";
import { ArnoldMcpClient } from "./client/ArnoldMcpClient";
import { OnboardingView } from "./views/OnboardingView";
import "./style.css";

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

  useEffect(() => {
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
      document.documentElement.dataset.theme = theme;
    };
    client.onError = setError;
    client.onStale = setStale;
    void client.connect().catch((e) => setError(e.message));
    return () => {
      void client.close();
    };
  }, [client, mcp]);

  if (!payload)
    return (
      <main className="boot">
        <div className="brand-icon">a.</div>
        <h1>Arnold</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="primary" onClick={() => location.reload()}>
              Erneut verbinden
            </button>
          </>
        ) : (
          <>
            <div className="loading-line" />
            <p>Dein Trainingsüberblick wird geladen …</p>
          </>
        )}
      </main>
    );

  if (payload.contract === "onboarding")
    return (
      <OnboardingView
        client={mcp}
        initial={payload.onboarding.state}
        resumed={payload.onboarding.resumed}
      />
    );

  return (
    <ArnoldDashboardApp
      client={mcp}
      initial={payload.dashboard}
      bridgeError={error}
      stale={stale}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Boot />);
