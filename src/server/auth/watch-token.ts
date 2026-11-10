/**
 * Arnold's own device tokens for the Garmin watch (07 D-07, UMSETZUNG §5).
 *
 * A watch token is `arn_w_` plus 32 random bytes in base64url. Only its
 * SHA-256 is stored. The only way from a token to a user is the database
 * function `arnold.resolve_watch_token`, which answers for active devices of
 * active accounts only; the account is checked again on every call.
 *
 * The two credentials never cross: a watch token does not parse as a JWT on
 * `/mcp`, and nothing here accepts anything but the `arn_w_` format, so a
 * WorkOS JWT is refused on `/api/watch/v1`.
 */
import { createHash, randomBytes } from "node:crypto";
import { deriveActorId, type AuthenticatedArnoldContext } from "./identity.js";
import { isAuthError } from "./errors.js";
import type { AuthSurface } from "./router.js";
import type { Database } from "../db/database.js";

export const WATCH_ISSUER = "arnold.watch/1";
export const WATCH_CLIENT_ID = "arnold-garmin";
/** Watch scopes. Deliberately not in ARNOLD_SCOPES: no OAuth token carries them. */
export const WATCH_SCOPES = {
  read: "arnold.watch.read",
  write: "arnold.watch.write",
} as const;

const TOKEN = /^arn_w_[A-Za-z0-9_-]{43}$/;

/** A fresh watch token. Shown to the watch once, never stored. */
export function newWatchToken(): string {
  return `arn_w_${randomBytes(32).toString("base64url")}`;
}

export function hashWatchToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** Why a watch request is not authenticated. Never says which part failed. */
export class WatchAuthError extends Error {
  constructor(
    readonly reason: "unauthenticated" | "unavailable",
    readonly detail?: string,
  ) {
    super(reason);
    this.name = "WatchAuthError";
  }
}

export interface WatchPrincipal {
  context: AuthenticatedArnoldContext;
  deviceId: string;
}

export class WatchTokenVerifier {
  constructor(
    private readonly options: {
      db: Pick<Database, "query">;
      auth: Pick<AuthSurface, "assertActive">;
    },
  ) {}

  /** Resolves `Authorization: Bearer arn_w_…`; throws WatchAuthError. */
  async verify(authorization: string | undefined): Promise<WatchPrincipal> {
    const match = /^Bearer (\S+)$/.exec(authorization ?? "");
    const token = match?.[1];
    if (!token || !TOKEN.test(token))
      throw new WatchAuthError("unauthenticated", "format");
    let row:
      { user_id: string; device_id: string; scopes: string[] } | undefined;
    try {
      row = (
        await this.options.db.query<{
          user_id: string;
          device_id: string;
          scopes: string[];
        }>("select * from arnold.resolve_watch_token($1)", [
          hashWatchToken(token),
        ])
      ).rows[0];
    } catch {
      // A database failure is never a pass.
      throw new WatchAuthError("unavailable", "lookup");
    }
    if (!row) throw new WatchAuthError("unauthenticated", "unknown");
    const context: AuthenticatedArnoldContext = {
      userId: row.user_id,
      actorId: deriveActorId(WATCH_ISSUER, row.device_id),
      scopes: [...row.scopes],
      issuer: WATCH_ISSUER,
      audience: WATCH_ISSUER,
      clientId: WATCH_CLIENT_ID,
      authSessionId: undefined,
      firstSeen: false,
    };
    try {
      await this.options.auth.assertActive(context);
    } catch (error) {
      if (isAuthError(error))
        throw new WatchAuthError("unauthenticated", "inactive");
      throw new WatchAuthError("unavailable", "account");
    }
    return { context, deviceId: row.device_id };
  }
}
