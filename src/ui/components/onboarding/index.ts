/**
 * The setup cards: the welcome, the guided profile step and its header.
 *
 * `ProfileStep` owns the setup state; the pages (`*-page.tsx`) render one page
 * each from that state, and `controls.tsx` holds the small answer controls.
 */
export { SetupHead } from "./setup-head";
export { MultiChoice } from "./controls";
export { initialProfileQuestion, asksMobility } from "./pages";
export { renderMobilityPage } from "./mobility-page";
export { WelcomeStep } from "./welcome-step";
export { ProfileStep } from "./profile-step";
export { UnderstoodStep, hasUnderstood } from "./understood-step";
export { OnboardingCardApp } from "./card-app";
