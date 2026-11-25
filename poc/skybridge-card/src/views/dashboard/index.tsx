import "../../index.css";

import { DataLLM, useSendFollowUpMessage } from "skybridge/web";
import type { OnboardingView } from "../../onboarding/model.js";
import { useToolInfo } from "../../helpers.js";
import { useHostTheme } from "../../use-host-theme.js";
import { AppShell } from "../onboarding/app.js";

/** Own view for `show_dashboard`; the setup card also embeds the same screen. */
export default function DashboardView() {
  useHostTheme();
  const info = useToolInfo<"show_dashboard">();
  const sendFollowUp = useSendFollowUpMessage();
  if (info.isPending)
    return <p className="p-4 text-secondary">Dashboard wird geladen …</p>;
  const view = (info.output as { state: OnboardingView }).state;
  return (
    <DataLLM content="Dashboard mit Beispieldaten: nächstes Training, Woche, Scores, Ziele, Rekorde.">
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4">
        <AppShell
          view={view}
          onAsk={(t) => void sendFollowUp(t)}
          onEditProfile={() =>
            void sendFollowUp("Ich möchte meine Angaben ändern.")
          }
        />
      </main>
    </DataLLM>
  );
}
