import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { ArnoldClient } from "./client";
import { ArnoldApp } from "./App";
import type { Dashboard } from "../shared/schemas";
import "./style.css";

function Boot() {
  const [client] = useState(() => new ArnoldClient());
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [error, setError] = useState("");
  useEffect(() => {
    document.documentElement.dataset.theme = matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches
      ? "dark"
      : "light";
    client.onDashboard = (data) => {
      setDashboard(data);
      setError("");
    };
    client.onTheme = (theme) => {
      document.documentElement.dataset.theme = theme;
    };
    client.onError = setError;
    void client.connect().catch((e) => setError(e.message));
    return () => {
      void client.close();
    };
  }, [client]);
  if (!dashboard)
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
  return <ArnoldApp client={client} data={dashboard} bridgeError={error} />;
}
createRoot(document.getElementById("root")!).render(<Boot />);
