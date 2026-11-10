/**
 * Pairing a watch (UMSETZUNG §5, 07 D-07, D-26).
 *
 * pair/start gives the watch a secret device code (32 bytes, stays on the
 * watch) and a user code to show, valid for 10 minutes. The user confirms the
 * code in ChatGPT (pair_garmin_watch). pair/token is polled every 5 s and
 * hands out the watch token exactly once. Only SHA-256 hashes of the codes
 * and the token reach the database, and only through the 003 functions.
 */
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  WATCH_USER_CODE_ALPHABET,
  WatchPairStartRequestSchema,
  WatchPairStartResponseSchema,
  WatchPairTokenRequestSchema,
  WatchPairTokenResponseSchema,
} from "../../shared/watch-contract.js";
import { hashWatchToken, newWatchToken } from "../auth/watch-token.js";
import type { DatabaseArnoldRuntime } from "../db/runtime.js";
import {
  WatchApiError,
  watchEnvelope,
  type WatchCall,
  type WatchRoute,
} from "./router.js";

export const PAIRING_TTL_S = 600;
export const PAIRING_INTERVAL_S = 5;

export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest();

/** Eight characters from the unambiguous alphabet, uniformly drawn. */
export function newUserCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++)
    code +=
      WATCH_USER_CODE_ALPHABET[randomInt(WATCH_USER_CODE_ALPHABET.length)];
  return code;
}

export const formatUserCode = (code: string) =>
  `${code.slice(0, 4)}-${code.slice(4)}`;

/** "Arnold · 3f9a": Arnold keeps no name or e-mail (07 D-26). */
export const accountLabel = (userId: string) => `Arnold · ${userId.slice(-4)}`;

async function start(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const parsed = WatchPairStartRequestSchema.safeParse(call.body);
  if (!parsed.success) throw new WatchApiError("VALIDATION_ERROR", 422);
  // A user code collides with an open one about once in 10^11; a fresh draw
  // is then cheaper than an error on the watch.
  for (let attempt = 0; attempt < 3; attempt++) {
    const deviceCode = randomBytes(32).toString("base64url");
    const userCode = newUserCode();
    try {
      await runtime.options.db.query(
        "select * from arnold.start_watch_pairing($1, $2, $3, $4)",
        [
          sha256(deviceCode),
          sha256(userCode),
          parsed.data.device_label,
          PAIRING_TTL_S,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") continue;
      throw new WatchApiError("STORAGE_UNAVAILABLE", 503, true);
    }
    return {
      status: 201,
      body: WatchPairStartResponseSchema.parse({
        ...watchEnvelope(),
        device_code: deviceCode,
        user_code: formatUserCode(userCode),
        expires_in: PAIRING_TTL_S,
        interval: PAIRING_INTERVAL_S,
      }),
    };
  }
  throw new WatchApiError("STORAGE_UNAVAILABLE", 503, true);
}

async function token(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const parsed = WatchPairTokenRequestSchema.safeParse(call.body);
  if (!parsed.success) throw new WatchApiError("VALIDATION_ERROR", 422);
  const accessToken = newWatchToken();
  const deviceId = `wdv_${randomUUID()}`;
  let row: { result: string; user_id: string | null } | undefined;
  try {
    row = (
      await runtime.options.db.query<{
        result: string;
        user_id: string | null;
      }>("select * from arnold.redeem_watch_pairing($1, $2, $3)", [
        sha256(parsed.data.device_code),
        hashWatchToken(accessToken),
        deviceId,
      ])
    ).rows[0];
  } catch {
    throw new WatchApiError("STORAGE_UNAVAILABLE", 503, true);
  }
  const status = row?.result ?? "expired";
  if (status === "issued" && row?.user_id)
    return {
      body: WatchPairTokenResponseSchema.parse({
        ...watchEnvelope(),
        access_token: accessToken,
        device_id: deviceId,
        account_label: accountLabel(row.user_id),
      }),
    };
  return {
    body: WatchPairTokenResponseSchema.parse({
      ...watchEnvelope(),
      status:
        status === "pending" || status === "slow_down" ? status : "expired",
      ...(status === "slow_down"
        ? { interval: PAIRING_INTERVAL_S * 2 }
        : status === "pending"
          ? { interval: PAIRING_INTERVAL_S }
          : {}),
    }),
  };
}

export function pairingRoutes(runtime: DatabaseArnoldRuntime): WatchRoute[] {
  return [
    {
      method: "POST",
      path: "/pair/start",
      handler: (call) => start(runtime, call),
    },
    {
      method: "POST",
      path: "/pair/token",
      handler: (call) => token(runtime, call),
    },
  ];
}
