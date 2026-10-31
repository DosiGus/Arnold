import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Recovery } from "../../shared/write-recovery";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { RECOVERY_COPY, type UiFailure } from "../recovery";
import { ArnoldCard, CardActions, CardNote } from "./cards";
import { useModelContext } from "../hooks/useModelContext";

export function RecoveryCard({
  recovery,
  onAction,
  busy = false,
}: {
  recovery: Recovery;
  onAction?: () => void;
  busy?: boolean;
}) {
  const copy = RECOVERY_COPY[recovery];
  return (
    <ArnoldCard
      role="alert"
      label="So geht es weiter"
      title={copy.title}
      subtitle={copy.body}
      busy={busy}
    >
      {copy.action && onAction && (
        <CardActions
          primary={{
            label: busy ? "Wird geprüft …" : copy.action,
            onClick: onAction,
            disabled: busy,
          }}
        />
      )}
    </ArnoldCard>
  );
}

export function RecoveryNotice({
  recovery,
  code,
  message,
  onAction,
  busy = false,
}: {
  recovery: Recovery;
  code?: string;
  message?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  const copy =
    code === "DATE_IN_FUTURE"
      ? {
          title: "Das Datum liegt in der Zukunft",
          body: "Nenne im Chat heute oder ein vergangenes Trainingsdatum.",
        }
      : RECOVERY_COPY[recovery];
  return (
    <CardNote tone="error">
      <strong>{copy.title}</strong>
      {message && <p>{message}</p>}
      <p>{copy.body}</p>
      {copy.action && onAction && (
        <button
          type="button"
          className="ac-link"
          onClick={onAction}
          disabled={busy}
        >
          {busy ? "Wird geprüft …" : copy.action}
        </button>
      )}
    </CardNote>
  );
}

/** Keeps the current form mounted, including an immutable pending write. */
export function GoogleRecovery({
  client,
  children,
  failure,
  onRecovered,
}: {
  client: ArnoldMcpClient;
  children: ReactNode;
  failure?: UiFailure;
  onRecovered: () => void;
}) {
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const guard = useRef(false);
  const shown = failure?.recovery === "reconnect_google";
  useModelContext(
    client,
    shown
      ? "Arnold zeigt Google neu verbinden: Die Freigabe ist abgelaufen. Der bisherige Kartenstand und unbestätigte Schreibvorgänge bleiben erhalten. Nach der Freigabe hier fortsetzen."
      : undefined,
  );
  const check = async () => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      if (await client.googleConnected()) {
        setWaiting(false);
        setMessage("");
        onRecovered();
        client.refreshViews();
      } else
        setMessage(
          "Die Freigabe ist noch offen. Schließe sie bei Google ab und prüfe dann erneut.",
        );
    } catch {
      setMessage(
        "Die Verbindung konnte noch nicht geprüft werden. Versuche es erneut.",
      );
    } finally {
      setBusy(false);
      guard.current = false;
    }
  };
  useEffect(() => {
    if (!shown || !waiting) return;
    const focus = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [shown, waiting, client]);
  return (
    <>
      <div hidden={shown}>{children}</div>
      {shown && (
        <main className="arnold-cards">
          <ArnoldCard
            label="Dein Training bleibt hier"
            title="Google neu verbinden"
            subtitle={RECOVERY_COPY.reconnect_google.body}
            busy={busy}
          >
            {message && <CardNote>{message}</CardNote>}
            <CardActions
              primary={{
                label: busy
                  ? "Wird geprüft …"
                  : waiting
                    ? "Verbindung prüfen"
                    : "Google neu verbinden",
                disabled: busy,
                onClick: () => {
                  if (waiting) {
                    void check();
                    return;
                  }
                  setBusy(true);
                  setMessage("");
                  void client
                    .connectGoogle(true)
                    .then(() => setWaiting(true))
                    .catch(() =>
                      setMessage(
                        "Die Google-Freigabe konnte nicht geöffnet werden. Versuche es erneut.",
                      ),
                    )
                    .finally(() => setBusy(false));
                },
              }}
              secondary={
                waiting
                  ? {
                      label: "Google erneut öffnen",
                      disabled: busy,
                      onClick: () => {
                        void client
                          .connectGoogle(true)
                          .catch(() =>
                            setMessage(
                              "Der Verbindungslink konnte nicht geöffnet werden.",
                            ),
                          );
                      },
                    }
                  : undefined
              }
            />
          </ArnoldCard>
        </main>
      )}
    </>
  );
}
