import { resolve } from "node:path";
import { loadAuthConfig } from "./auth/config.js";
import { fetchAuthorizationServerMetadata } from "./auth/discovery.js";
import { JwksCache } from "./auth/jwks.js";
import { buildAuthSurface } from "./auth/router.js";
import { GoogleConnectionService } from "./google/connection-service.js";
import { FileGoogleCredentialRepository } from "./google/credential-repository.js";
import { loadTokenCipher } from "./google/crypto.js";
import { createHttpApp, type ServerOptions } from "./http.js";
import { ConnectedArnoldRuntime } from "./connected/runtime.js";
import { GoogleBrowserFlow } from "./connected/google-browser.js";
import { retentionDaysFrom, scheduleRetention } from "./connected/retention.js";
import { logServerError } from "./tool-log.js";

/** Async startup actually performs the OIDC discovery required by buildAuthSurface. */
export async function createConfiguredHttpApp(
  options: Pick<ServerOptions, "root" | "host"> = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = loadAuthConfig(env);
  const metadata = config.oidc
    ? await fetchAuthorizationServerMetadata({
        issuer: config.oidc.authorizationServer,
      })
    : undefined;
  const auth = buildAuthSurface({
    config,
    authorizationServerMetadata: metadata,
  });
  if (env.STORAGE_MODE !== "arnold_connected")
    return createHttpApp({ ...options, env, auth });
  if (
    config.environment !== "development" ||
    config.mode !== "oidc" ||
    config.identityStore.kind !== "file"
  )
    throw new Error(
      "arnold_connected ist ein Einzelserver-Entwicklungsprofil und benötigt ARNOLD_ENV=development, AUTH_MODE=oidc und IDENTITY_STORE=file.",
    );
  if ((env.ARNOLD_WRITE_MODE ?? "disabled") !== "disabled")
    throw new Error(
      "Das Connected-Profil aktiviert seine geprüfte Nutzerruntime selbst. ARNOLD_WRITE_MODE muss disabled bleiben.",
    );
  const root = options.root ?? process.cwd();
  const directory = resolve(
    root,
    env.ARNOLD_STATE_DIRECTORY ?? "data/connected",
  );
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI;
  const base = new URL(config.publicBaseUrl.origin);
  if (
    config.resourceUrl.origin !== base.origin ||
    config.resourceUrl.pathname !== "/mcp"
  )
    throw new Error(
      "Connected-Profil benötigt /mcp auf derselben öffentlichen Basisadresse.",
    );
  if (!clientId || !clientSecret || !redirectUri)
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET und GOOGLE_REDIRECT_URI sind für das Connected-Profil erforderlich.",
    );
  if (redirectUri !== new URL("/auth/google/callback", base).href)
    throw new Error(
      "GOOGLE_REDIRECT_URI muss exakt auf /auth/google/callback der öffentlichen Arnold-Adresse zeigen.",
    );
  if (
    base.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
    throw new Error(
      "Die Google-Rücksprungadresse benötigt HTTPS oder Loopback.",
    );
  const connections = new GoogleConnectionService({
    config: { clientId, clientSecret, redirectUri },
    repository: new FileGoogleCredentialRepository(
      resolve(directory, "google-connections.json"),
    ),
    cipher: loadTokenCipher(env),
    idTokenKeys: new JwksCache({
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
    }),
  });
  const runtime = new ConnectedArnoldRuntime({
    directory: resolve(directory, "users"),
    auth,
    connections,
  });
  // D4: journals, snapshots and audit are deleted after the retention period,
  // at start and then daily. An invalid period stops the start (fail closed).
  const retentionDays = retentionDaysFrom(env);
  scheduleRetention(() =>
    runtime.applyRetention(retentionDays).catch((error: unknown) => {
      logServerError("retention failed", error);
    }),
  );
  const browser = new GoogleBrowserFlow(runtime, connections, auth, base);
  return createHttpApp({
    ...options,
    env,
    auth,
    connected: { runtime, browser },
  });
}
