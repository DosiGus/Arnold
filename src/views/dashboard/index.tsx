import "../index.css";

import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { useCallback, useEffect, useState } from "react";
import { DataLLM, useSendFollowUpMessage } from "skybridge/web";
import {
  ArnoldDashboardViewSchema,
  type ArnoldDashboardView,
} from "../../shared/arnold-view.js";
import { useArnoldTool, useOpeningResult } from "../arnold-client.js";
import { onDataChanged } from "../live/data-changed.js";
import { EMPTY, viewOf } from "../demo/model.js";
import { dashboardModel } from "../model/dashboard.js";
import { useHostTheme } from "../use-host-theme.js";
import { AppShell } from "../onboarding/app.js";

/** Screens not wired to Arnold yet still read the POC model; empty profile. */
const PLACEHOLDER = viewOf({
  profile: { ...EMPTY },
  plan: null,
  confirmed: true,
  wearable: "open",
  done: true,
});

/**
 * View of `show_arnold_dashboard`. Shows the opening result, then reads the
 * current state once more: ChatGPT may replay an old result when the chat is
 * reopened, so the card never trusts it alone.
 */
export default function DashboardView() {
  useHostTheme();
  const sendFollowUp = useSendFollowUpMessage();
  const opening = useOpeningResult(
    "show_arnold_dashboard",
    ArnoldDashboardViewSchema,
  );
  const refresh = useArnoldTool(
    "get_arnold_dashboard",
    ArnoldDashboardViewSchema,
  );
  const [fresh, setFresh] = useState<ArnoldDashboardView | null>(null);
  const [failed, setFailed] = useState(false);
  const ready = opening.status !== "pending";
  const { call } = refresh;
  // Always with the user's zone, else Arnold cannot know what "today" is.
  const reload = useCallback(
    () =>
      call({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }).then((next) => {
        setFresh(next);
        setFailed(false);
      }),
    [call],
  );
  useEffect(() => {
    if (!ready) return;
    const load = () => void reload().catch(() => setFailed(true));
    load();
    // A screen saved something: read the overview again.
    return onDataChanged(load);
  }, [ready, reload]);

  const view = fresh ?? (opening.status === "ok" ? opening.data : null);
  if (!view) {
    if (opening.status === "error" && failed)
      return (
        <main className="mx-auto w-full max-w-xl p-4">
          <Alert
            color="danger"
            variant="soft"
            title="Dein Überblick lässt sich gerade nicht laden."
          />
        </main>
      );
    return <p className="p-4 text-secondary">Dashboard wird geladen …</p>;
  }
  const d = dashboardModel(view);
  return (
    <DataLLM
      content={`Arnold-Überblick: Woche ${d.week.done} von ${d.week.goal} Trainingstagen, ${d.goals.length} Ziele, nächstes Training ${d.next?.name ?? "keins geplant"}.`}
    >
      <main className="mx-auto flex w-full max-w-xl min-w-0 flex-col gap-6 overflow-x-hidden p-4">
        {failed && (
          <Alert
            color="warning"
            variant="soft"
            title={
              fresh === null
                ? "Stand vom Öffnen der Karte, nicht ganz aktuell."
                : "Neu laden ging nicht, der Stand ist nicht ganz aktuell."
            }
          />
        )}
        <AppShell
          live
          view={PLACEHOLDER}
          dashboard={d}
          source={view}
          onRefresh={reload}
          onAsk={(t) => void sendFollowUp(t)}
          onEditProfile={() =>
            void sendFollowUp("Ich möchte meine Angaben ändern.")
          }
        />
      </main>
    </DataLLM>
  );
}
