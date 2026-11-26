import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useEffect, useState } from "react";
import { DataLLM } from "skybridge/web";
import {
  HealthDataSchema,
  type HealthData,
} from "../../shared/health-contract.js";
import { useArnoldTool } from "../arnold-client.js";
import {
  healthDayLabel,
  healthEmptyText,
  healthModel,
} from "../model/health.js";
import { HealthScreen, ScreenHeader } from "../onboarding/screens.js";

/**
 * The Health Data screen on the user's own Garmin values (`get_health_data`,
 * app only). Without consent no value is read; the screen says so and leads to
 * the consent in the settings. Where no values can come, or none have come
 * yet, it says that in one sentence instead of showing empty tiles.
 */
export function LiveHealthScreen({
  onBack,
  onConsent,
}: {
  onBack: () => void;
  onConsent: () => void;
}) {
  const { call } = useArnoldTool("get_health_data", HealthDataSchema);
  const [data, setData] = useState<HealthData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    call({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      .then(setData)
      .catch(() => setFailed(true));
  }, [call]);

  if (failed)
    return (
      <div className="flex flex-col gap-5">
        <ScreenHeader title="Health Data" onBack={onBack} />
        <Alert
          color="danger"
          variant="soft"
          title="Deine Gesundheitsdaten lassen sich gerade nicht laden."
        />
      </div>
    );
  if (!data)
    return <p className="m-0 text-secondary">Health Data wird geladen …</p>;
  const s = data.summary;
  if (!s || s.latest_date === null)
    return (
      <DataLLM content="Health-Data-Karte: keine Gesundheitswerte vorhanden.">
        <HealthEmpty
          status={data.status}
          onBack={onBack}
          onConsent={onConsent}
        />
      </DataLLM>
    );
  return (
    <DataLLM content={`Health-Data-Karte: Werte bis ${s.latest_date}.`}>
      <HealthScreen
        onBack={onBack}
        data={healthModel(s)}
        dayLabel={healthDayLabel(s)}
        onConsent={onConsent}
      />
    </DataLLM>
  );
}

/** Why there is nothing to show, and the one thing the user can do. */
export function HealthEmpty({
  status,
  onBack,
  onConsent,
}: {
  status: HealthData["status"];
  onBack: () => void;
  onConsent: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader title="Health Data" onBack={onBack} />
      <Alert color="info" variant="soft" title={healthEmptyText(status)} />
      {status !== "not_connected" && (
        <Button
          color="secondary"
          variant="soft"
          size="lg"
          block
          onClick={onConsent}
        >
          {status === "no_consent"
            ? "Einwilligung ansehen"
            : "Einwilligung verwalten"}
        </Button>
      )}
    </div>
  );
}
