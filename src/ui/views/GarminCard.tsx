import { useEffect, useRef, useState } from "react";
import type {
  GarminWatchSchema,
  ListGarminWatches,
} from "../../shared/watch-contract";
import type { z } from "zod";
import type { GarminPayload } from "../client";
import type { ArnoldMcpClient } from "../client/ArnoldMcpClient";
import { ArnoldCard, CardActions, CardNote, Rows } from "../components/cards";
import { RecoveryCard } from "../components/recovery";
import { asFailure, type UiFailure } from "../recovery";
import { useModelContext } from "../hooks/useModelContext";
import { dateTimeLabel } from "../format";

type Watch = z.infer<typeof GarminWatchSchema>;
type Pair = Extract<GarminPayload, { kind: "pair" }>["pair"];

const TIME = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});
const timeLabel = (iso: string) => TIME.format(new Date(iso));

/**
 * Short consent hint until the final privacy text (GAR-B7-01) replaces it.
 * Shown before the user grants, so the click refers to this text.
 */
export const HEALTH_CONSENT_HINT =
  "Mit deiner Einwilligung speichert Arnold zu jedem Uhr-Training Messwerte wie Puls, Kalorien, Body Battery und Stress. Das sind Gesundheitsdaten. Du kannst die Einwilligung jederzeit widerrufen; Arnold löscht dann alle gespeicherten Messwerte.";

/** Pairing confirmation or the watches of the account, by payload. */
export function GarminCard({
  client,
  initial,
}: {
  client: ArnoldMcpClient;
  initial: GarminPayload;
}) {
  return (
    <main className="arnold-cards" data-card="garmin">
      {initial.kind === "pair" ? (
        <PairCard client={client} initial={initial.pair} />
      ) : (
        <WatchesCard client={client} initial={initial.watches} />
      )}
    </main>
  );
}

/**
 * "Uhr verbinden?": only the click sends the confirmation token, which stays
 * in app memory and never reaches the model context.
 */
function PairCard({
  client,
  initial,
}: {
  client: ArnoldMcpClient;
  initial: Pair;
}) {
  const [pair, setPair] = useState(initial);
  const [failure, setFailure] = useState<UiFailure>();
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [now, setNow] = useState(Date.now());
  const guard = useRef(false);
  useEffect(() => {
    setPair(initial);
    setFailure(undefined);
  }, [initial]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const confirm = pair.stage === "confirm" ? pair : undefined;
  const expired = !!confirm && Date.parse(confirm.expires_at) <= now;
  // A replayed card has no token: it can be shown, not confirmed.
  const usable = !!confirm?.confirmation_token && !!confirm.timezone;
  useModelContext(
    client,
    pair.stage === "paired"
      ? `Arnold bestätigt: ${pair.device_label} ist mit dem Arnold-Konto verbunden und lädt den Plan.`
      : cancelled
        ? "Die Kopplung der Uhr wurde abgebrochen. Es wurde nichts verbunden."
        : `Arnold zeigt die Bestätigung für ${pair.device_label} (Code ${pair.user_code}). Nur der Klick des Nutzers in der Karte verbindet die Uhr; das Modell darf nicht selbst bestätigen.`,
  );
  async function perform(withToken: boolean) {
    if (guard.current || !confirm?.timezone) return;
    guard.current = true;
    setBusy(true);
    setFailure(undefined);
    try {
      const next = await client.pairGarminWatch({
        user_code: confirm.user_code,
        timezone: confirm.timezone,
        ...(withToken && confirm.confirmation_token
          ? { confirmation_token: confirm.confirmation_token }
          : {}),
      });
      if (next.kind === "pair") setPair(next.pair);
    } catch (error) {
      setFailure(asFailure(error, "start_over"));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  if (failure)
    return (
      <RecoveryCard
        recovery={failure.recovery}
        busy={busy}
        onAction={() => void perform(false)}
      />
    );
  if (cancelled)
    return (
      <ArnoldCard
        label="Garmin-Uhr"
        title="Kopplung abgebrochen"
        subtitle="Die Uhr wurde nicht verbunden. Auf der Uhr kannst du jederzeit einen neuen Code holen."
      />
    );
  if (pair.stage === "paired")
    return (
      <ArnoldCard
        label="Garmin-Uhr"
        title={`${pair.device_label} ist verbunden`}
        subtitle="Die Uhr lädt jetzt deinen Plan. Das dauert nur ein paar Sekunden."
      >
        <CardActions
          primary={{
            label: "Uhr im Konto ansehen",
            onClick: () =>
              void client
                .openGarminWatches()
                .catch((error) =>
                  setFailure(asFailure(error, "retry_same_request")),
                ),
          }}
        />
      </ArnoldCard>
    );
  if (expired || !usable)
    return (
      <ArnoldCard
        label="Garmin-Uhr"
        title="Bestätigung abgelaufen"
        subtitle="Es wurde nichts verbunden. Hol auf der Uhr einen neuen Code und nenne ihn mir im Chat."
      >
        {usable && (
          <CardActions
            primary={{
              label: busy ? "Wird geladen …" : "Neu beginnen",
              onClick: () => void perform(false),
              disabled: busy,
            }}
          />
        )}
      </ArnoldCard>
    );
  return (
    <ArnoldCard
      label="Garmin-Uhr"
      title={`${pair.device_label} verbinden?`}
      subtitle="Die Uhr darf danach deinen Plan laden und Trainings an Arnold senden."
      busy={busy}
    >
      <Rows
        label="Kopplung"
        items={[
          { key: "watch", label: "Uhr", value: pair.device_label },
          { key: "code", label: "Code auf der Uhr", value: pair.user_code },
          {
            key: "at",
            label: "Angefragt",
            value: `${timeLabel(confirm!.requested_at)} Uhr`,
          },
          {
            key: "until",
            label: "Gültig bis",
            value: `${timeLabel(confirm!.expires_at)} Uhr`,
          },
        ]}
      />
      <CardNote>
        Stimmt der Code mit dem auf deiner Uhr überein? Nur dann verbinden.
      </CardNote>
      <CardActions
        primary={{
          label: busy ? "Wird verbunden …" : "Uhr verbinden",
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
  );
}

type Ask =
  { kind: "unpair"; watch: Watch } | { kind: "revoke" } | { kind: "grant" };

/**
 * "Dein Konto · Garmin-Uhr": status, last contact, unpairing and the consent
 * for health data. Every change is a click and a confirmation in the card.
 */
function WatchesCard({
  client,
  initial,
}: {
  client: ArnoldMcpClient;
  initial: ListGarminWatches;
}) {
  const [data, setData] = useState(initial);
  const [ask, setAsk] = useState<Ask>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UiFailure>();
  const [done, setDone] = useState<string>();
  const guard = useRef(false);
  useEffect(() => {
    setData(initial);
    setAsk(undefined);
    setFailure(undefined);
  }, [initial]);
  const consent = data.health_consent;
  useModelContext(
    client,
    `Arnold zeigt das Konto ${data.account_label} mit ${data.watches.length} verbundenen Garmin-Uhr(en)${data.watches.length ? ` (${data.watches.map((w) => w.label).join(", ")})` : ""}; Einwilligung für Messwerte ${consent.granted ? "erteilt" : "nicht erteilt"}. Trennen und Einwilligung ändert nur der Nutzer in der Karte oder auf ausdrücklichen Wunsch.`,
  );
  async function run(action: () => Promise<string>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setFailure(undefined);
    try {
      const message = await action();
      setData(await client.listGarminWatches());
      setAsk(undefined);
      setDone(message);
    } catch (error) {
      setFailure(asFailure(error, "retry_same_request"));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const unpair = (watch: Watch) =>
    run(async () => {
      await client.unpairGarminWatch(watch.device_id);
      return `${watch.label} ist getrennt. Die Uhr hat keinen Zugriff mehr.`;
    });
  const grant = () =>
    run(async () => {
      await client.setGarminHealthConsent(true, consent.current_text_version);
      return "Einwilligung erteilt: Arnold speichert ab jetzt Messwerte zu deinen Uhr-Trainings.";
    });
  const revoke = () =>
    run(async () => {
      const result = await client.setGarminHealthConsent(false);
      return result.deleted_health_records
        ? `Einwilligung widerrufen. ${result.deleted_health_records} gespeicherte Messwert-Datensätze sind gelöscht.`
        : "Einwilligung widerrufen. Arnold speichert keine Messwerte mehr.";
    });

  if (failure)
    return (
      <RecoveryCard
        recovery={failure.recovery}
        busy={busy}
        onAction={() => {
          setFailure(undefined);
          void client
            .listGarminWatches()
            .then(setData)
            .catch((error) =>
              setFailure(asFailure(error, "retry_same_request")),
            );
        }}
      />
    );

  if (ask?.kind === "unpair")
    return (
      <ArnoldCard
        label={`Dein Konto · ${data.account_label}`}
        title={`${ask.watch.label} trennen?`}
        subtitle="Die Uhr verliert sofort den Zugriff. Deine gespeicherten Trainings bleiben."
        busy={busy}
      >
        <CardActions
          primary={{
            label: busy ? "Wird getrennt …" : "Uhr trennen",
            tone: "danger",
            onClick: () => void unpair(ask.watch),
            disabled: busy,
          }}
          secondary={{
            label: "Abbrechen",
            onClick: () => setAsk(undefined),
            disabled: busy,
          }}
        />
      </ArnoldCard>
    );
  if (ask?.kind === "revoke")
    return (
      <ArnoldCard
        label={`Dein Konto · ${data.account_label}`}
        title="Messwerte nicht mehr speichern?"
        subtitle="Arnold löscht sofort alle gespeicherten Messwerte deiner Uhr. Deine Trainings bleiben."
        busy={busy}
      >
        <CardActions
          primary={{
            label: busy ? "Wird widerrufen …" : "Einwilligung widerrufen",
            tone: "danger",
            onClick: () => void revoke(),
            disabled: busy,
          }}
          secondary={{
            label: "Abbrechen",
            onClick: () => setAsk(undefined),
            disabled: busy,
          }}
        />
      </ArnoldCard>
    );
  if (ask?.kind === "grant")
    return (
      <ArnoldCard
        label={`Dein Konto · ${data.account_label}`}
        title="Messwerte der Uhr speichern?"
        busy={busy}
      >
        <p className="ac-sub">{HEALTH_CONSENT_HINT}</p>
        <CardActions
          primary={{
            label: busy ? "Wird gespeichert …" : "Einwilligen",
            onClick: () => void grant(),
            disabled: busy,
          }}
          secondary={{
            label: "Abbrechen",
            onClick: () => setAsk(undefined),
            disabled: busy,
          }}
        />
      </ArnoldCard>
    );

  const only = data.watches.length === 1 ? data.watches[0] : undefined;
  return (
    <ArnoldCard
      label={`Dein Konto · ${data.account_label}`}
      title={
        data.watches.length
          ? only
            ? only.label
            : `${data.watches.length} Garmin-Uhren`
          : "Keine Garmin-Uhr verbunden"
      }
      subtitle={
        data.watches.length
          ? "Verbunden mit Arnold. Die Uhr zeigt dieselbe Kurzkennung."
          : "Starte Arnold auf deiner Uhr und nenne mir den Code, den sie zeigt."
      }
      busy={busy}
    >
      {done && <CardNote>{done}</CardNote>}
      {data.watches.map((watch) => (
        <div key={watch.device_id}>
          {!only && <h3 className="ac-section-title">{watch.label}</h3>}
          <Rows
            label={`Garmin-Uhr ${watch.label}`}
            items={[
              { key: "status", label: "Status", value: "Verbunden" },
              {
                key: "since",
                label: "Verbunden seit",
                value: dateTimeLabel(watch.paired_at),
              },
              {
                key: "last",
                label: "Letzter Kontakt",
                value: watch.last_used_at
                  ? dateTimeLabel(watch.last_used_at)
                  : "Noch kein Kontakt",
              },
            ]}
          />
          {!only && (
            <button
              type="button"
              className="ac-link"
              disabled={busy}
              onClick={() => setAsk({ kind: "unpair", watch })}
            >
              {watch.label} trennen
            </button>
          )}
        </div>
      ))}
      <div>
        <h3 className="ac-section-title">Messwerte</h3>
        <Rows
          label="Einwilligung Messwerte"
          items={[
            {
              key: "consent",
              label: "Einwilligung",
              value: consent.granted ? "Erteilt" : "Nicht erteilt",
            },
          ]}
        />
        <p className="ac-sub">
          {consent.granted
            ? "Arnold speichert Puls, Kalorien, Body Battery und Stress zu deinen Uhr-Trainings. Ein Widerruf löscht sie."
            : "Ohne Einwilligung speichert Arnold nur dein Training, keine Messwerte."}
        </p>
      </div>
      <CardActions
        primary={
          consent.granted
            ? {
                label: "Messwerte nicht mehr speichern",
                tone: "secondary",
                onClick: () => setAsk({ kind: "revoke" }),
                disabled: busy,
              }
            : {
                label: "Messwerte speichern",
                onClick: () => setAsk({ kind: "grant" }),
                disabled: busy,
              }
        }
        secondary={
          only
            ? {
                label: "Uhr trennen",
                onClick: () => setAsk({ kind: "unpair", watch: only }),
                disabled: busy,
              }
            : undefined
        }
      />
    </ArnoldCard>
  );
}
