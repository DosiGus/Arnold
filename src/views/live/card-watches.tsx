/**
 * The chat cards of the account tools: "Uhr verbinden?"
 * (`pair_garmin_watch`), the paired watches with consent
 * (`list_garmin_watches`) and the account deletion
 * (`delete_arnold_account`). The confirmation tokens come from the opening
 * answer's `_meta.arnold` and are sent only on the user's click.
 */
import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useEffect, useState } from "react";
import { DataLLM } from "skybridge/web";
import { DeleteAccountPublicResponseSchema } from "../../shared/account-contract.js";
import {
  HEALTH_CONSENT_TEXT,
  HEALTH_CONSENT_TEXT_VERSION,
} from "../../shared/health-consent.js";
import {
  ListGarminWatchesSchema,
  PairGarminWatchResponseSchema,
  SetGarminHealthConsentResponseSchema,
  UnpairGarminWatchResponseSchema,
  type ListGarminWatches,
  type PairGarminWatchConfirmMeta,
} from "../../shared/watch-contract.js";
import { ArnoldCallError, useArnoldTool } from "../arnold-client.js";
import {
  accountErrorText,
  pairConfirmInput,
  type DeleteConfirmation,
} from "../model/settings.js";
import {
  consentDoneText,
  consentInput,
  expired,
  watchRows,
} from "../model/watches.js";
import { Actions, Box, Card, Note, Rows, useLoad } from "./card-kit.js";
import { WatchPairing } from "./watch-pairing.js";

const errorText = (e: unknown, fallback: string) =>
  e instanceof ArnoldCallError ? accountErrorText(e.code, e.message) : fallback;

/** True once `expiresAt` has passed; checked every few seconds. */
function useExpired(expiresAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  return !!expiresAt && expired(expiresAt, now);
}

export function PairCard({
  deviceLabel,
  confirm,
  failure,
  onBack,
}: {
  deviceLabel: string | null;
  confirm: PairGarminWatchConfirmMeta | null;
  /** Why the opening call refused the code. */
  failure?: string;
  onBack: () => void;
}) {
  const pair = useArnoldTool(
    "pair_garmin_watch",
    PairGarminWatchResponseSchema,
  );
  const [state, setState] = useState<"ask" | "retry" | "cancelled">("ask");
  const [paired, setPaired] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(failure ?? null);
  const tooLate = useExpired(confirm?.expires_at);
  const title = "Garmin-Uhr verbinden";

  if (paired)
    return (
      <DataLLM
        content={`Uhr-Karte: Arnold bestätigt, ${paired} ist verbunden und lädt den Plan.`}
      >
        <Card title={title} onBack={onBack}>
          <Alert
            color="success"
            variant="soft"
            title={`${paired} ist verbunden.`}
            description="Die Uhr lädt jetzt deinen Plan. Das dauert nur ein paar Sekunden."
          />
        </Card>
      </DataLLM>
    );
  if (state === "cancelled")
    return (
      <DataLLM content="Uhr-Karte: Kopplung abgebrochen, nichts wurde verbunden.">
        <Card title={title} onBack={onBack}>
          <Note>
            Kopplung abgebrochen. Die Uhr wurde nicht verbunden. Auf der Uhr
            kannst du jederzeit einen neuen Code holen.
          </Note>
        </Card>
      </DataLLM>
    );
  // No usable token (refused, expired or a replayed card): enter a code.
  if (!confirm || tooLate || state === "retry")
    return (
      <DataLLM content="Uhr-Karte: Es ist nichts verbunden; der Nutzer kann einen Code der Uhr eingeben.">
        <Card title={title} onBack={onBack}>
          {error ? (
            <Alert color="danger" variant="soft" title={error} />
          ) : (
            <Alert
              color="warning"
              variant="soft"
              title="Die Bestätigung ist abgelaufen. Es wurde nichts verbunden."
            />
          )}
          <Box>
            <WatchPairing onPaired={setPaired} />
          </Box>
        </Card>
      </DataLLM>
    );
  return (
    <DataLLM
      content={`Uhr-Karte: Bestätigung für ${confirm.device_label}. Nur der Klick des Nutzers verbindet die Uhr; nicht selbst bestätigen.`}
    >
      <Card title={title} onBack={onBack}>
        <Box>
          <p className="m-0 font-medium">
            {deviceLabel ?? confirm.device_label} mit Arnold verbinden?
          </p>
          <Rows
            label="Kopplung"
            items={[
              { key: "watch", label: "Uhr", value: confirm.device_label },
              {
                key: "code",
                label: "Code auf der Uhr",
                value: confirm.user_code,
              },
            ]}
          />
          <Note>
            Stimmt der Code mit dem auf deiner Uhr überein? Nur dann verbinden.
            Die Uhr darf danach deinen Plan laden und Trainings senden.
          </Note>
        </Box>
        <Actions
          label="Verbinden"
          loading={pair.pending}
          onClick={async () => {
            try {
              const done = await pair.call(pairConfirmInput(confirm));
              if (done.stage === "paired") setPaired(done.device_label);
              else throw new Error();
            } catch (e) {
              setError(errorText(e, "Die Uhr ließ sich gerade nicht koppeln."));
              setState("retry");
            }
          }}
          secondary={{
            label: "Abbrechen",
            onClick: () => setState("cancelled"),
          }}
        />
      </Card>
    </DataLLM>
  );
}

/** Grant or revoke the consent for watch health data, each after a yes. */
export function HealthConsent({
  list,
  onChanged,
}: {
  list: ListGarminWatches;
  onChanged: () => Promise<void>;
}) {
  const set = useArnoldTool(
    "set_garmin_health_consent",
    SetGarminHealthConsentResponseSchema,
  );
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const granted = list.health_consent.granted;
  // No yes to a text this card does not show; revoking always works.
  const outdated =
    !granted &&
    list.health_consent.current_text_version !== HEALTH_CONSENT_TEXT_VERSION;
  const run = async () => {
    setError(null);
    try {
      const answer = await set.call(consentInput(!granted, list));
      setDone(consentDoneText(!granted, answer.deleted_health_records));
      setAsking(false);
      await onChanged();
    } catch (e) {
      setError(errorText(e, "Das hat gerade nicht geklappt."));
    }
  };
  return (
    <Box>
      <h3 className="heading-xs m-0">Messwerte der Uhr</h3>
      <Note>
        {granted
          ? "Einwilligung erteilt. Arnold speichert Puls, Kalorien, Body Battery und Stress zu deinen Uhr-Trainings. Ein Widerruf löscht sie."
          : "Keine Einwilligung. Arnold speichert nur dein Training, keine Messwerte."}
      </Note>
      {done && <Alert color="success" variant="soft" title={done} />}
      {error && <Alert color="danger" variant="soft" title={error} />}
      {outdated ? (
        <Note>
          Der Einwilligungstext wurde geändert. Öffne Arnold neu, um den
          aktuellen Text zu sehen.
        </Note>
      ) : asking ? (
        <>
          <p className="m-0 text-sm">
            {granted
              ? "Arnold löscht sofort alle gespeicherten Messwerte deiner Uhr. Deine Trainings bleiben."
              : HEALTH_CONSENT_TEXT}
          </p>
          <Actions
            label={granted ? "Einwilligung widerrufen" : "Einwilligen"}
            loading={set.pending}
            onClick={() => void run()}
            secondary={{ label: "Abbrechen", onClick: () => setAsking(false) }}
          />
        </>
      ) : (
        <Button
          color="secondary"
          variant="soft"
          block
          onClick={() => {
            setDone(null);
            setAsking(true);
          }}
        >
          {granted ? "Messwerte nicht mehr speichern" : "Messwerte speichern"}
        </Button>
      )}
    </Box>
  );
}

export function WatchesCard({
  initial,
  onBack,
}: {
  initial: ListGarminWatches;
  onBack: () => void;
}) {
  const list = useArnoldTool("list_garmin_watches", ListGarminWatchesSchema);
  const unpair = useArnoldTool(
    "unpair_garmin_watch",
    UnpairGarminWatchResponseSchema,
  );
  // The opening result may be an old replay: read the current state once.
  const load = useLoad(() => list.call());
  const [asking, setAsking] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const title = "Garmin-Uhren";
  const data = load.data ?? initial;
  const rows = watchRows(data);
  return (
    <DataLLM
      content={`Uhr-Karte: ${rows.length} verbundene Uhr(en), Einwilligung für Messwerte ${data.health_consent.granted ? "erteilt" : "nicht erteilt"}. Trennen und Einwilligung ändert nur der Nutzer.`}
    >
      <Card title={title} subtitle={data.account_label} onBack={onBack}>
        {load.failed && (
          <Alert
            color="warning"
            variant="soft"
            title="Stand vom Öffnen der Karte, nicht ganz aktuell."
          />
        )}
        {done && <Alert color="success" variant="soft" title={done} />}
        {error && <Alert color="danger" variant="soft" title={error} />}
        {rows.length === 0 && (
          <Box>
            <p className="m-0 font-medium">Keine Garmin-Uhr verbunden.</p>
            <Note>
              Starte Arnold auf deiner Uhr und gib hier den Code ein, den sie
              zeigt.
            </Note>
          </Box>
        )}
        {rows.map((w) => (
          <Box key={w.id}>
            <h3 className="heading-xs m-0">{w.label}</h3>
            <Rows
              label={`Garmin-Uhr ${w.label}`}
              items={[
                { key: "since", label: "Verbunden seit", value: w.since },
                { key: "last", label: "Letzter Kontakt", value: w.lastContact },
              ]}
            />
            {asking === w.id ? (
              <>
                <Note>
                  Die Uhr verliert sofort den Zugriff. Deine gespeicherten
                  Trainings bleiben.
                </Note>
                <Actions
                  label={`${w.label} trennen`}
                  loading={unpair.pending}
                  onClick={async () => {
                    setError(null);
                    try {
                      await unpair.call({ device_id: w.id });
                      setAsking(null);
                      setDone(`${w.label} ist getrennt.`);
                      await load.reload();
                    } catch (e) {
                      setError(
                        errorText(e, "Die Uhr ließ sich nicht trennen."),
                      );
                    }
                  }}
                  secondary={{
                    label: "Abbrechen",
                    onClick: () => setAsking(null),
                  }}
                />
              </>
            ) : (
              <Button
                color="secondary"
                variant="soft"
                block
                onClick={() => {
                  setDone(null);
                  setAsking(w.id);
                }}
              >
                Verbindung trennen
              </Button>
            )}
          </Box>
        ))}
        {pairing ? (
          <Box>
            <WatchPairing
              onPaired={(label) => {
                setPairing(false);
                setDone(`${label} wird eingerichtet.`);
                void load.reload();
              }}
              onCancel={() => setPairing(false)}
            />
          </Box>
        ) : (
          <Button
            color="secondary"
            variant="soft"
            block
            onClick={() => setPairing(true)}
          >
            {rows.length ? "Weitere Uhr verbinden" : "Garmin-Uhr verbinden"}
          </Button>
        )}
        <HealthConsent list={data} onChanged={load.reload} />
      </Card>
    </DataLLM>
  );
}

export function DeleteCard({
  items,
  confirm,
  deleted: alreadyDeleted = false,
  onBack,
}: {
  items: string[];
  confirm: DeleteConfirmation | null;
  deleted?: boolean;
  onBack: () => void;
}) {
  const del = useArnoldTool(
    "delete_arnold_account",
    DeleteAccountPublicResponseSchema,
  );
  const [deleted, setDeleted] = useState(alreadyDeleted);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLate = useExpired(confirm?.expires_at);
  const title = "Konto löschen";

  if (deleted)
    return (
      <DataLLM content="Konto-Karte: Das Arnold-Konto wurde gelöscht.">
        <div className="flex flex-col gap-4">
          <h2 className="heading-lg m-0">{title}</h2>
          <Alert
            color="success"
            variant="soft"
            title="Dein Arnold-Konto ist gelöscht. Alle gespeicherten Daten sind entfernt."
          />
        </div>
      </DataLLM>
    );
  const usable = confirm && !tooLate && !cancelled && !error;
  return (
    <DataLLM
      content={
        cancelled
          ? "Konto-Karte: abgebrochen, nichts gelöscht."
          : "Konto-Karte: zeigt, was gelöscht würde. Nur der Klick des Nutzers löscht; nicht selbst bestätigen."
      }
    >
      <Card title={title} onBack={onBack}>
        {cancelled ? (
          <Note>Abgebrochen. Es wurde nichts gelöscht.</Note>
        ) : (
          <Box>
            <p className="m-0 font-medium">Gelöscht wird, ohne Rückweg:</p>
            <ul className="m-0 pl-5 text-secondary">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Box>
        )}
        {error && <Alert color="danger" variant="soft" title={error} />}
        {!usable && !cancelled && !error && (
          <Alert
            color="warning"
            variant="soft"
            title="Die Bestätigung ist abgelaufen. Es wurde nichts gelöscht."
            description="Sag im Chat noch einmal, dass du dein Konto löschen willst."
          />
        )}
        {usable && (
          <div className="grid auto-cols-fr grid-flow-col gap-2">
            <Button
              color="danger"
              variant="soft"
              size="lg"
              block
              loading={del.pending}
              onClick={async () => {
                try {
                  const done = await del.call({
                    confirmation_token: confirm.confirmation_token,
                  });
                  if (done.stage === "deleted") setDeleted(true);
                } catch (e) {
                  setError(errorText(e, "Das Konto ließ sich nicht löschen."));
                }
              }}
            >
              Endgültig löschen
            </Button>
            <Button
              color="secondary"
              variant="soft"
              size="lg"
              block
              disabled={del.pending}
              onClick={() => setCancelled(true)}
            >
              Abbrechen
            </Button>
          </div>
        )}
      </Card>
    </DataLLM>
  );
}
