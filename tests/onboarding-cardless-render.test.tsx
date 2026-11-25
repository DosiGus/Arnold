import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { cardForState } from "../src/shared/onboarding-card";
import type { OnboardingState } from "../src/shared/onboarding-contract";
import type { ArnoldMcpClient } from "../src/ui/client/ArnoldMcpClient";
import { OnboardingCardApp } from "../src/ui/components/onboarding";

/**
 * RDS-011: a payload without `card` (an old chat) shows the card for the
 * server state, never the removed setup wizard. `main.tsx` picks
 * `payload.onboarding.card ?? cardForState(payload.onboarding.state)`.
 */

const started = await createFixtureOnboarding().onboarding.startOnboarding({
  request_id: randomUUID(),
});
const state = started.state as OnboardingState;
const client = {} as ArnoldMcpClient;

describe("a payload without card", () => {
  const html = renderToStaticMarkup(
    <OnboardingCardApp
      client={client}
      card={cardForState(state)}
      initial={state}
    />,
  );
  it("renders the card for the state", () => {
    expect(html).toContain('data-card="onboarding-card"');
    expect(html).toContain('data-ocard="person"');
  });
  it("shows no wizard welcome or two-way choice", () => {
    expect(html).not.toContain("Willkommen bei Arnold");
    expect(html).not.toContain("Eigenen Plan übernehmen");
    expect(html).not.toContain("Plan mit Arnold erstellen");
  });
});

describe("the checklist without a stored way", () => {
  it("lists no way as a missing answer", () => {
    const html = renderToStaticMarkup(
      <OnboardingCardApp client={client} card="checklist" initial={state} />,
    );
    expect(state.session.profile.path).toBeNull();
    expect(html).toContain("Pflichtangaben");
    expect(html).not.toMatch(/Weg|Plan mit Arnold/);
  });
});
