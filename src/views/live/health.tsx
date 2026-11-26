import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useEffect, useState } from "react";
import { DataLLM } from "skybridge/web";
import {
  HealthDataSchema,
  type HealthData,
} from "../../shared/health-contract.js";
import { useArnoldTool } from "../arnold-client.js";
import type { OnboardingView } from "../demo/model.js";
import { healthDayLabel, healthModel } from "../model/health.js";
import { HealthScreen, ScreenHeader } from "../onboarding/screens.js";

/**
 * The Health Data screen on the user's own Garmin values (`get_health_data`,
 * app only). Without consent no value is read; the screen says so and offers
 * to give it in the chat, where Arnold asks before switching it on.
 */
export function LiveHealthScreen({
  view,
  onBack,
  onAsk,
}: {
  view: OnboardingView;
  onBack: () => void;
  onAsk: (sentence: string) => void;
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
  if (!data.summary)
    return (
      <DataLLM content="Health-Data-Karte: keine Gesundheitsdaten freigegeben.">
        <div className="flex flex-col gap-5">
          <ScreenHeader title="Health Data" onBack={onBack} />
          <p className="m-0 text-sm text-secondary">
            Das sammelt deine Garmin-Uhr. Arnold liest diese Werte nur mit
            deiner Einwilligung und nutzt sie für die Erholung.
          </p>
          <Alert
            color="info"
            variant="soft"
            title={
              data.status === "no_consent"
                ? "Du hast Arnold deine Gesundheitsdaten noch nicht freigegeben."
                : "Für dein Konto liegen noch keine Werte deiner Uhr vor."
            }
          />
          {data.status === "no_consent" && (
            <Button
              color="secondary"
              variant="soft"
              size="lg"
              block
              onClick={() =>
                onAsk(
                  "Ich möchte Arnold meine Garmin-Gesundheitsdaten freigeben.",
                )
              }
            >
              Im Chat freigeben
            </Button>
          )}
        </div>
      </DataLLM>
    );
  const s = data.summary;
  return (
    <DataLLM
      content={`Health-Data-Karte: Werte ${s.latest_date ? `bis ${s.latest_date}` : "noch keine in den letzten sieben Tagen"}.`}
    >
      <HealthScreen
        view={view}
        onBack={onBack}
        data={healthModel(s)}
        dayLabel={healthDayLabel(s)}
      />
    </DataLLM>
  );
}
