/**
 * Configuration of the daily health values (UX-015). Read once at start.
 *
 *   GARMIN_DAILY_SOURCE        off (default) | personal
 *   GARMIN_PERSONAL_API_KEY    the Garmin Personal API key; a secret, only
 *                              from the runtime (Secret Manager)
 *   GARMIN_DAILY_USER_ID       the Arnold user (usr_…) the key belongs to
 *   GARMIN_DAILY_REFRESH_HOURS hours between fetches, 1–24, default 6
 *
 * Fails closed: anything missing or malformed switches the feature off with
 * a named reason. There is no fallback. The key never appears in a reason,
 * a log line or the status.
 */

export type DailyHealthConfig =
  | { state: "off" }
  | {
      state: "unavailable";
      reason:
        | "invalid_source"
        | "missing_key"
        | "missing_user"
        | "invalid_user"
        | "invalid_refresh_hours";
    }
  | {
      state: "active";
      source: "garmin_personal";
      apiKey: string;
      userId: string;
      refreshHours: number;
    };

const USER_ID =
  /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function loadDailyHealthConfig(
  env: NodeJS.ProcessEnv,
): DailyHealthConfig {
  const source = (env.GARMIN_DAILY_SOURCE ?? "").trim();
  if (source === "" || source === "off") return { state: "off" };
  if (source !== "personal")
    return { state: "unavailable", reason: "invalid_source" };
  const apiKey = (env.GARMIN_PERSONAL_API_KEY ?? "").trim();
  if (apiKey === "" || /\s/.test(apiKey))
    return { state: "unavailable", reason: "missing_key" };
  const userId = (env.GARMIN_DAILY_USER_ID ?? "").trim();
  if (userId === "") return { state: "unavailable", reason: "missing_user" };
  if (!USER_ID.test(userId))
    return { state: "unavailable", reason: "invalid_user" };
  const rawHours = (env.GARMIN_DAILY_REFRESH_HOURS ?? "").trim();
  const refreshHours = rawHours === "" ? 6 : Number(rawHours);
  if (!Number.isInteger(refreshHours) || refreshHours < 1 || refreshHours > 24)
    return { state: "unavailable", reason: "invalid_refresh_hours" };
  return {
    state: "active",
    source: "garmin_personal",
    apiKey,
    userId,
    refreshHours,
  };
}

/** A log- and status-safe label: never contains the key or the user. */
export function describeDailyHealthConfig(config: DailyHealthConfig): string {
  if (config.state === "off") return "off";
  if (config.state === "unavailable") return `unavailable:${config.reason}`;
  return "active:garmin_personal";
}

/** The start message, in the operator's language. Never names the key. */
export function dailyHealthStartMessage(config: DailyHealthConfig): string {
  if (config.state === "off")
    return "Garmin-Tageswerte: aus (GARMIN_DAILY_SOURCE nicht gesetzt).";
  if (config.state === "active")
    return `Garmin-Tageswerte: aktiv über den persönlichen Schlüssel, Abruf höchstens alle ${config.refreshHours} Stunden.`;
  const why = {
    invalid_source: "GARMIN_DAILY_SOURCE muss off oder personal sein",
    missing_key: "GARMIN_PERSONAL_API_KEY fehlt oder ist leer",
    missing_user: "GARMIN_DAILY_USER_ID fehlt",
    invalid_user: "GARMIN_DAILY_USER_ID ist keine Arnold-Nutzer-ID (usr_…)",
    invalid_refresh_hours:
      "GARMIN_DAILY_REFRESH_HOURS muss eine ganze Zahl von 1 bis 24 sein",
  }[config.reason];
  return `Garmin-Tageswerte: AUS, Konfiguration unvollständig (${why}).`;
}
