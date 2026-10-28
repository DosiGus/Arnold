/**
 * Where the onboarding session credential lives in the browser.
 *
 * One owner for the key, because two of them read it: the transport, to decide
 * whether opening the app should resume a setup or start one, and the typed
 * client, to address every later onboarding call. A second hard-coded key
 * string in either place would eventually drift and silently start a fresh
 * setup over someone's answers.
 *
 * `sessionStorage`, not `localStorage`: a setup secret should not outlive the
 * browser session that created it. Every access is guarded, because an opaque
 * MCP App origin may have no storage at all.
 */
export const ONBOARDING_CLAIM_KEY = "arnold.onboarding.claim";

/** The addressed onboarding session: which setup, and the proof we may touch it. */
export type OnboardingClaim = {
  onboarding_session_id: string;
  session_token: string;
};

/** The stored claim, or undefined when there is none we can use. */
export function readStoredClaim(): OnboardingClaim | undefined {
  try {
    const saved = sessionStorage.getItem(ONBOARDING_CLAIM_KEY);
    if (!saved) return undefined;
    const parsed = JSON.parse(saved) as OnboardingClaim;
    // Both halves or nothing: an id without its secret is not a credential, and
    // sending it would only start an unrelated setup.
    return parsed?.onboarding_session_id && parsed?.session_token
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredClaim(claim: OnboardingClaim) {
  try {
    sessionStorage.setItem(ONBOARDING_CLAIM_KEY, JSON.stringify(claim));
  } catch {
    /* no browser storage; the caller keeps it in memory instead */
  }
}

export function clearStoredClaim() {
  try {
    sessionStorage.removeItem(ONBOARDING_CLAIM_KEY);
  } catch {
    /* no browser storage */
  }
}
