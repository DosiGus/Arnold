/**
 * UX-014 on the card: the run recap shows only delivered values and no
 * suggestion; UX-014 extras: no second "Trainingsentwicklung ansehen" while the
 * scores detail is open, and a calm recovery sentence without a deduction.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecapBanner } from "../src/ui/components/recap-card";
import { scoreLines } from "../src/ui/components/home-scores";
import { HomeCard } from "../src/ui/views/HomeCard";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import type { ArnoldRecap } from "../src/shared/recap-contract";

const text = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const noop = () => {};

const runRecap = (run: NonNullable<ArnoldRecap["run"]>): ArnoldRecap => ({
  kind: "run",
  workout_id: "r-1",
  date: "2026-11-03",
  title: "Grundlage",
  from_watch: false,
  exercise_count: 0,
  working_set_count: 0,
  records: [],
  week_goal: null,
  suggestion: null,
  next_session_id: null,
  run,
});

describe("run recap card", () => {
  it("shows distance, time and pace, and no suggestion", () => {
    const out = text(
      <RecapBanner
        recap={runRecap({
          distance_m: 7000,
          duration_s: 2700,
          pace_s_per_km: 385.7,
        })}
        onNext={noop}
      />,
    );
    expect(out).toContain("Geschafft: Grundlage");
    expect(out).toContain("7");
    expect(out).toContain("45:00");
    expect(out).toContain("/km");
    expect(out).toContain("Verstanden");
    expect(out).not.toMatch(/Nächstes|Übung|Arbeitssätze|Rekord/);
  });

  it("leaves out what the server did not deliver", () => {
    const out = text(
      <RecapBanner
        recap={runRecap({
          distance_m: null,
          duration_s: 2700,
          pace_s_per_km: null,
        })}
        onNext={noop}
      />,
    );
    expect(out).toContain("45:00");
    expect(out).not.toMatch(/km|NaN|null|undefined|0 Übungen/);
  });
});

describe("overview extras", () => {
  const view = buildDashboardView(
    demoHistoryDataset("2026-11-03"),
    { generatedAt: "2026-11-03T18:00:00Z" },
    { reference_date: "2026-11-03" },
  );

  it("shows the development link once while the scores detail is open", () => {
    const count = (defaultOpen?: "scores") =>
      (
        text(
          <HomeCard
            view={view}
            canWrite
            onOpen={noop}
            defaultOpen={defaultOpen}
          />,
        ).match(/Trainingsentwicklung ansehen/g) ?? []
      ).length;
    expect(count("scores")).toBe(1);
    expect(count()).toBe(1);
  });

  it("says the load is in the usual range without a deduction", () => {
    const scores = view.scores!;
    const lines = scoreLines({
      ...scores,
      recovery: {
        ...scores.recovery,
        status: "ok",
        value: 100,
        reason: null,
        strongest_deduction: null,
        best: { kind: "training", value: 100 },
        watch: "used",
      },
    })!;
    const sentence = lines.find((l) => l.name === "Erholung")!.sentence;
    expect(sentence).toBe("Deine Belastung liegt im gewohnten Rahmen.");
    const estimated = scoreLines({
      ...scores,
      recovery: {
        ...scores.recovery,
        status: "ok",
        value: 100,
        reason: null,
        strongest_deduction: null,
        best: { kind: "training", value: 100 },
        watch: "no_values",
      },
    })!.find((l) => l.name === "Erholung")!.sentence;
    expect(estimated).toBe(
      "Deine Belastung liegt im gewohnten Rahmen. Nur aus deinem Training geschätzt.",
    );
  });
});
