import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useCallback, useEffect, useState } from "react";
import { DataLLM } from "skybridge/web";
import { DeleteAccountPublicResponseSchema } from "../../shared/account-contract.js";
import type { ArnoldDashboardView } from "../../shared/arnold-view.js";
import { PlanCardSchema } from "../../shared/onboarding-contract.js";
import {
  ListGarminWatchesSchema,
  SetGarminHealthConsentResponseSchema,
  UnpairGarminWatchResponseSchema,
} from "../../shared/watch-contract.js";
import { ArnoldCallError, useArnoldTool } from "../arnold-client.js";
import type { OnboardingView } from "../demo/model.js";
import { cardProfileOf } from "../model/onboarding.js";
import {
  accountErrorText,
  consentDoneText,
  consentInput,
  consentStatus,
  deleteConfirmation,
  planOnWatchText,
  watchStatus,
  type ConsentStatus,
  type DeleteConfirmation,
  type WatchStatus,
} from "../model/settings.js";
import { SettingsScreen } from "../onboarding/screens.js";
import {
  GARMIN_STORE_URL,
  WATCH_APP_UNAVAILABLE,
} from "../onboarding/steps.js";
import { HEALTH_CONSENT_TEXT } from "../../shared/health-consent.js";
import { WatchPairing } from "./watch-pairing.js";

const errorText = (e: unknown, fallback: string) =>
  e instanceof ArnoldCallError ? accountErrorText(e.code, e.message) : fallback;

/** Garmin box: the paired watch from `list_garmin_watches`, pair, unpair. */
function WatchBox({
  delivery,
}: {
  delivery?: ArnoldDashboardView["watch_delivery"];
}) {
  const list = useArnoldTool("list_garmin_watches", ListGarminWatchesSchema);
  const unpair = useArnoldTool(
    "unpair_garmin_watch",
    UnpairGarminWatchResponseSchema,
  );
  const [status, setStatus] = useState<WatchStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Paired in this card, until the watch has fetched its access. */
  const [settingUp, setSettingUp] = useState<string | null>(null);
  const { call } = list;
  const load = useCallback(
    () =>
      call()
        .then((l) => {
          setStatus(watchStatus(l));
          setUnavailable(false);
        })
        .catch(() => setUnavailable(true)),
    [call],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // The watch shows up in the list once it has fetched its access (seconds).
  useEffect(() => {
    if (!settingUp || status?.connected) {
      if (status?.connected) setSettingUp(null);
      return;
    }
    const timer = setTimeout(() => void load(), 5000);
    return () => clearTimeout(timer);
  }, [settingUp, status, load]);

  if (unavailable)
    return (
      <span className="text-sm text-secondary">
        Die Uhr-Verbindung lässt sich hier gerade nicht anzeigen.
      </span>
    );
  if (!status)
    return <span className="text-sm text-secondary">Wird geladen …</span>;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-secondary">
          {status.connected
            ? `Verbunden: ${status.label}`
            : settingUp
              ? `${settingUp} wird eingerichtet …`
              : "Nicht verbunden"}
        </span>
        <Badge
          color={status.connected ? "success" : "secondary"}
          variant="soft"
          pill
        >
          {status.connected ? "Aktiv" : "Aus"}
        </Badge>
      </div>
      {status.connected && planOnWatchText(delivery) && (
        <span className="text-sm text-secondary">
          {planOnWatchText(delivery)}
        </span>
      )}
      {!status.connected && GARMIN_STORE_URL === null && (
        <span className="text-sm text-secondary">{WATCH_APP_UNAVAILABLE}</span>
      )}
      {error && <Alert color="danger" variant="soft" title={error} />}
      {pairing ? (
        <WatchPairing
          onPaired={(label) => {
            setPairing(false);
            setSettingUp(label);
            void load();
          }}
          onCancel={() => setPairing(false)}
        />
      ) : settingUp && !status.connected ? null : status.connected &&
        status.deviceId ? (
        confirmUnpair ? (
          <div className="grid auto-cols-fr grid-flow-col gap-2">
            <Button
              color="danger"
              variant="soft"
              block
              loading={unpair.pending}
              onClick={async () => {
                setError(null);
                try {
                  await unpair.call({ device_id: status.deviceId });
                  setConfirmUnpair(false);
                  await load();
                } catch (e) {
                  setError(errorText(e, "Die Uhr ließ sich nicht trennen."));
                }
              }}
            >
              Wirklich trennen
            </Button>
            <Button
              color="secondary"
              variant="ghost"
              block
              onClick={() => setConfirmUnpair(false)}
            >
              Abbrechen
            </Button>
          </div>
        ) : (
          <Button
            color="secondary"
            variant="soft"
            block
            onClick={() => setConfirmUnpair(true)}
          >
            Verbindung trennen
          </Button>
        )
      ) : (
        <Button
          color="secondary"
          variant="soft"
          block
          onClick={() => setPairing(true)}
        >
          Garmin-Uhr verbinden
        </Button>
      )}
    </>
  );
}

/**
 * Consent for the watch's health values: the approved text, then the user's
 * click gives or revokes it (`set_garmin_health_consent`). Revoking deletes
 * the stored values, so it asks once more.
 */
function ConsentBox() {
  const list = useArnoldTool("list_garmin_watches", ListGarminWatchesSchema);
  const set = useArnoldTool(
    "set_garmin_health_consent",
    SetGarminHealthConsentResponseSchema,
  );
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { call } = list;
  const load = useCallback(
    () =>
      call()
        .then((l) => {
          setStatus(consentStatus(l));
          setUnavailable(false);
        })
        .catch(() => setUnavailable(true)),
    [call],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (unavailable)
    return (
      <span className="text-sm text-secondary">
        Die Einwilligung lässt sich hier gerade nicht anzeigen.
      </span>
    );
  if (!status)
    return <span className="text-sm text-secondary">Wird geladen …</span>;
  return (
    <HealthConsent
      status={status}
      pending={set.pending}
      done={done}
      error={error}
      onChange={async (granted) => {
        setError(null);
        setDone(null);
        try {
          const res = await set.call(consentInput(granted));
          setDone(consentDoneText(res.granted, res.deleted_health_records));
          await load();
        } catch (e) {
          setError(errorText(e, "Die Einwilligung ließ sich nicht speichern."));
          await load();
        }
      }}
    />
  );
}

/** The consent's wording, state and buttons. */
export function HealthConsent({
  status,
  pending,
  done,
  error,
  onChange,
}: {
  status: ConsentStatus;
  pending: boolean;
  done: string | null;
  error: string | null;
  onChange: (granted: boolean) => Promise<void>;
}) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-secondary">Einwilligung</span>
        <Badge
          color={status.granted ? "success" : "secondary"}
          variant="soft"
          pill
        >
          {status.granted ? "Erteilt" : "Nicht erteilt"}
        </Badge>
      </div>
      {status.textIsCurrent ? (
        <p className="m-0 text-sm text-secondary">{HEALTH_CONSENT_TEXT}</p>
      ) : (
        <p className="m-0 text-sm text-secondary">
          Der Einwilligungstext wurde geändert. Öffne Arnold neu, um den
          aktuellen Text zu sehen.
        </p>
      )}
      {done && <Alert color="success" variant="soft" title={done} />}
      {error && <Alert color="danger" variant="soft" title={error} />}
      {status.granted ? (
        confirmRevoke ? (
          <>
            <span className="text-sm">
              Arnold löscht dann sofort alle gespeicherten Messwerte deiner Uhr.
              Deine Trainings bleiben.
            </span>
            <div className="grid auto-cols-fr grid-flow-col gap-2">
              <Button
                color="danger"
                variant="soft"
                block
                loading={pending}
                onClick={() =>
                  void onChange(false).then(() => setConfirmRevoke(false))
                }
              >
                Wirklich widerrufen
              </Button>
              <Button
                color="secondary"
                variant="ghost"
                block
                onClick={() => setConfirmRevoke(false)}
              >
                Abbrechen
              </Button>
            </div>
          </>
        ) : (
          <Button
            color="secondary"
            variant="soft"
            block
            onClick={() => setConfirmRevoke(true)}
          >
            Einwilligung widerrufen
          </Button>
        )
      ) : (
        status.textIsCurrent && (
          <Button
            color="primary"
            block
            loading={pending}
            onClick={() => void onChange(true)}
          >
            Einwilligen
          </Button>
        )
      )}
    </>
  );
}

/** Data box: delete the account in two steps with `delete_arnold_account`. */
function DeleteBox() {
  const del = useArnoldTool(
    "delete_arnold_account",
    DeleteAccountPublicResponseSchema,
  );
  const [confirm, setConfirm] = useState<DeleteConfirmation | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (deleted)
    return (
      <Alert
        color="success"
        variant="soft"
        title="Dein Arnold-Konto ist gelöscht. Alle gespeicherten Daten sind entfernt."
      />
    );
  return (
    <>
      {confirm && (
        <div className="flex flex-col gap-1 text-sm">
          <span>Gelöscht wird, ohne Rückweg:</span>
          <ul className="m-0 pl-5 text-secondary">
            {confirm.summary.stored_items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <Alert color="danger" variant="soft" title={error} />}
      {confirm ? (
        <div className="grid auto-cols-fr grid-flow-col gap-2">
          <Button
            color="danger"
            variant="soft"
            block
            loading={del.pending}
            onClick={async () => {
              setError(null);
              try {
                const done = await del.call({
                  confirmation_token: confirm.confirmation_token,
                });
                if (done.stage === "deleted") setDeleted(true);
              } catch (e) {
                setConfirm(null);
                setError(errorText(e, "Das Konto ließ sich nicht löschen."));
              }
            }}
          >
            Endgültig löschen
          </Button>
          <Button
            color="secondary"
            variant="ghost"
            block
            onClick={() => setConfirm(null)}
          >
            Abbrechen
          </Button>
        </div>
      ) : (
        <Button
          color="danger"
          variant="ghost"
          block
          loading={del.pending}
          onClick={async () => {
            setError(null);
            try {
              const { arnold } = await del.callWithMeta();
              const c = deleteConfirmation(arnold);
              if (c) setConfirm(c);
              else setError("Das Löschen ist gerade nicht möglich.");
            } catch (e) {
              setError(
                errorText(e, "Das Löschen ist hier gerade nicht möglich."),
              );
            }
          }}
        >
          Alle Daten löschen
        </Button>
      )}
    </>
  );
}

/**
 * The settings screen on Arnold's account: the real profile from
 * `get_plan_card`, the paired watch, the consent for its health values and
 * the account deletion.
 */
export function LiveSettingsScreen({
  view,
  watchDelivery,
  onBack,
  onEditProfile,
}: {
  view: OnboardingView;
  /** Whether the plan has reached the watch, from the dashboard answer. */
  watchDelivery?: ArnoldDashboardView["watch_delivery"];
  onBack: () => void;
  onEditProfile: () => void;
}) {
  const { call } = useArnoldTool("get_plan_card", PlanCardSchema);
  const [live, setLive] = useState<OnboardingView>(view);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    call()
      .then((card) => {
        if (card.profile)
          setLive((v) => ({ ...v, profile: cardProfileOf(card.profile!) }));
      })
      .catch(() => setFailed(true));
  }, [call]);
  return (
    <DataLLM content="Einstellungen-Karte: Profil, Garmin-Uhr, Einwilligung für Messwerte, Daten löschen.">
      {failed && (
        <Alert
          color="warning"
          variant="soft"
          title="Dein Profil lässt sich gerade nicht neu laden."
        />
      )}
      <SettingsScreen
        view={live}
        onBack={onBack}
        onEditProfile={onEditProfile}
        watchBox={<WatchBox delivery={watchDelivery} />}
        consentBox={<ConsentBox />}
        dataBox={<DeleteBox />}
      />
    </DataLLM>
  );
}
