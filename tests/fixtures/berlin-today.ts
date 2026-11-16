/**
 * "Today" of the E2E tests: the calendar day in Europe/Berlin, the zone every
 * Playwright browser runs in (playwright.config.ts). It does not depend on the
 * machine's TZ or on the time of day (UX-016).
 */
export const E2E_TIMEZONE = "Europe/Berlin";

export const berlinToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: E2E_TIMEZONE }).format(now);
