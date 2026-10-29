/** Local browser-test server. All identities, credentials and Google files are synthetic. */
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createHttpApp } from "../../src/server/http.js";
import { loadAuthConfig } from "../../src/server/auth/config.js";
import { buildAuthSurface } from "../../src/server/auth/router.js";
import { fetchAuthorizationServerMetadata } from "../../src/server/auth/discovery.js";
import { FileIdentityRepository } from "../../src/server/identity/repository.js";
import { FileGoogleCredentialRepository } from "../../src/server/google/credential-repository.js";
import { GoogleConnectionService } from "../../src/server/google/connection-service.js";
import {
  TokenCipher,
  generateEncryptionKey,
} from "../../src/server/google/crypto.js";
import { ConnectedArnoldRuntime } from "../../src/server/connected/runtime.js";
import { GoogleBrowserFlow } from "../../src/server/connected/google-browser.js";
import { ConnectedGoogle } from "./connected-google.js";
import { googleIdTokenKeys, googleOAuthConfig } from "./arnold-google.js";
import {
  makeRsaKey,
  jwksDocument,
  signJwt,
  validClaims,
} from "./arnold-auth.js";

const base = "http://127.0.0.1:8803";
const issuer = "http://127.0.0.1:8804/";
const directory = resolve("test-results/e2e-connected");
await rm(directory, { recursive: true, force: true });
const key = makeRsaKey("browser-issuer");
const google = new ConnectedGoogle();
const issuerServer = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify(
      req.url?.includes("jwks")
        ? jwksDocument(key)
        : {
            issuer,
            authorization_endpoint: `${issuer}authorize`,
            token_endpoint: `${issuer}token`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          },
    ),
  );
}).listen(8804, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  issuerServer.once("listening", resolve);
  issuerServer.once("error", reject);
});
const config = loadAuthConfig({
  ARNOLD_ENV: "development",
  AUTH_MODE: "oidc",
  ARNOLD_PUBLIC_BASE_URL: base,
  AUTH_ISSUER: issuer,
  AUTH_JWKS_URI: `${issuer}jwks`,
  IDENTITY_STORE: "file",
  IDENTITY_STORE_FILE: resolve(directory, "identities.json"),
});
const auth = buildAuthSurface({
  config,
  repository: new FileIdentityRepository(resolve(directory, "identities.json")),
  authorizationServerMetadata: await fetchAuthorizationServerMetadata({
    issuer,
  }),
});
const connections = new GoogleConnectionService({
  config: { ...googleOAuthConfig, redirectUri: `${base}/auth/google/callback` },
  repository: new FileGoogleCredentialRepository(
    resolve(directory, "connections.json"),
  ),
  cipher: new TokenCipher(generateEncryptionKey("browser-key")),
  idTokenKeys: googleIdTokenKeys,
  fetchImpl: google.fetch,
});
const runtime = new ConnectedArnoldRuntime({
  directory: resolve(directory, "users"),
  auth,
  connections,
  fetchImpl: google.fetch,
});
const browser = new GoogleBrowserFlow(
  runtime,
  connections,
  auth,
  new URL(base),
);
const app = createHttpApp({ auth, connected: { runtime, browser } });
// Test controls are mounted only in this test executable, before the real app.
const http = createServer(async (req, res) => {
  const url = new URL(req.url!, base);
  if (url.pathname === "/__test/token") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        token: signJwt(
          key,
          validClaims({
            iss: issuer,
            aud: `${base}/mcp`,
            sub: "browser-user",
            scope:
              "arnold.profile arnold.read arnold.write arnold.plan arnold.account",
          }),
        ),
      }),
    );
  } else if (url.pathname === "/__test/consent") {
    const authorization = url.searchParams.get("authorization")!;
    const code = google.authorize(authorization, "browser-user");
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        callback: `${base}/auth/google/callback?${new URLSearchParams({ code, state: new URL(authorization).searchParams.get("state")! })}`,
      }),
    );
  } else app(req, res);
}).listen(8803, "127.0.0.1");
const shutdown = () => {
  http.closeAllConnections();
  http.close();
  issuerServer.closeAllConnections();
  issuerServer.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
