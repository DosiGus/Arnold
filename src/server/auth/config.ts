/**
 * Startup validation for Arnold's identity configuration.
 *
 * The rule this module enforces is Task 007 §25's: **fail closed**. A missing
 * or contradictory security setting must stop the process, not degrade it.
 * The failure mode being designed against is specific and common — a
 * deployment that *believes* it is authenticating because `AUTH_ISSUER` is
 * set, while some other flag quietly left the gate open. Every such
 * combination is rejected here, at boot, with a message naming the variable.
 *
 * The environment is the authority on strictness, not a separate "strict"
 * switch. `production` cannot be talked into accepting an in-memory identity
 * store or an unauthenticated MCP endpoint, because the check keys off
 * `ARNOLD_ENV` and there is no override. Task 007 §24's rule — a production
 * MCP endpoint with real write access must not be publicly reachable without
 * fully verified authentication — is a configuration invariant, so this is
 * where it lives.
 */
import { z } from "zod";

export const ARNOLD_ENVIRONMENTS = [
  "development",
  "staging",
  "production",
] as const;
export type ArnoldEnvironment = (typeof ARNOLD_ENVIRONMENTS)[number];

/**
 * How the MCP endpoint authenticates.
 *
 * `open` is the pre-Task-007 behaviour: no bearer validation, synthetic or
 * read-only data only. It is retained so Tasks 001–003's demo and read-only
 * modes keep working (§32), and it is refused outside development.
 */
export const AUTH_MODES = ["open", "oidc"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const IDENTITY_STORES = ["memory", "postgres"] as const;
export type IdentityStoreKind = (typeof IDENTITY_STORES)[number];

/** A URL-shaped string. Kept as a refine so it reads the same on any zod 4.x. */
const urlString = (what: string) =>
  z.string().refine(
    (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: `${what} muss eine absolute URL sein.` },
  );

const RawConfigSchema = z.object({
  ARNOLD_ENV: z.enum(ARNOLD_ENVIRONMENTS).default("development"),
  ARNOLD_PUBLIC_BASE_URL: urlString("ARNOLD_PUBLIC_BASE_URL").optional(),
  ARNOLD_MCP_RESOURCE_URL: urlString("ARNOLD_MCP_RESOURCE_URL").optional(),
  AUTH_MODE: z.enum(AUTH_MODES).optional(),
  AUTH_ISSUER: urlString("AUTH_ISSUER").optional(),
  AUTH_AUDIENCE: urlString("AUTH_AUDIENCE").optional(),
  AUTH_JWKS_URI: urlString("AUTH_JWKS_URI").optional(),
  /**
   * The authorization server's RFC 8414 metadata URL. Advertised so a client
   * that only probes the resource origin still finds the AS.
   */
  AUTH_AUTHORIZATION_SERVER: urlString("AUTH_AUTHORIZATION_SERVER").optional(),
  /**
   * Where the token carries Arnold's scopes, when the authorization server
   * cannot put them in the standard `scope` claim. WorkOS AuthKit, for one,
   * grants dynamically registered clients only `openid profile email
   * offline_access` and adds anything else through a per-environment JWT
   * template. Must be a namespaced claim (`urn:arnold:scopes`) so it cannot
   * collide with a registered JWT claim.
   */
  AUTH_SCOPE_CLAIM: z
    .string()
    .regex(
      /^urn:[a-z0-9][a-z0-9-]*:[A-Za-z0-9._:-]+$/,
      "AUTH_SCOPE_CLAIM muss ein URN-Claim wie urn:arnold:scopes sein.",
    )
    .optional(),
  IDENTITY_STORE: z.enum(IDENTITY_STORES).optional(),
  DATABASE_URL: z.string().optional(),
});

export interface ArnoldAuthConfig {
  environment: ArnoldEnvironment;
  mode: AuthMode;
  /** Arnold's public origin, e.g. `https://arnold.example.com`. */
  publicBaseUrl: URL;
  /** Arnold's RFC 8707 resource identifier — the canonical `/mcp` URL. */
  resourceUrl: URL;
  /** Present exactly when `mode === "oidc"`. */
  oidc:
    | {
        issuer: string;
        audience: string;
        jwksUri: string;
        authorizationServer: string;
        /**
         * The claim Arnold reads its scopes from. Undefined means the
         * standard `scope`/`scp`; a URN means that claim only.
         */
        scopeClaim: string | undefined;
      }
    | undefined;
  identityStore: { kind: "memory" } | { kind: "postgres"; url: string };
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const fail = (message: string): never => {
  throw new ConfigurationError(message);
};

const isLoopback = (url: URL): boolean =>
  url.hostname === "localhost" ||
  url.hostname === "127.0.0.1" ||
  url.hostname === "[::1]" ||
  url.hostname === "::1";

/**
 * Validates the environment and returns the resolved configuration.
 *
 * Takes `env` as a parameter rather than reading `process.env` directly so
 * that the tests can exercise every rejected combination without mutating
 * global state — and so a future multi-tenant host could validate more than
 * one configuration in a process.
 */
export function loadAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): ArnoldAuthConfig {
  const parsed = RawConfigSchema.safeParse(env);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(
      `Ungültige Arnold-Konfiguration: ${first?.path.join(".") ?? "?"} — ${first?.message ?? "unbekannt"}`,
    );
  }
  const raw = parsed.data;
  const environment = raw.ARNOLD_ENV;
  const isProduction = environment === "production";

  // The default is the safe one in each environment: development may run
  // open, everything else must authenticate.
  const mode: AuthMode =
    raw.AUTH_MODE ?? (environment === "development" ? "open" : "oidc");

  if (mode === "open" && environment !== "development")
    fail(
      `AUTH_MODE=open ist nur in ARNOLD_ENV=development erlaubt, nicht in ${environment}. Produktive und Staging-Endpunkte müssen authentifizieren.`,
    );

  const publicBaseUrl = new URL(
    raw.ARNOLD_PUBLIC_BASE_URL ?? "http://127.0.0.1:8787",
  );
  if (raw.ARNOLD_PUBLIC_BASE_URL === undefined && environment !== "development")
    fail(
      `ARNOLD_PUBLIC_BASE_URL fehlt. Außerhalb von development gibt es keinen sinnvollen Standardwert.`,
    );
  if (isProduction && publicBaseUrl.protocol !== "https:")
    fail(
      "ARNOLD_PUBLIC_BASE_URL muss in production https sein. Ein MCP-Endpunkt mit echten Nutzerrechten darf nicht über http erreichbar sein.",
    );

  const resourceUrl = new URL(
    raw.ARNOLD_MCP_RESOURCE_URL ?? new URL("/mcp", publicBaseUrl).toString(),
  );
  if (isProduction && resourceUrl.protocol !== "https:")
    fail("ARNOLD_MCP_RESOURCE_URL muss in production https sein.");

  let oidc: ArnoldAuthConfig["oidc"];
  if (mode === "oidc") {
    const issuer =
      raw.AUTH_ISSUER ?? fail("AUTH_ISSUER fehlt für AUTH_MODE=oidc.");
    const jwksUri =
      raw.AUTH_JWKS_URI ?? fail("AUTH_JWKS_URI fehlt für AUTH_MODE=oidc.");
    // The audience defaults to Arnold's own resource identifier, which is what
    // RFC 8707 says it should be. Making it explicit is allowed; making it
    // something unrelated to this server is not.
    const audience = raw.AUTH_AUDIENCE ?? resourceUrl.toString();
    const authorizationServer = raw.AUTH_AUTHORIZATION_SERVER ?? issuer;

    const jwks = new URL(jwksUri);
    if (jwks.protocol !== "https:" && !isLoopback(jwks))
      fail(
        "AUTH_JWKS_URI muss https sein. Signaturschlüssel über http zu laden hebt die Tokenprüfung auf.",
      );
    const issuerUrl = new URL(issuer);
    if (isProduction && issuerUrl.protocol !== "https:")
      fail("AUTH_ISSUER muss in production https sein.");

    oidc = {
      issuer,
      audience,
      jwksUri,
      authorizationServer,
      scopeClaim: raw.AUTH_SCOPE_CLAIM,
    };
  } else {
    // Guard against the dangerous half-configuration: auth switched off while
    // issuer settings sit in the environment looking reassuring.
    const stray = (
      [
        "AUTH_ISSUER",
        "AUTH_JWKS_URI",
        "AUTH_AUDIENCE",
        "AUTH_SCOPE_CLAIM",
      ] as const
    ).filter((key) => raw[key] !== undefined);
    if (stray.length > 0)
      fail(
        `AUTH_MODE=open, aber ${stray.join(", ")} ist gesetzt. Diese Kombination sieht nach aktiver Authentifizierung aus, ist aber keine. AUTH_MODE=oidc setzen oder die Variablen entfernen.`,
      );
  }

  const storeKind: IdentityStoreKind =
    raw.IDENTITY_STORE ?? (isProduction ? "postgres" : "memory");

  if (isProduction && storeKind !== "postgres")
    fail(
      `IDENTITY_STORE=${storeKind} ist in production nicht zulässig. Mehrnutzerbetrieb über mehrere Instanzen benötigt eine transaktionale Datenbank.`,
    );

  let identityStore: ArnoldAuthConfig["identityStore"];
  if (storeKind === "memory") {
    identityStore = { kind: "memory" };
  } else {
    identityStore = {
      kind: "postgres",
      url:
        raw.DATABASE_URL ??
        fail("DATABASE_URL fehlt für IDENTITY_STORE=postgres."),
    };
  }

  return {
    environment,
    mode,
    publicBaseUrl,
    resourceUrl,
    oidc,
    identityStore,
  };
}

/**
 * A one-line, secret-free summary for the startup log and `/health`.
 *
 * Deliberately returns no issuer, no JWKS URI and no database URL: a
 * connection string in a log line is a credential in a log line.
 */
export function describeAuthConfig(config: ArnoldAuthConfig): string {
  return [
    `env=${config.environment}`,
    `auth=${config.mode}`,
    `resource=${config.resourceUrl.toString()}`,
    `identity_store=${config.identityStore.kind}`,
  ].join(" ");
}
