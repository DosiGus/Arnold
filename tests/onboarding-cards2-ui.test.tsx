import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import type { OnboardingState } from "../src/shared/onboarding-contract";
import { BenchmarksCard } from "../src/ui/components/onboarding/benchmarks-card";
import { RunReferenceCard } from "../src/ui/components/onboarding/run-reference-card";

/** RDS-008: Richtwerte Kraft and Laufreferenz, from real server states. */

const runtime = createFixtureOnboarding();
await runtime.onboarding.startOnboarding({ request_id: randomUUID() });
const write = async (profile: object) =>
  (
    await runtime.onboarding.updateProfile({
      request_id: randomUUID(),
      profile,
    } as never)
  ).state!;
const gym = await write({
  path: "arnold_plan",
  training: { environment: "gym", primary_goal: "strength" },
});
const running = await write({
  training: {
    modules: { running: true, mobility: false, morning_routine: false },
    run: {
      runs_per_week: 3,
      base_minutes_per_week: 90,
      longest_run_4w_min: 40,
      preferred_environment: "outdoor",
    },
  },
});
const noRun = await write({
  training: {
    modules: { running: true, mobility: false, morning_routine: false },
    run: null,
  },
});

const plain = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const save = async () => ({ ok: true }) as const;
const noop = () => {};
const bench = (state: OnboardingState) =>
  renderToStaticMarkup(
    <BenchmarksCard state={state} saving={false} onSave={save} onDone={noop} />,
  );
const ref = (state: OnboardingState) =>
  renderToStaticMarkup(
    <RunReferenceCard
      state={state}
      saving={false}
      onSave={save}
      onDone={noop}
    />,
  );

describe("Richtwerte Kraft", () => {
  it("shows one anchor per movement from the contract, with weight, reps and Weiß ich nicht", () => {
    const html = bench(gym);
    const words = plain(html);
    expect(words).toContain("Richtwerte Kraft");
    for (const g of ["Drücken", "Ziehen", "Beine"]) expect(words).toContain(g);
    expect(html.match(/<fieldset/g)).toHaveLength(3);
    expect(html.match(/inputMode="decimal"/g)).toHaveLength(3);
    expect(html.match(/inputMode="numeric"/g)).toHaveLength(3);
    expect(html.match(/Weiß ich nicht/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
  });
  it("is optional: a skip button next to Weiter, one form so Enter sends", () => {
    const html = bench(gym);
    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
    expect(plain(html)).toContain("Überspringen");
    expect(plain(html)).toContain("Freiwillig");
    expect(plain(html)).not.toMatch(/berechnet/);
  });
  it("shows the summary lines of what is done", () => {
    expect(plain(bench(gym))).toContain("Module: Krafttraining");
  });
  it("shows no ids", () => {
    expect(plain(bench(gym))).not.toMatch(
      /bench-press|lat-pulldown|squat|goblet/,
    );
  });
});

describe("Laufreferenz", () => {
  it("offers distance, time and date with labelled fields and a skip", () => {
    const html = ref(running);
    const words = plain(html);
    expect(words).toContain("Deine beste oder letzte Zeit");
    for (const w of [
      "5 km",
      "10 km",
      "Andere Strecke",
      "Zeit",
      "Ungefähres Datum",
      "Überspringen",
    ])
      expect(words).toContain(w);
    expect(words).not.toContain("Halbmarathon");
    expect(html).toContain('type="date"');
    expect(html).toContain('type="submit"');
  });
  it("only asks with the module Laufen and stored run details", () => {
    expect(plain(ref(gym))).toContain("nur, wenn du Laufen gewählt hast");
    expect(ref(gym)).not.toContain("<form");
    const without = ref(noRun);
    expect(plain(without)).toContain("Erst brauche ich deine Laufangaben");
    expect(without).not.toContain("<form");
    expect(plain(without)).toContain("Überspringen");
  });
});
