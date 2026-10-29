import { isAbsolute, resolve } from "node:path";
import {
  ArnoldSheetsDataSource,
  type ArnoldDataSource,
} from "./arnold-source.js";

export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/**
 * Whether a binding reaches beyond this machine.
 *
 * A public address is not only the bind host: an `allowedHosts` entry or an
 * allowed origin naming a tunnel or a service domain is just as reachable, so
 * all three are judged together.
 */
export function isPublicBinding(
  host: string,
  allowedHosts: string[],
  allowedOrigins: string[],
): boolean {
  return (
    !LOOPBACK_HOSTS.includes(host) ||
    allowedHosts.some((h) => !LOOPBACK_HOSTS.includes(h)) ||
    allowedOrigins.some(
      (origin) => !LOOPBACK_HOSTS.includes(new URL(origin).hostname),
    )
  );
}

/**
 * Decides whether this Arnold deployment may listen beyond loopback.
 *
 * The rule has two halves, and both matter:
 *
 *   - A source that reads a **real Google file** may only be reachable
 *     publicly when authentication is active. Without it, anyone who finds the
 *     address reads somebody's training history — which is why this started out
 *     as a blanket loopback requirement.
 *   - A **synthetic** source has nothing to leak. Its dataset lives in memory,
 *     its writes touch only that dataset, and a restart discards them. Refusing
 *     to expose it bought no safety and blocked the one thing a tunnel or a
 *     hosted test instance is for.
 *
 * So the refusal is now aimed at what is actually sensitive, instead of at
 * every non-loopback binding.
 */
export function requireSafeArnoldBinding(input: {
  synthetic: boolean;
  /** True when bearer validation is active (Task 007 `AUTH_MODE=oidc`). */
  authenticated: boolean;
  host: string;
  allowedHosts: string[];
  allowedOrigins: string[];
}) {
  const { synthetic, authenticated, host, allowedHosts, allowedOrigins } =
    input;
  if (!isPublicBinding(host, allowedHosts, allowedOrigins)) return;
  if (synthetic || authenticated) return;
  throw new Error(
    "Eine echte Arnold-Trainingsdatei darf nicht über eine öffentliche Adresse erreichbar sein, solange keine Authentifizierung aktiv ist. Entweder an Loopback binden und einen privaten MCP-Tunnel verwenden, oder AUTH_MODE=oidc konfigurieren, oder für einen offenen Test STORAGE_MODE=arnold_fixture mit synthetischen Daten nutzen.",
  );
}

export const ARNOLD_STORAGE_MODE = "arnold_sheets";

/** True when the environment selects the new Arnold schema v1 dashboard mode. */
export function isArnoldMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STORAGE_MODE === ARNOLD_STORAGE_MODE;
}

/**
 * Builds the Arnold read source from the environment.
 *
 * Reading a real Arnold file carries the same privacy requirement as the legacy
 * Sheets mode: a private MCP connection only. `ARNOLD_EXPECTED_FILE_ROLE` lets a
 * deployment state up front whether it points at the shared master template or
 * at a personal tracker, so a misconfiguration fails on connect rather than
 * showing template content as somebody's training history.
 */
export function createArnoldSource(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): ArnoldDataSource {
  if (!isArnoldMode(env))
    throw new Error(`STORAGE_MODE muss ${ARNOLD_STORAGE_MODE} sein.`);
  if (env.MCP_ACCESS !== "private")
    throw new Error(
      "Echte Arnold-Sheets-Daten erfordern MCP_ACCESS=private und eine private MCP-Verbindung. Der öffentliche Demo-Tunnel bleibt ausgeschlossen.",
    );
  const spreadsheetId = env.ARNOLD_SPREADSHEET_ID ?? "";
  if (!spreadsheetId)
    throw new Error(
      "ARNOLD_SPREADSHEET_ID fehlt. Die Datei-ID der Arnold-Arbeitsmappe konfigurieren.",
    );
  const keyFile = env.GOOGLE_APPLICATION_CREDENTIALS;
  const role = env.ARNOLD_EXPECTED_FILE_ROLE;
  if (
    role !== undefined &&
    role !== "MASTER_TEMPLATE" &&
    role !== "USER_TRACKER"
  )
    throw new Error(
      "ARNOLD_EXPECTED_FILE_ROLE muss MASTER_TEMPLATE oder USER_TRACKER sein.",
    );
  const ttl = Number(env.ARNOLD_CACHE_TTL_MS ?? "15000");
  if (!Number.isFinite(ttl) || ttl < 0)
    throw new Error("ARNOLD_CACHE_TTL_MS muss eine nichtnegative Zahl sein.");
  return new ArnoldSheetsDataSource({
    spreadsheetId,
    keyFile: keyFile
      ? isAbsolute(keyFile)
        ? keyFile
        : resolve(root, keyFile)
      : undefined,
    ...(env.ARNOLD_EXPECTED_TRACKER_ID
      ? { expectedTrackerId: env.ARNOLD_EXPECTED_TRACKER_ID }
      : {}),
    ...(role ? { expectedFileRole: role } : {}),
    cacheTtlMs: ttl,
  });
}
