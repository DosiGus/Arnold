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

  it("shows the five approved widgets with server figures and labelled demo scores", () => {
    const output = text(<HomeCard view={view} canWrite onOpen={noop} />);
    expect(output).toContain("Training");
    expect(output).toContain("Als Nächstes");
    expect(output).toContain("Training bearbeiten");
    expect(output).toContain("Plan bearbeiten");
    expect(output).not.toMatch(/Guten (Morgen|Abend)|Hallo/);
    expect(output).toContain("Dein Überblick");
    expect(output).toContain("Demo-Scores");
    expect(output).toContain("Konstanz");
    expect(output).toContain("Recovery");
    expect(output).toContain("Progress");
    expect(output).toContain(
      `${view.home.streak.current_week_training_days} / ${view.home.streak.weekly_goal}`,
    );
    expect(output).toContain("Körpergewicht");
    expect(output).toContain(`1 / ${Math.min(3, view.home.records.length)}`);
    expect(output).toContain(view.home.records[0].exercise_name);
    for (const goal of view.home.goals.slice(0, 4))
      expect(output).toContain(goal.name);
    expect(output).not.toMatch(/NaN|undefined|null/);
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
    expect(output).toContain("Setz dir ein Ziel");
    expect(output).not.toMatch(/NaN|undefined/);
    const stats = text(<StatsView view={view} onOpen={noop} />);
    expect(stats).toContain("–");
    expect(stats).not.toMatch(/\+0 %|NaN/);
  });
});
