/**
 * The Google scopes Arnold asks for, and the ones it refuses to ask for.
 *
 * Task 007 §9 sets the policy: `drive.file` and nothing broader without a
 * compelling reason. The distinction matters more than it looks.
 *
 * `drive.file` grants per-file access to files **the app itself created or the
 * user explicitly picked**. Arnold creates the tracker, so Arnold can read and
 * write that one spreadsheet forever — and has no visibility into anything
 * else in the user's Drive. Not their documents, not their other sheets, not
 * even the existence of them.
 *
 * `drive` (full) would grant all of it. `spreadsheets` would grant every
 * spreadsheet the user owns, which for a fitness tracker is indefensible and
 * also triggers Google's restricted-scope verification with its security
 * assessment. So the narrow scope is both the right privacy answer and the
 * cheaper path to verification.
 *
 * The architectural consequence is stated here because it constrains features,
 * not just permissions: **Arnold cannot search the user's Drive, and cannot
 * open an arbitrary spreadsheet the user names.** Any future import of an
 * existing sheet needs its own authorized flow — the Google Picker, which
 * grants `drive.file` access to exactly the file the user chose. A feature that
 * assumed "the user told us the file name, so we can open it" would be
 * unbuildable under this scope, and would have to be caught in design rather
 * than at the API call.
 */

/** Per-file Drive access, limited to files Arnold created or the user picked. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * OpenID Connect scopes, for the stable account identifier.
 *
 * Task 007 §8 requires a verified, stable Google subject rather than an email
 * address as the account key. That is the `sub` claim of an OIDC id_token, so
 * `openid` is requested deliberately and not as boilerplate.
 *
 * `email` is requested as well, but only as a *display* attribute — so the UI
 * can tell the user which Google account is connected, which matters for the
 * §23 account-switch case. It is never the identity key.
 */
export const OPENID_SCOPE = "openid";
export const EMAIL_SCOPE = "email";

/** Exactly what Arnold requests at the consent screen. */
export const REQUESTED_GOOGLE_SCOPES: readonly string[] = [
  OPENID_SCOPE,
  EMAIL_SCOPE,
  DRIVE_FILE_SCOPE,
];

/**
 * Scopes without which Arnold cannot do its job.
 *
 * `email` is absent on purpose: a user who declines it still gets a working
 * tracker, just without the address shown in the UI. Treating a
 * nice-to-have as required would turn a cosmetic refusal into a hard failure.
 */
export const REQUIRED_GOOGLE_SCOPES: readonly string[] = [
  OPENID_SCOPE,
  DRIVE_FILE_SCOPE,
];

/**
 * Scopes Arnold must never hold. Checked, not merely documented.
 *
 * If one of these ever appears in a grant, something has gone wrong — a
 * misconfigured OAuth client, a copied consent URL, a client reused from
 * another project — and continuing would mean Arnold holding far more access
 * than it told the user it needed.
 */
export const FORBIDDEN_GOOGLE_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.metadata",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

export interface ScopeVerdict {
  granted: readonly string[];
  /** Required scopes the user did not grant. */
  missing: readonly string[];
  /** Forbidden scopes that were granted anyway. */
  excessive: readonly string[];
  /** True only when every required scope is present and nothing forbidden is. */
  usable: boolean;
}

/**
 * Google returns the granted scopes as a space-delimited string.
 *
 * The user can deselect individual permissions on the consent screen, so what
 * was requested and what was granted are different things and the difference
 * has to be checked rather than assumed (§8).
 */
export function parseGrantedScopes(scope: string | undefined): string[] {
  if (!scope) return [];
  return scope.split(/\s+/).filter(Boolean);
}

export function verifyGrantedScopes(granted: readonly string[]): ScopeVerdict {
  const held = new Set(granted);
  const missing = REQUIRED_GOOGLE_SCOPES.filter((scope) => !held.has(scope));
  const excessive = FORBIDDEN_GOOGLE_SCOPES.filter((scope) => held.has(scope));
  return {
    granted: [...granted],
    missing,
    excessive,
    usable: missing.length === 0 && excessive.length === 0,
  };
}

/** A short, user-facing explanation of why a grant was not usable. */
export function describeScopeVerdict(verdict: ScopeVerdict): string {
  if (verdict.usable)
    return "Alle erforderlichen Google-Berechtigungen liegen vor.";
  if (verdict.excessive.length > 0)
    return "Die Google-Verbindung umfasst mehr Rechte als Arnold benötigt und wurde abgelehnt. Bitte den OAuth-Client prüfen.";
  if (verdict.missing.includes(DRIVE_FILE_SCOPE))
    return "Arnold braucht die Berechtigung, eine eigene Tabelle in deinem Google Drive anzulegen und zu bearbeiten. Ohne sie kann kein Tracker erstellt werden.";
  return "Die Google-Verbindung ist unvollständig. Bitte die Berechtigungen erneut bestätigen.";
}
