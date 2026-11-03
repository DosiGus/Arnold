import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import {
  ProfileStep,
  WelcomeStep,
  MultiChoice,
  initialProfileQuestion,
} from "../src/ui/components/onboarding";
import { OnboardingView } from "../src/ui/views/OnboardingView";
import type { ArnoldMcpClient } from "../src/ui/client/ArnoldMcpClient";

const runtime = createFixtureOnboarding();
const started = await runtime.onboarding.startOnboarding({
  request_id: randomUUID(),
});
const claim = {
  onboarding_session_id: started.state!.session.onboarding_session_id,
  session_token: started.session_token!,
};
const fresh = started.state!;
const readyResponse = await runtime.onboarding.updateProfile({
  ...claim,
  request_id: randomUUID(),
  profile: {
    path: "arnold_plan",
    training: {
      primary_goal: "strength",
      experience: "beginner",
      days_per_week: 3,
      session_minutes: 60,
      environment: "gym",
    },
  },
});
const ready = readyResponse.state!;
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);
const noop = () => {};
const profile = (state: typeof fresh) => (
  <ProfileStep
    profile={state.session.profile}
    progress={state.progress}
    validation={state.validation}
    exerciseChoices={state.exercise_choices}
    splitOptions={state.split_options}
    busy={false}
    canWritePlan
    onSave={async () => true}
    onRequestPlan={noop}
    onBack={noop}
  />
);

describe("question-card onboarding with real server states", () => {
  it("offers two clear paths in the shared card system", () => {
    const html = render(
      <WelcomeStep onChoose={noop} busy={false} canWritePlan />,
    );
    expect(html).toContain("Willkommen bei Arnold");
    expect(html).toContain("Trainingsbegleiter");
    expect(html.match(/class="ac-btn /g)).toHaveLength(2);
    expect(html).not.toContain("onb-");
    expect(html).not.toContain("brand-icon");
  });
  it("does not mention Google anywhere", () => {
    const html = render(
      <WelcomeStep onChoose={noop} busy={false} canWritePlan />,
    );
    expect(html).not.toContain("Google");
  });
  it("keeps unavailable plan actions disabled", () => {
    expect(
      render(
        <WelcomeStep onChoose={noop} busy={false} canWritePlan={false} />,
      ).match(/disabled=""/g),
    ).toHaveLength(2);
  });
  it("makes personal data genuinely optional", () => {
    const html = render(profile(fresh));
    expect(html).toContain("freiwillig");
    expect(html).toContain("Überspringen");
    // The number fields start empty: nothing is assumed about the person.
    expect(html.match(/<input[^>]*value=""/g)).toHaveLength(3);
    expect(html).toContain("Keine Angabe");
  });
  it("skips questions already answered in the chat", () => {
    expect(initialProfileQuestion(ready.session.profile)).toBe("review");
    const partial = structuredClone(ready.session.profile);
    partial.training.session_minutes = null;
    expect(initialProfileQuestion(partial)).toBe("rhythm");
  });
  it("shows the stored facts at review, not sample values", () => {
    const html = render(profile(ready));
    expect(html).toContain("Stärker werden");
    expect(html).toContain("60 Min.");
    expect(html).toContain("So wird dein Plan");
    expect(html).toContain("Plan erstellen");
    expect(html).not.toContain("onb-card");
  });
  it("offers native labelled multi-select controls", () => {
    const html = render(
      <MultiChoice
        label="Bereiche schonen"
        options={[{ value: "knee", label: "Knie" }]}
        values={["knee"]}
        onChange={noop}
      />,
    );
    expect(html).toContain("<fieldset");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).not.toContain(">knee<");
  });
  it("does not imply a finished setup before the completion", () => {
    const client = {} as ArnoldMcpClient;
    const html = render(<OnboardingView client={client} initial={fresh} />);
    expect(html).not.toContain("Google ist verbunden");
    expect(html).not.toContain("Erstes Training starten");
  });
});
