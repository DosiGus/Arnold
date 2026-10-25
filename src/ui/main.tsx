import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { ArnoldClient, type ArnoldPayload } from "./client";
import { ArnoldApp } from "./App";
import { ArnoldDashboardApp } from "./ArnoldDashboardApp";
import { ArnoldMcpClient } from "./client/ArnoldMcpClient";
import "./style.css";

/**
 * Boots the app and picks the interface for the contract the server speaks.
 *
 * The demo path (v1) and the Arnold path (v2) are deliberately separate
 * components: the two data models disagree about what a workout is, so one
 * component serving both would have to guess. The contract in the payload
 * decides, which keeps the existing demo mode working untouched.
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
  }, [client]);

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

  return payload.contract === "v2" ? (
    <ArnoldDashboardApp
      client={mcp}
      initial={payload.dashboard}
      bridgeError={error}
      stale={stale}
    />
  ) : (
    <ArnoldApp client={client} data={payload.dashboard} bridgeError={error} />
  );
}

createRoot(document.getElementById("root")!).render(<Boot />);
