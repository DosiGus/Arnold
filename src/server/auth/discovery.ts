/**
 * Authorization Server discovery, and the checks Arnold runs on what it finds.
 *
 * Arnold advertises its issuer's RFC 8414 metadata so that a client which only
 * knows Arnold's URL can find the authorization server. It could simply relay
 * whatever the issuer publishes, but that would make Arnold a willing
 * amplifier for a misconfigured or hostile endpoint, so the document is
 * validated before it is trusted or re-served.
 *
 * Two of those checks matter more than the rest:
 *
 * **Issuer identity.** RFC 8414 §3.3 requires the `issuer` inside the
 * document to equal the issuer it was fetched for. Skipping that comparison is
 * how metadata spoofing works: point Arnold at an attacker-controlled
 * discovery URL and it would otherwise cheerfully publish the attacker's
 * `authorization_endpoint` to every client that asks. The `iss` Arnold
 * validates tokens against and the `issuer` in this document are therefore
 * required to be the same string.
 *
 * **PKCE S256.** Task 007 §5 requires the code flow to use PKCE with S256. An
 * authorization server that does not advertise it either cannot do it or does
 * not say so; both are reasons to stop at boot rather than discover the gap
 * during a user's first login. `plain` is not an acceptable fallback — it
 * provides no protection against code interception, which is the entire
 * purpose of PKCE.
 */
import { OAuthMetadataSchema } from "@modelcontextprotocol/core";
import type { OAuthMetadata } from "@modelcontextprotocol/server";
import { ArnoldAuthError } from "./errors.js";
import type { FetchLike } from "./jwks.js";

/** Where an issuer may publish its metadata, in the order Arnold tries. */
export function discoveryUrlsFor(issuer: string): string[] {
  const base = new URL(issuer);
  // RFC 8414 inserts the well-known segment before any path component; the
  // OpenID Connect form appends it. Real deployments use both.
  const path = base.pathname.replace(/\/$/, "");
  return [
    new URL(`/.well-known/oauth-authorization-server${path}`, base).toString(),
    new URL(`${path}/.well-known/openid-configuration`, base).toString(),
    new URL("/.well-known/openid-configuration", base).toString(),
  ];
}

export interface DiscoveryOptions {
  issuer: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /**
   * Skip the network entirely and validate this document instead. For tests,
   * and for a deployment that pins its issuer's metadata rather than fetching
   * it at boot.
   */
  document?: unknown;
}

export const DEFAULT_DISCOVERY_TIMEOUT_MS = 5_000;

/**
 * Validates a metadata document against the spec and against Arnold's needs.
 *
 * Exported separately from the fetch so a pinned document gets exactly the
 * same scrutiny as a fetched one.
 */
export function validateAuthorizationServerMetadata(
  document: unknown,
  expectedIssuer: string,
): OAuthMetadata {
  const parsed = OAuthMetadataSchema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      `Authorization-Server-Metadaten sind ungültig: ${issue?.path.join(".") ?? "?"} — ${issue?.message ?? "unbekannt"}`,
    );
  }
  const metadata = parsed.data as OAuthMetadata;

  // RFC 8414 §3.3: the document must claim the issuer it was fetched for.
  if (metadata.issuer !== expectedIssuer)
    throw new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      `Metadaten nennen den Issuer ${metadata.issuer}, erwartet wurde ${expectedIssuer}.`,
    );

  const pkce = metadata.code_challenge_methods_supported ?? [];
  if (!pkce.includes("S256"))
    throw new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      "Der Authorization Server unterstützt kein PKCE S256. Arnold verlangt PKCE S256 und akzeptiert plain nicht.",
    );

  if (!metadata.response_types_supported.includes("code"))
    throw new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      "Der Authorization Server unterstützt den Authorization Code Flow nicht.",
    );

  return metadata;
}

/**
 * Fetches and validates the issuer's metadata.
 *
 * Tries each candidate location in turn and reports the *validation* failure
 * if one was reached and rejected — a document that exists and is wrong is
 * much more useful to an operator than "nothing found at three URLs".
 */
export async function fetchAuthorizationServerMetadata(
  options: DiscoveryOptions,
): Promise<OAuthMetadata> {
  if (options.document !== undefined)
    return validateAuthorizationServerMetadata(
      options.document,
      options.issuer,
    );

  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const attempted: string[] = [];
  let validationFailure: ArnoldAuthError | undefined;

  for (const url of discoveryUrlsFor(options.issuer)) {
    attempted.push(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) continue;
      return validateAuthorizationServerMetadata(
        await response.json(),
        options.issuer,
      );
    } catch (error) {
      // A reachable-but-invalid document is the more informative failure, so
      // remember it and keep it if nothing better turns up.
      if (error instanceof ArnoldAuthError) validationFailure ??= error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    validationFailure ??
    new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      `Keine Authorization-Server-Metadaten gefunden unter: ${attempted.join(", ")}`,
    )
  );
}

/**
 * Describes how a ChatGPT client is expected to register itself.
 *
 * Task 007 §5 asks for whichever of CIMD or Dynamic Client Registration the
 * chosen provider actually documents, so this reports what the issuer's own
 * metadata claims rather than asserting one. `none` is a real answer: it means
 * clients must be pre-registered by hand, which is workable for a private
 * deployment and a blocker for public distribution.
 */
export function clientRegistrationMode(
  metadata: OAuthMetadata,
): "cimd" | "dcr" | "none" {
  if (metadata.client_id_metadata_document_supported === true) return "cimd";
  if (typeof metadata.registration_endpoint === "string") return "dcr";
  return "none";
}
