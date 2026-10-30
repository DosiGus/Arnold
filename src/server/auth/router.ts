/**
 * The HTTP surface of Arnold's authentication: discovery documents and the
 * bearer gate on `/mcp`.
 *
 * Everything protocol-shaped here is the SDK's work, deliberately. The
 * `WWW-Authenticate` challenge, the `resource_metadata` pointer, the RFC 9728
 * and RFC 8414 documents, the `401`/`403` bodies and the RFC 8707 resource
 * comparison are all behaviour a client depends on byte-for-byte, and
 * hand-writing them is how a server ends up almost-conformant. Arnold supplies
 * the two things the SDK cannot know: a token verifier, and its own identity.
 *
 * `buildAuthSurface` returns the pieces rather than mounting them, so
 * `http.ts` keeps deciding its own middleware order. That matters for the
 * merge with Tasks 004–006, which also touch that file.
 */
import {
  mcpAuthMetadataRouter,
  requireBearerAuth,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/express";
import type { OAuthMetadata } from "@modelcontextprotocol/server";
import type { RequestHandler, Router, Request } from "express";
import type { AuthenticatedArnoldContext } from "./identity.js";
import { ArnoldAuthError } from "./errors.js";
import type { ArnoldAuthConfig } from "./config.js";
import { ArnoldIdentityResolver } from "./identity.js";
import { JwksCache } from "./jwks.js";
import { ALL_ARNOLD_SCOPES } from "./scopes.js";
import { ArnoldTokenVerifier } from "./token-verifier.js";
import { ArnoldToolGuard, type GuardEvent } from "./tool-guard.js";
import {
  FileIdentityRepository,
  InMemoryIdentityRepository,
  type IdentityRepository,
} from "../identity/repository.js";

export interface AuthSurfaceOptions {
  config: ArnoldAuthConfig;
  /**
   * The issuer's validated RFC 8414 metadata. Required in `oidc` mode —
   * `discovery.ts` produces it, either from the network or from a pinned
   * document, and it is passed in rather than fetched here so that boot order
   * and failure handling stay the caller's decision.
   */
  authorizationServerMetadata?: OAuthMetadata;
  /** Overrides the store implied by the configuration. For tests. */
  repository?: IdentityRepository;
  onGuardEvent?: (event: GuardEvent) => void;
}

export interface AuthSurface {
  resolveRequest(request: Request): Promise<AuthenticatedArnoldContext>;
  assertActive(context: AuthenticatedArnoldContext): Promise<void>;
  /**
   * Mounts `/.well-known/oauth-protected-resource` and
   * `/.well-known/oauth-authorization-server`. Undefined in `open` mode,
   * where advertising a protected resource would be a lie.
   */
  metadataRouter: Router | undefined;
  /**
   * Gate for `/mcp`. In `open` mode this is a pass-through, so the demo and
   * read-only profiles of Tasks 001–003 keep working unchanged.
   */
  bearerGate: RequestHandler;
  /** The per-call authorization gate tools use. */
  guard: ArnoldToolGuard;
  /** Exposed for `/health` and the startup log. Carries no secrets. */
  summary: {
    mode: ArnoldAuthConfig["mode"];
    resource: string;
    scopesSupported: readonly string[];
    identityStore: string;
  };
}

function createRepository(config: ArnoldAuthConfig): IdentityRepository {
  const store = config.identityStore;
  if (store.kind === "memory") return new InMemoryIdentityRepository();
  if (store.kind === "file") return new FileIdentityRepository(store.path);
  // 007-D replaces this with the PostgreSQL implementation. Failing loudly
  // beats silently falling back to a store that cannot survive a restart or
  // coordinate between instances.
  throw new Error(
    "IDENTITY_STORE=postgres ist noch nicht implementiert (Task 007-D). Bis dahin ist kein produktiver Mehrnutzerbetrieb möglich.",
  );
}

/** A no-op gate, used only where the configuration says authentication is off. */
const passThrough: RequestHandler = (_req, _res, next) => next();

export function buildAuthSurface(options: AuthSurfaceOptions): AuthSurface {
  const { config } = options;
  const repository = options.repository ?? createRepository(config);
  const resolver = new ArnoldIdentityResolver({ repository });
  const resolveRequest = async (request: Request) => {
    if (config.mode !== "oidc" || !request.auth)
      throw new ArnoldAuthError(
        "AUTH_REQUIRED",
        "Verifizierte Anmeldung erforderlich.",
      );
    return resolver.resolve(request.auth);
  };
  const assertActive = async (context: AuthenticatedArnoldContext) => {
    if ((await repository.byId(context.userId))?.status !== "ACTIVE")
      throw new ArnoldAuthError(
        "ACCOUNT_DISABLED",
        "Arnold-Konto ist nicht aktiv.",
      );
  };

  if (config.mode === "open") {
    // The synthetic context is explicit and obviously fake, so that anything
    // it touches is identifiable as not belonging to a real user.
    const guard = new ArnoldToolGuard({
      mode: "open",
      resolver,
      openModeContext: {
        userId: "usr_open_mode_synthetic",
        actorId: "act_open_mode_synthetic",
        scopes: ["arnold.read"],
        issuer: "arnold.local/open-mode",
        audience: config.resourceUrl.toString(),
        clientId: "arnold-open-mode",
        authSessionId: undefined,
        firstSeen: false,
      },
      onEvent: options.onGuardEvent,
    });
    return {
      resolveRequest,
      assertActive,
      metadataRouter: undefined,
      bearerGate: passThrough,
      guard,
      summary: {
        mode: "open",
        resource: config.resourceUrl.toString(),
        scopesSupported: [],
        identityStore: config.identityStore.kind,
      },
    };
  }

  const oidc = config.oidc;
  if (!oidc)
    throw new Error("AUTH_MODE=oidc ohne Issuer-Konfiguration aufgebaut.");
  const metadata = options.authorizationServerMetadata;
  if (!metadata)
    throw new Error(
      "AUTH_MODE=oidc benötigt validierte Authorization-Server-Metadaten.",
    );

  const verifier = new ArnoldTokenVerifier({
    issuer: oidc.issuer,
    audience: oidc.audience,
    keys: new JwksCache({ jwksUri: oidc.jwksUri }),
    ...(oidc.scopeClaim ? { scopeClaim: oidc.scopeClaim } : {}),
  });

  // What a client is told to request. With Arnold's scopes in a separate
  // claim, the issuer only knows its own scope names and refuses unknown ones
  // (`invalid_scope`), so the advertised set is then the issuer's own.
  const scopesSupported: readonly string[] = oidc.scopeClaim
    ? (metadata.scopes_supported ?? [])
    : ALL_ARNOLD_SCOPES;

  const metadataRouter = mcpAuthMetadataRouter({
    oauthMetadata: metadata,
    resourceServerUrl: config.resourceUrl,
    scopesSupported: [...scopesSupported],
  });

  const bearerGate = requireBearerAuth({
    verifier,
    // RFC 8707: a token minted for another resource behind the same issuer is
    // refused here, independently of the verifier's own audience check.
    expectedResource: config.resourceUrl,
    // Lets the 401 challenge tell a client where to look.
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      config.resourceUrl,
    ),
  });

  const guard = new ArnoldToolGuard({
    mode: "enforced",
    resolver,
    onEvent: options.onGuardEvent,
  });

  return {
    resolveRequest,
    assertActive,
    metadataRouter,
    bearerGate,
    guard,
    summary: {
      mode: "oidc",
      resource: config.resourceUrl.toString(),
      scopesSupported,
      identityStore: config.identityStore.kind,
    },
  };
}
