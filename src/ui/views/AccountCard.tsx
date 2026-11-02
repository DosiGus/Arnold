import { useEffect, useRef, useState } from "react";
import type { DeleteAccountResponse } from "../../shared/account-contract";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldCard, CardActions, CardNote } from "../components/cards";
import { RecoveryCard } from "../components/recovery";
import { asFailure, type UiFailure } from "../recovery";
import { useModelContext } from "../hooks/useModelContext";

/** The confirmation stays in app memory; it is never placed in model context. */
export function AccountCard({
  client,
  initial,
}: {
  client: ArnoldMcpClient;
  initial: DeleteAccountResponse;
}) {
  const [response, setResponse] = useState(initial);
  const [failure, setFailure] = useState<UiFailure>();
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [now, setNow] = useState(Date.now());
  const guard = useRef(false);
  useEffect(() => {
    setResponse(initial);
    setFailure(undefined);
  }, [initial]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired =
    response.stage === "confirm" && Date.parse(response.expires_at) <= now;
  useModelContext(
    client,
    response.stage === "deleted"
      ? "Arnold bestätigt: Das Arnold-Konto und alle Trainingsdaten wurden gelöscht."
      : cancelled
        ? "Die Kontolöschung wurde abgebrochen. Es wurde nichts gelöscht."
        : "Arnold zeigt die Zusammenfassung zur Kontolöschung. Nur der ausdrückliche Klick in der Karte darf löschen; das Modell darf die Löschung nicht bestätigen.",
  );
  async function perform(confirm = false) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setFailure(undefined);
    try {
      const next = await client.deleteAccount(
        confirm && response.stage === "confirm"
          ? response.confirmation_token
          : undefined,
      );
      setResponse(next);
      if (next.stage === "deleted") client.forgetOnboarding();
    } catch (error) {
      setFailure(asFailure(error, "retry_same_request"));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="arnold-cards" data-card="account">
      {failure ? (
        <RecoveryCard
          recovery={failure.recovery}
          busy={busy}
          onAction={() =>
            void perform(failure.recovery === "retry_same_request")
          }
        />
      ) : cancelled ? (
        <ArnoldCard
          title="Löschung abgebrochen"
          subtitle="Dein Arnold-Konto bleibt erhalten."
        >
          <CardActions
            primary={{
              label: "Zum Training",
              onClick: () => void client.openDashboard(),
            }}
          />
        </ArnoldCard>
      ) : response.stage === "deleted" ? (
        <ArnoldCard
          label="Erledigt"
          title="Dein Arnold-Konto ist gelöscht"
          subtitle="Alle bei Arnold gespeicherten Daten wurden entfernt, auch deine Trainingspläne und Trainings."
        />
      ) : expired ? (
        <RecoveryCard
          recovery="start_over"
          busy={busy}
          onAction={() => void perform()}
        />
      ) : (
        <ArnoldCard
          label="Dein Konto"
          title="Arnold-Konto löschen?"
          subtitle="Die Löschung kann nicht rückgängig gemacht werden."
          busy={busy}
        >
          <div>
            <h3 className="ac-section-title">Das wird bei Arnold gelöscht</h3>
            <ul className="ac-plain-list">
              {response.summary.stored_items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <CardNote>
            Deine Trainingspläne und Trainings sind danach nicht mehr abrufbar.
          </CardNote>
          <CardActions
            primary={{
              label: busy
                ? "Wird gelöscht …"
                : "Arnold-Konto endgültig löschen",
              tone: "danger",
              onClick: () => void perform(true),
              disabled: busy,
            }}
            secondary={{
              label: "Abbrechen",
              onClick: () => setCancelled(true),
              disabled: busy,
            }}
          />
        </ArnoldCard>
      )}
    </main>
  );
}
