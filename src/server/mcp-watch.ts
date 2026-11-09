/**
 * Garmin watch tools for signed-in users (UMSETZUNG §5, §8; 07 D-07, D-26).
 *
 * pair_garmin_watch has two stages, like delete_arnold_account: without a
 * token it shows the card (watch model, time) and issues a short-lived
 * confirmation token that travels only in _meta, so the model cannot pair on
 * its own; the card sends it back on the user's click. A wrong or expired
 * code counts as a failed attempt: at most five per account and hour, in
 * memory (07 D-15). The user always comes from the verified context.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { currentArnoldContext } from "./auth/guarded-server.js";
import type { DatabaseArnoldRuntime } from "./db/runtime.js";
import { failureText, recoveryFor } from "../shared/write-recovery.js";
import {
  ListGarminWatchesSchema,
  PairGarminWatchConfirmMetaSchema,
  PairGarminWatchInputSchema,
  PairGarminWatchPairedSchema,
  PairGarminWatchResponseSchema,
  UnpairGarminWatchInputSchema,
  UnpairGarminWatchResponseSchema,
  normalizeWatchUserCode,
} from "../shared/watch-contract.js";
import { formatUserCode, sha256 } from "./watch/pairing.js";

export const PAIRING_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
export const PAIRING_FAILURES_PER_HOUR = 5;

class WatchToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Pending confirmations and failed attempts, per server process. */
class PairingState {
  private failures = new Map<string, number[]>();
  private pending = new Map<
    string,
    { digest: Buffer; code: string; timezone: string; expiresAtMs: number }
  >();
  constructor(private readonly now: () => number = Date.now) {}

  private recent(userId: string) {
    const since = this.now() - 3_600_000;
    const kept = (this.failures.get(userId) ?? []).filter((t) => t > since);
    if (kept.length) this.failures.set(userId, kept);
    else this.failures.delete(userId);
    return kept;
  }

  fail(userId: string): void {
    this.failures.set(userId, [...this.recent(userId), this.now()]);
  }

  /** Five failed attempts in the last hour lock further attempts. */
  blocked(userId: string): boolean {
    return this.recent(userId).length >= PAIRING_FAILURES_PER_HOUR;
  }

  issue(userId: string, code: string, timezone: string, expiresAtMs: number) {
    const token = randomBytes(32).toString("base64url");
    this.pending.set(userId, {
      digest: digest(token),
      code,
      timezone,
      expiresAtMs: Math.min(
        expiresAtMs,
        this.now() + PAIRING_CONFIRMATION_TTL_MS,
      ),
    });
    return token;
  }

  /** Consumes the token; only for this user, this code and this time zone. */
  redeem(userId: string, token: string, code: string, timezone: string) {
    const entry = this.pending.get(userId);
    const valid =
      entry !== undefined &&
      entry.expiresAtMs > this.now() &&
      entry.code === code &&
      entry.timezone === timezone &&
      timingSafeEqual(entry.digest, digest(token));
    if (!valid)
      throw new WatchToolError(
        "CONFIRMATION_INVALID",
        "Die Bestätigung ist ungültig oder abgelaufen. Es wurde nichts gekoppelt. Bitte den Code in der Karte erneut bestätigen.",
      );
    this.pending.delete(userId);
  }
}

const states = new WeakMap<DatabaseArnoldRuntime, PairingState>();
const stateFor = (runtime: DatabaseArnoldRuntime) => {
  let state = states.get(runtime);
  if (!state) states.set(runtime, (state = new PairingState()));
  return state;
};

const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const invalidCode = () =>
  new WatchToolError(
    "VALIDATION_ERROR",
    "Dieser Code ist ungültig oder abgelaufen. Den Nutzer bitten, den Code auf der Uhr genau abzulesen oder auf der Uhr neu zu starten.",
  );

/** A failed watch tool as an MCP error with code and recovery. */
function watchToolFailure(error: unknown) {
  const known = error instanceof WatchToolError;
  const code = known ? error.code : "STORAGE_UNAVAILABLE";
  const retryable = known ? error.retryable : true;
  const recovery = recoveryFor(code, retryable);
  const message = known
    ? error.message
    : "Die Uhr-Verbindung ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.";
  return {
    isError: true as const,
    content: [
      { type: "text" as const, text: failureText(code, message, recovery) },
    ],
    _meta: { arnold: { code, retryable, recovery } },
  };
}

export function registerWatchTools(
  server: McpServer,
  runtime: DatabaseArnoldRuntime,
  /** The dashboard's current resource URI, which renders the confirmation. */
  resourceUri: string,
) {
  const context = () => {
    const caller = currentArnoldContext();
    if (!caller) throw new Error("Verifizierte Anmeldung erforderlich.");
    return caller;
  };
  server.registerTool(
    "pair_garmin_watch",
    {
      title: "Garmin-Uhr mit Arnold verbinden",
      inputSchema: PairGarminWatchInputSchema,
      outputSchema: PairGarminWatchResponseSchema,
      description:
        "Verbindet die Arnold-App auf einer Garmin-Uhr mit dem Konto. Nur wenn der Nutzer einen Code von seiner Uhr nennt. Mit user_code und timezone (IANA, z. B. Europe/Berlin) aufrufen: Das zeigt eine Karte mit Uhrenmodell zur Bestätigung. Verbunden wird erst, wenn der Nutzer in der Karte bestätigt; die Karte sendet dafür ein Bestätigungstoken. confirmation_token NIE selbst senden, raten oder aus dem Chat übernehmen.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ user_code, timezone, confirmation_token }) => {
      try {
        const caller = context();
        await runtime.options.auth.assertActive(caller);
        const state = stateFor(runtime);
        if (state.blocked(caller.userId))
          throw new WatchToolError(
            "RATE_LIMITED",
            "Zu viele ungültige Codes in der letzten Stunde. Bitte später erneut versuchen.",
          );
        if (!validZone(timezone))
          throw new WatchToolError(
            "VALIDATION_ERROR",
            "Unbekannte Zeitzone. Eine IANA-Zeitzone wie Europe/Berlin angeben.",
          );
        const code = normalizeWatchUserCode(user_code);
        if (!code) {
          state.fail(caller.userId);
          throw invalidCode();
        }
        const codeHash = sha256(code);
        if (confirmation_token === undefined) {
          const preview = (
            await runtime.options.db.query<{
              device_label: string;
              expires_at: Date;
            }>("select * from arnold.preview_watch_pairing($1)", [codeHash])
          ).rows[0];
          if (!preview) {
            state.fail(caller.userId);
            throw invalidCode();
          }
          const confirm = PairGarminWatchConfirmMetaSchema.parse({
            stage: "confirm",
            device_label: preview.device_label,
            user_code: formatUserCode(code),
            requested_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
            expires_at: preview.expires_at
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z"),
            confirmation_token: state.issue(
              caller.userId,
              code,
              timezone,
              preview.expires_at.getTime(),
            ),
          });
          const { confirmation_token: _token, ...visible } = confirm;
          return {
            structuredContent: visible,
            content: [
              {
                type: "text" as const,
                text: `Die Karte zeigt die Uhr (${visible.device_label}). Verbunden wird erst nach dem Klick des Nutzers in der Karte. Das Bestätigungstoken nicht selbst senden.`,
              },
            ],
            _meta: { arnold: { pair_garmin_watch: confirm } },
          };
        }
        state.redeem(caller.userId, confirmation_token, code, timezone);
        const approved = await runtime.options.db.asUser(
          caller.userId,
          async (c) =>
            (
              await c.query<{ result: string; device_label: string | null }>(
                "select * from arnold.approve_watch_pairing($1, $2)",
                [codeHash, timezone],
              )
            ).rows[0],
        );
        if (approved?.result !== "approved" || !approved.device_label) {
          state.fail(caller.userId);
          throw invalidCode();
        }
        const paired = PairGarminWatchPairedSchema.parse({
          stage: "paired",
          device_label: approved.device_label,
        });
        return {
          structuredContent: paired,
          content: [
            {
              type: "text" as const,
              text: `${paired.device_label} ist mit Arnold verbunden. Die Uhr lädt den Plan in wenigen Sekunden.`,
            },
          ],
        };
      } catch (error) {
        return watchToolFailure(error);
      }
    },
  );
  server.registerTool(
    "list_garmin_watches",
    {
      title: "Verbundene Garmin-Uhren anzeigen",
      inputSchema: z.strictObject({}),
      outputSchema: ListGarminWatchesSchema,
      description:
        "Zeigt die mit dem Arnold-Konto verbundenen Garmin-Uhren mit Verbindungsdatum und letztem Kontakt.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const caller = context();
        await runtime.options.auth.assertActive(caller);
        const rows = await runtime.options.db.asUser(
          caller.userId,
          async (c) =>
            (
              await c.query<{
                device_id: string;
                label: string;
                created_at: Date;
                last_used_at: Date | null;
              }>(
                `select device_id, label, created_at, last_used_at from arnold.watch_devices
                where user_id = $1 and status = 'active' order by created_at`,
                [caller.userId],
              )
            ).rows,
        );
        const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
        const data = ListGarminWatchesSchema.parse({
          watches: rows.map((r) => ({
            device_id: r.device_id,
            label: r.label,
            paired_at: iso(r.created_at),
            last_used_at: r.last_used_at ? iso(r.last_used_at) : null,
          })),
        });
        return {
          structuredContent: data,
          content: [
            {
              type: "text" as const,
              text: `${data.watches.length} Garmin-Uhr(en) verbunden.`,
            },
          ],
        };
      } catch (error) {
        return watchToolFailure(error);
      }
    },
  );
  server.registerTool(
    "unpair_garmin_watch",
    {
      title: "Garmin-Uhr trennen",
      inputSchema: UnpairGarminWatchInputSchema,
      outputSchema: UnpairGarminWatchResponseSchema,
      description:
        "Trennt eine Garmin-Uhr vom Arnold-Konto; ihr Zugang gilt sofort nicht mehr. Gespeicherte Trainings bleiben. Nur auf ausdrücklichen Wunsch des Nutzers.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ device_id }) => {
      try {
        const caller = context();
        await runtime.options.auth.assertActive(caller);
        const count = await runtime.options.db.asUser(
          caller.userId,
          async (c) =>
            (
              await c.query(
                `update arnold.watch_devices set status = 'revoked', revoked_at = now()
                  where user_id = $1 and device_id = $2 and status = 'active'`,
                [caller.userId, device_id],
              )
            ).rowCount ?? 0,
        );
        const data = UnpairGarminWatchResponseSchema.parse({
          device_id,
          unpaired: count === 1,
        });
        return {
          structuredContent: data,
          content: [
            {
              type: "text" as const,
              text: data.unpaired
                ? "Die Uhr ist getrennt."
                : "Zu dieser Kennung gibt es keine verbundene Uhr.",
            },
          ],
        };
      } catch (error) {
        return watchToolFailure(error);
      }
    },
  );
}
