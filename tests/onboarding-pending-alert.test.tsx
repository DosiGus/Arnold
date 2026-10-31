/**
 * B19: one failure, one alert. While a profile save is running or waits for
 * confirmation, the question card does not add the server's "missing"
 * finding next to the pending notice (WebKit CI: two role=alert elements).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { ProfileStep } from "../src/ui/components/onboarding";

const runtime = createFixtureOnboarding();
const started = await runtime.onboarding.startOnboarding({
  request_id: randomUUID(),
});
const chosen = await runtime.onboarding.updateProfile({
  onboarding_session_id: started.state!.session.onboarding_session_id,
  session_token: started.session_token!,
  request_id: randomUUID(),
  // A person answer makes the card open on the goal question.
  profile: { path: "arnold_plan", person: { age_years: 30 } },
});
const state = chosen.state!;
const noop = () => {};
const render = (busy: boolean) =>
  renderToStaticMarkup(
    <ProfileStep
      profile={state.session.profile}
      progress={state.progress}
      validation={state.validation}
      exerciseChoices={state.exercise_choices}
      splitOptions={state.split_options}
      busy={busy}
      canWritePlan
      onSave={async () => true}
      onRequestPlan={noop}
      onBack={noop}
    />,
  );
const alerts = (html: string) => html.match(/role="alert"/g)?.length ?? 0;

describe("question card alerts", () => {
  it("names the missing answer when nothing is pending", () => {
    const html = render(false);
    expect(html).toContain("Trainingsziel fehlt noch");
    expect(alerts(html)).toBe(1);
  });

  it("adds no second alert while a save is running or unconfirmed", () => {
    const html = render(true);
    expect(html).not.toContain("fehlt noch");
    expect(alerts(html)).toBe(0);
  });
});
