/**
 * The start screen and its views, rendered from real presenter payloads.
 * Unknown values stay unknown: a new account sees no invented numbers.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import { HomeCard } from "../src/ui/views/HomeCard";
import { StatsView } from "../src/ui/views/StatsView";
import { GoalsView } from "../src/ui/views/GoalsView";
import { RecordsView } from "../src/ui/views/RecordsView";
import type { ArnoldMcpClient } from "../src/ui/client/ArnoldMcpClient";
import { emptyTrackerDataset } from "./fixtures/arnold-dashboard";

const CONTEXT = { generatedAt: "2026-11-03T18:00:00Z" };
const noop = () => {};
const client = {} as ArnoldMcpClient;
const text = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("start screen with history", () => {
  const view = buildDashboardView(demoHistoryDataset("2026-11-03"), CONTEXT, {
    reference_date: "2026-11-03",
  });

  it("shows header, four tiles and four actions, with real scores", () => {
    const output = text(<HomeCard view={view} canWrite onOpen={noop} />);
    for (const tile of ["Woche", "Scores", "Ziele", "Rekorde"])
      expect(output).toContain(tile);
    for (const action of [
      "Nächstes Training",
      "Plan ändern",
      "Urlaub oder Ausnahme",
      "Ziel anpassen",
    ])
      expect(output).toContain(action);
    expect(output).toContain("Konstanz · Fortschritt · Erholung");
    expect(output).not.toMatch(/Demo-(Wert|Score)/);
    expect(output).toContain("Training");
    expect(output).toContain("Als Nächstes");
    expect(output).toContain("Training bearbeiten");
    expect(output).toContain("Plan bearbeiten");
    expect(output).not.toMatch(/Guten (Morgen|Abend)|Hallo/);
    expect(output).toContain("Dein Überblick");
    expect(output).toContain(
      `${view.home.streak.current_week_training_days} / ${view.home.streak.weekly_goal}`,
    );
    expect(output).toContain(view.home.records[0].exercise_name);
    expect(output).not.toMatch(/NaN|undefined|null/);
    // Details show only what the view delivers.
    const scores = text(
      <HomeCard view={view} canWrite onOpen={noop} defaultOpen="scores" />,
    );
    for (const name of ["Konstanz", "Fortschritt", "Erholung"])
      expect(scores).toContain(name);
    expect(scores).not.toMatch(/Demo-|Recovery|Progress|NaN|undefined|null/);
    const consistency = view.scores!.consistency;
    if (consistency.status === "ok")
      expect(scores).toContain(
        `In ${consistency.weeks_goal_met} von ${consistency.weeks_counted} Wochen Wochenziel erreicht.`,
      );
    const goals = text(
      <HomeCard view={view} canWrite onOpen={noop} defaultOpen="goals" />,
    );
    expect(goals).toContain("Körpergewicht");
    for (const goal of view.home.goals.slice(0, 4))
      expect(goals).toContain(goal.name);
    const records = text(
      <HomeCard view={view} canWrite onOpen={noop} defaultOpen="records" />,
    );
    for (const record of view.home.records.slice(0, 3))
      expect(records).toContain(record.exercise_name);
    expect(records).toContain("Sag zum Beispiel");
    expect(records).not.toMatch(/NaN|undefined|null/);
  });

  it("renders the three views without inventing numbers", () => {
    for (const node of [
      <StatsView view={view} onOpen={noop} onBack={noop} />,
      <GoalsView
        client={client}
        view={view}
        canWrite
        onBack={noop}
        onChanged={noop}
        onOpenProgress={noop}
      />,
      <RecordsView
        view={view}
        onBack={noop}
        onOpenWorkout={noop}
        onOpenGoals={noop}
      />,
    ])
      expect(text(node)).not.toMatch(/NaN|undefined|null|Infinity/);
  });

  it("a read-only view offers no writes", () => {
    const home = renderToStaticMarkup(
      <HomeCard view={view} canWrite={false} onOpen={noop} />,
    );
    expect(home).not.toContain("starten");
    const goals = text(
      <GoalsView
        client={client}
        view={view}
        canWrite={false}
        onBack={noop}
        onChanged={noop}
        onOpenProgress={noop}
      />,
    );
    expect(goals).not.toContain("Ziel hinzufügen");
  });
});

describe("start screen of a new account", () => {
  const view = buildDashboardView(emptyTrackerDataset(), CONTEXT, {
    reference_date: "2026-11-03",
  });

  it("invites instead of showing zeros as results", () => {
    expect(view.home.records).toEqual([]);
    expect(view.home.goals).toEqual([]);
    expect(view.home.strength_change.percent).toBeNull();
    const output = text(<HomeCard view={view} canWrite onOpen={noop} />);
    expect(output).toContain("Dein erstes Training ist der Anfang.");
    expect(output).toContain("Noch keine Ziele");
    expect(output).toContain("Noch keine Rekorde");
    const goals = text(
      <HomeCard view={view} canWrite onOpen={noop} defaultOpen="goals" />,
    );
    expect(goals).toContain("Setz dir ein Ziel");
    expect(output).not.toMatch(/NaN|undefined/);
    const stats = text(<StatsView view={view} onOpen={noop} />);
    expect(stats).toContain("–");
    expect(stats).not.toMatch(/\+0 %|NaN/);
  });
});

describe("scores without enough data (UX-009)", () => {
  it("says too little data with a reason and never shows 0", () => {
    const view = buildDashboardView(emptyTrackerDataset(), CONTEXT, {
      reference_date: "2026-11-03",
    });
    const tile = text(<HomeCard view={view} canWrite onOpen={noop} />);
    expect(tile).toContain("– · – · –");
    const detail = text(
      <HomeCard view={view} canWrite onOpen={noop} defaultOpen="scores" />,
    );
    expect(detail).toContain("zu wenig Daten");
    expect(detail).toContain(
      "Noch zu wenig Daten: Es gibt noch kein Training.",
    );
    expect(detail).not.toMatch(/\b0 von 100|Demo|NaN|undefined|null/);
  });

  it("marks a recovery without watch values as estimated from training", () => {
    const view = buildDashboardView(demoHistoryDataset("2026-11-03"), CONTEXT, {
      reference_date: "2026-11-03",
    });
    if (view.scores!.recovery.status !== "ok") return;
    const detail = text(
      <HomeCard view={view} canWrite onOpen={noop} defaultOpen="scores" />,
    );
    expect(detail).toContain("Nur aus deinem Training geschätzt.");
  });
});
