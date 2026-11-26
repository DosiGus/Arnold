/**
 * The screens after the setup (src/views): without an answer from Arnold they
 * say "wird geladen" or show the error, never stand-in figures. Goals and
 * records stay reachable when empty, the watch step is honest while the watch
 * app is not published, and the consent text stands where the user says yes.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HEALTH_CONSENT_TEXT } from "../src/shared/health-consent";
import { EMPTY, viewOf } from "../src/views/demo/model";
import { HealthEmpty } from "../src/views/live/health";
import { HealthConsent } from "../src/views/live/settings";
import { AppShell, Waiting } from "../src/views/onboarding/app";
import { Dashboard, type Screen } from "../src/views/onboarding/dashboard";
import {
  RecordsScreen,
  SettingsScreen,
  StatsScreen,
} from "../src/views/onboarding/screens";
import { Done, WearableStep } from "../src/views/onboarding/steps";

vi.mock("skybridge/web", () => ({
  DataLLM: ({ children }: { children: unknown }) => children,
  useCallTool: () => ({ callToolAsync: () => new Promise(() => {}) }),
  useToolInfo: () => ({ isPending: true }),
  useOpenExternal: () => () => {},
  useSendFollowUpMessage: () => () => {},
}));

const noop = () => {};
const text = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const view = viewOf({
  profile: { ...EMPTY, strength: true, run: true, weight: 80 },
  plan: null,
  confirmed: true,
  wearable: "open",
  done: true,
});

describe("before Arnold has answered", () => {
  const screens: Screen[] = ["dashboard", "records", "goals", "stats"];
  it.each(screens)("%s only says that it loads", (initial) => {
    const output = text(
      <AppShell
        view={view}
        initial={initial}
        onAsk={noop}
        onEditProfile={noop}
      />,
    );
    expect(output).toContain("Wird geladen");
    expect(output).not.toMatch(/\d+ kg|Beispieldaten|Bankdrücken|\d+ km/);
  });

  it("shows a failed load with a retry", () => {
    const output = text(
      <Waiting screen="goals" failed onRetry={noop} onBack={noop} />,
    );
    expect(output).toContain("lassen sich gerade nicht laden");
    expect(output).toContain("Noch einmal versuchen");
  });
});

describe("overview of a new account", () => {
  const d = {
    sample: false,
    hasPlan: false,
    next: null,
    today: [],
    week: { goal: 3, done: 0, days: [] },
    scores: [],
    goals: [],
    records: [],
  };

  it("keeps the way to goals and records open", () => {
    const output = text(<Dashboard d={d} onAsk={noop} go={noop} />);
    expect(output).toContain("Noch keine Ziele");
    expect(output).toContain("Ziel hinzufügen");
    expect(output).toContain("Noch keine Rekorde");
    expect(output).toContain("Alle Rekorde ansehen");
  });

  it("offers Health Data only where values can come", () => {
    expect(text(<Dashboard d={d} onAsk={noop} go={noop} />)).not.toContain(
      "Health Data",
    );
    expect(text(<Dashboard d={d} health onAsk={noop} go={noop} />)).toContain(
      "Health Data",
    );
  });

  it("invents no records", () => {
    const output = text(
      <RecordsScreen onBack={noop} records={[]} runRecords={[]} />,
    );
    expect(output).toContain("Noch keine Rekorde");
    expect(output).not.toMatch(/\d/);
  });
});

describe("watch step", () => {
  const step = (storeUrl: string | null, wearable: "open" | "connect") =>
    text(
      <WearableStep
        view={{ ...view, wearable }}
        busy={null}
        onChoose={noop}
        onFinish={noop}
        onOpenStore={noop}
        storeUrl={storeUrl}
        pairing={<span>Codefeld</span>}
      />,
    );

  it("says the app is not available instead of linking to the store", () => {
    const output = step(null, "open");
    expect(output).toContain("noch nicht im Connect IQ Store verfügbar");
    expect(output).not.toContain("Connect IQ Store öffnen");
    expect(output).toContain("Ohne Uhr weiter");
  });

  it("links the store once the app has a page", () => {
    expect(step("https://apps.garmin.com/apps/x", "open")).toContain(
      "Connect IQ Store öffnen",
    );
  });

  it("asks for the code, without an invented one", () => {
    const output = step(null, "connect");
    expect(output).toContain("Codefeld");
    expect(output).not.toContain("482");
  });

  it("mentions the watch at the end only when it is paired", () => {
    const done = (wearable: "later" | "paired") =>
      text(
        <Done
          view={{ ...view, wearable }}
          onNext={noop}
          onDashboard={noop}
          onSettings={noop}
        />,
      );
    expect(done("later")).not.toContain("Uhr");
    expect(done("paired")).toContain("deine Uhr ist verbunden");
  });
});

describe("health values and consent", () => {
  const consent = (granted: boolean, textIsCurrent = true) =>
    text(
      <HealthConsent
        status={{ granted, textIsCurrent }}
        pending={false}
        done={null}
        error={null}
        onChange={async () => {}}
      />,
    );

  it("shows the approved text next to the yes", () => {
    const output = consent(false);
    expect(output).toContain(HEALTH_CONSENT_TEXT);
    expect(output).toContain("Einwilligen");
    expect(consent(true)).toContain("Einwilligung widerrufen");
  });

  it("takes no yes for a text it cannot show", () => {
    const output = consent(false, false);
    expect(output).not.toContain(HEALTH_CONSENT_TEXT);
    expect(output).not.toContain("Einwilligen");
  });

  it("leads from an empty Health Data screen to the consent", () => {
    const empty = (status: "no_consent" | "not_connected" | "consented") =>
      text(<HealthEmpty status={status} onBack={noop} onConsent={noop} />);
    expect(empty("no_consent")).toContain("Einwilligung ansehen");
    expect(empty("consented")).toContain("noch keine Werte");
    expect(empty("not_connected")).not.toContain("Einwilligung");
  });
});

describe("settings and progress", () => {
  it("announces nothing that does not exist yet", () => {
    const output = text(
      <SettingsScreen
        view={view}
        onBack={noop}
        onEditProfile={noop}
        watchBox={null}
        consentBox={null}
        dataBox={null}
      />,
    );
    expect(output).not.toMatch(/Bald verfügbar|Erinnerungen/);
  });

  it("dates the ends of the curve and gives its scale", () => {
    const output = text(
      <StatsScreen
        onBack={noop}
        live={{
          range: "12",
          onRange: noop,
          exercise: null,
          series: [
            {
              key: "e1rm",
              label: "Kraft",
              unit: "kg",
              points: [70, 72.5],
              delta: 2.5,
              axis: { from: "1. Nov.", to: "8. Nov." },
              range: { low: 70, high: 72.5 },
            },
          ],
        }}
      />,
    );
    expect(output).toContain("1. Nov.");
    expect(output).toContain("8. Nov.");
    expect(output).toContain("Höchster Wert 72,5 kg");
    expect(output).not.toContain("vor 12 Wochen");
  });
});
