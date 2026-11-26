import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useEffect, useState } from "react";
import { DataLLM, useSendFollowUpMessage } from "skybridge/web";
import {
  LogMobilityResponseSchema,
  MobilityOverviewSchema,
  type MobilityOverview,
} from "../../shared/mobility-contract.js";
import { ArnoldCallError, useArnoldTool } from "../arnold-client.js";
import type { PlanKind } from "../demo/model.js";
import {
  firstOpen,
  logMobilityInput,
  routineDay,
  routinesOf,
} from "../model/mobility.js";
import { ScreenHeader, SessionChecklist } from "../onboarding/screens.js";
import { dataChanged } from "./data-changed.js";
import { draftOf, dropDraft } from "./drafts.js";

/**
 * Morning routine and mobility on Arnold's data: today's routines from
 * `get_mobility_overview`, "Fertig" stores one with `log_mobility`.
 */
export function LiveMobilityScreen({
  kind,
  onBack,
}: {
  kind: PlanKind;
  onBack: () => void;
}) {
  const sendFollowUp = useSendFollowUpMessage();
  const read = useArnoldTool("get_mobility_overview", MobilityOverviewSchema);
  const log = useArnoldTool("log_mobility", LogMobilityResponseSchema);
  const [overview, setOverview] = useState<MobilityOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { call } = read;
  useEffect(() => {
    call({ timezone })
      .then(setOverview)
      .catch(() => setFailed(true));
  }, [call, timezone]);

  const title = kind === "morning" ? "Morgenroutine" : "Mobility";
  const message = (children: React.ReactNode) => (
    <div className="flex flex-col gap-4">
      <ScreenHeader title={title} onBack={onBack} />
      {children}
    </div>
  );
  if (failed)
    return message(
      <Alert
        color="danger"
        variant="soft"
        title="Deine Routine lässt sich gerade nicht laden."
      />,
    );
  if (!overview)
    return message(
      <p className="m-0 text-secondary">Routine wird geladen …</p>,
    );
  const routines = routinesOf(overview, kind);
  const routine =
    routines.find((r) => r.session_id === picked) ?? firstOpen(routines);
  if (!routine)
    return message(
      <>
        <p className="m-0 text-secondary">
          {overview.profile.state === "yes"
            ? "Heute steht dafür nichts in deinem Plan."
            : "Du hast Mobility noch nicht eingerichtet."}
        </p>
        {overview.profile.state !== "yes" && (
          <Button
            color="primary"
            block
            onClick={() => void sendFollowUp("Ich möchte Mobility einrichten.")}
          >
            Mobility einrichten
          </Button>
        )}
      </>,
    );
  const key = `mobility:${overview.today.date_local}:${routine.session_id}`;
  const draft = draftOf<Record<string, boolean>>(key);
  return (
    <DataLLM
      content={`Routinen-Karte: ${routine.session_name}, heute ${routine.done ? "erledigt" : "offen"}.`}
    >
      <div className="flex flex-col gap-4">
        <SessionChecklist
          key={key}
          day={routineDay(routine)}
          onBack={onBack}
          live={{
            initial: draft.value ?? {},
            saved: routine.done,
            onChange: (done) => {
              draft.value = done;
            },
            onFinish: async () => {
              try {
                await log.call(
                  logMobilityInput(overview, routine, {
                    requestId: draft.requestId,
                    timezone,
                  }),
                );
              } catch (e) {
                return e instanceof ArnoldCallError
                  ? e.message
                  : "Die Routine ließ sich nicht speichern.";
              }
              dropDraft(key);
              setPicked(routine.session_id);
              setOverview({
                ...overview,
                today: {
                  ...overview.today,
                  items: overview.today.items.map((i) =>
                    i.session_id === routine.session_id
                      ? { ...i, done: true }
                      : i,
                  ),
                },
              });
              dataChanged();
              return null;
            },
          }}
        />
        {routines
          .filter((r) => r.session_id !== routine.session_id)
          .map((r) => (
            <Button
              key={r.session_id}
              color="secondary"
              variant="soft"
              block
              onClick={() => setPicked(r.session_id)}
            >
              {r.session_name} {r.done ? "(erledigt)" : "ansehen"}
            </Button>
          ))}
      </div>
    </DataLLM>
  );
}
