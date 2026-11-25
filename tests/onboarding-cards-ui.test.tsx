import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import type { OnboardingState } from "../src/shared/onboarding-contract";
import { ChecklistCard } from "../src/ui/components/onboarding/checklist-card";
import { ModulesCard } from "../src/ui/components/onboarding/modules-card";
import { PersonCard } from "../src/ui/components/onboarding/person-card";

/** RDS-007: the three onboarding cards, rendered from real server states. */

const runtime = createFixtureOnboarding();
const started = await runtime.onboarding.startOnboarding({
  request_id: randomUUID(),
});
const fresh = started.state!;
const written = await runtime.onboarding.updateProfile({
  request_id: randomUUID(),
  profile: {
    path: "arnold_plan",
    person: { age_years: 31, height_cm: 182, body_weight_kg: 78.5 },
    training: {
      primary_goal: "strength",
      modules: { running: false, mobility: true, morning_routine: false },
    },
  },
});
const filled: OnboardingState = written.state!;

const text = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);
const plain = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const save = async () => ({ ok: true }) as const;
const noop = () => {};

describe("Eckdaten card", () => {
  const html = text(
    <PersonCard
      person={fresh.session.profile.person}
      saving={false}
      onSave={save}
      onDone={noop}
    />,
  );
  it("has the labels, the optional sex and the privacy sentence", () => {
    expect(html).toContain("Eckdaten");
    expect(html).toContain("Ein paar Angaben zu dir");
    for (const word of [
      "Alter",
      "Größe",
      "Gewicht",
      "Geschlecht (optional)",
      "Keine Angabe",
    ])
      expect(html).toContain(word);
    expect(plain(html)).toContain(
      "Freiwillig, nur für deinen Plan, jederzeit löschbar.",
    );
  });
  it("is one form with a submit button, so Enter sends it", () => {
    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
    expect(plain(html)).toContain("Weiter");
  });
  it("labels every field and offers a live region for its error", () => {
    expect(html.match(/<label for=/g)).toHaveLength(3);
    expect(html.match(/aria-live="polite"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(html.match(/inputMode="decimal"/g)).toHaveLength(1);
  });
  it("starts empty for a new setup and shows the stored values with a decimal comma", () => {
    expect(html.match(/<input[^>]*value=""/g)).toHaveLength(3);
    const shown = text(
      <PersonCard
        person={filled.session.profile.person}
        saving={false}
        onSave={save}
        onDone={noop}
      />,
    );
    expect(shown).toContain('value="31"');
    expect(shown).toContain('value="182"');
    expect(shown).toContain('value="78,5"');
  });
  it("marks the chosen sex as pressed", () => {
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});

describe("Module card", () => {
  const render = (state: OnboardingState) =>
    text(
      <ModulesCard
        profile={state.session.profile}
        saving={false}
        onSave={save}
        onDone={noop}
      />,
    );
  it("shows the Eckdaten line with a check mark and the three chips", () => {
    const html = render(filled);
    expect(plain(html)).toContain("Eckdaten: 31 Jahre, 182 cm, 78,5 kg");
    expect(html).toContain("cc-line ok");
    for (const word of ["Krafttraining", "Laufen", "Mobility"])
      expect(html).toContain(word);
    expect(html).toContain('aria-disabled="true"');
  });
  it("asks about the morning routine only with Mobility", () => {
    expect(render(filled)).toContain("Morgenroutine dazu?");
    const without = render(fresh);
    expect(without).not.toContain("Morgenroutine dazu?");
    // Strength alone is the default, nothing else is pressed.
    expect(without.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});

describe("Checkliste card", () => {
  it("lists the required fields of the chosen modules and says what is missing", () => {
    const html = text(<ChecklistCard state={filled} />);
    const words = plain(html);
    expect(words).toContain("Das weiß ich schon");
    expect(words).toContain("Eckdaten: 31 Jahre, 182 cm, 78,5 kg");
    expect(words).toContain("Module: Krafttraining, Mobility");
    expect(words).toContain("Stärker werden");
    expect(words).toContain("fehlt noch");
    expect(words).toContain("Antippen holt den neuesten Stand.");
    expect(html).not.toContain("<button");
  });
  it("takes missing from the server state, not from its own reading", () => {
    const state = structuredClone(filled);
    state.progress.missing_fields = [];
    const done = plain(text(<ChecklistCard state={state} />));
    expect(done).not.toContain("fehlt noch");
  });
  it("shows no ids, tokens or revisions", () => {
    const words = plain(text(<ChecklistCard state={filled} />));
    expect(words).not.toMatch(/training\.|request_id|revision|arnold\./i);
  });
});
