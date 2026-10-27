/**
 * Authorization Server discovery, and what Arnold refuses to relay.
 *
 * Arnold re-serves its issuer's metadata to clients, which makes it an
 * amplifier for whatever that document says. The tests here are mostly about
 * documents Arnold must *not* pass on: one claiming an issuer it was not
 * fetched for, and one that cannot do PKCE S256.
 *
 * Assertions read `ArnoldAuthError.detail` rather than `.message`, because
 * the two are deliberately different: `.message` is the flat, non-revealing
 * text a caller sees, and `.detail` is the operator-facing reason. Checking
 * `detail` tests that the diagnosis is useful; the `message` staying generic
 * is the property asserted in `auth-token-verifier.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  clientRegistrationMode,
  discoveryUrlsFor,
  fetchAuthorizationServerMetadata,
  validateAuthorizationServerMetadata,
} from "../src/server/auth/discovery.js";
import { ArnoldAuthError } from "../src/server/auth/errors.js";
import type { FetchLike } from "../src/server/auth/jwks.js";

const ISSUER = "https://auth.example.com/";

const wellFormed = (overrides: Record<string, unknown> = {}) => ({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}authorize`,
  token_endpoint: `${ISSUER}token`,
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  ...overrides,
});

/** Serves `documents` by URL; anything else 404s. */
const serving = (documents: Record<string, unknown>): FetchLike =>
  (async (url: string) => {
    if (url in documents)
      return { ok: true, status: 200, json: async () => documents[url] };
    return { ok: false, status: 404, json: async () => ({}) };
  }) as FetchLike;

/** The operator-facing reason a synchronous validation refused. */
function refusalDetail(act: () => unknown): string {
  try {
    act();
    return "<no refusal>";
  } catch (error) {
    if (error instanceof ArnoldAuthError) return error.detail ?? "<no detail>";
    return error instanceof Error ? error.message : String(error);
  }
}

/** The operator-facing reason an async fetch refused. */
async function asyncRefusalDetail(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "<no refusal>";
  } catch (error) {
    if (error instanceof ArnoldAuthError) return error.detail ?? "<no detail>";
    return error instanceof Error ? error.message : String(error);
  }
}

describe("discovery URL candidates", () => {
  it("offers the RFC 8414 form before the OpenID Connect form", () => {
    const urls = discoveryUrlsFor("https://auth.example.com/");
    expect(urls[0]).toBe(
      "https://auth.example.com/.well-known/oauth-authorization-server",
    );
    expect(urls).toContain(
      "https://auth.example.com/.well-known/openid-configuration",
    );
  });

  it("inserts the well-known segment before a path component", () => {
    // RFC 8414 puts the well-known segment first; the OIDC form appends it.
    // Issuers in the wild use both, so both are tried.
    const urls = discoveryUrlsFor("https://auth.example.com/tenant-a");
    expect(urls).toContain(
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant-a",
    );
    expect(urls).toContain(
      "https://auth.example.com/tenant-a/.well-known/openid-configuration",
    );
  });
});

describe("metadata validation", () => {
  it("accepts a well-formed document", () => {
    const metadata = validateAuthorizationServerMetadata(wellFormed(), ISSUER);
    expect(metadata.issuer).toBe(ISSUER);
    expect(metadata.token_endpoint).toBe(`${ISSUER}token`);
  });

  it("refuses a document claiming a different issuer", () => {
    // Metadata spoofing: without this check Arnold would publish an
    // attacker's authorization_endpoint to every client that asks.
    expect(
      refusalDetail(() =>
        validateAuthorizationServerMetadata(
          wellFormed({ issuer: "https://evil.test/" }),
          ISSUER,
        ),
      ),
    ).toMatch(/nennen den Issuer/);
  });

  it("refuses an authorization server without PKCE S256", () => {
    expect(
      refusalDetail(() =>
        validateAuthorizationServerMetadata(
          wellFormed({ code_challenge_methods_supported: undefined }),
          ISSUER,
        ),
      ),
    ).toMatch(/PKCE S256/);
  });

  it("refuses PKCE plain as a substitute for S256", () => {
    expect(
      refusalDetail(() =>
        validateAuthorizationServerMetadata(
          wellFormed({ code_challenge_methods_supported: ["plain"] }),
          ISSUER,
        ),
      ),
    ).toMatch(/PKCE S256/);
  });

  it("refuses an authorization server without the code flow", () => {
    expect(
      refusalDetail(() =>
        validateAuthorizationServerMetadata(
          wellFormed({ response_types_supported: ["token"] }),
          ISSUER,
        ),
      ),
    ).toMatch(/Authorization Code Flow/);
  });

  it("refuses a document missing a required endpoint", () => {
    expect(
      refusalDetail(() =>
        validateAuthorizationServerMetadata(
          wellFormed({ token_endpoint: undefined }),
          ISSUER,
        ),
      ),
    ).toMatch(/ungültig/);
  });

  it("refuses a non-object document", () => {
    expect(
      refusalDetail(() => validateAuthorizationServerMetadata("nope", ISSUER)),
    ).toMatch(/ungültig/);
  });

  it("keeps the caller-facing message flat while the detail diagnoses", () => {
    const error = (() => {
      try {
        validateAuthorizationServerMetadata(
          wellFormed({ issuer: "https://evil.test/" }),
          ISSUER,
        );
        return null;
      } catch (caught) {
        return caught as ArnoldAuthError;
      }
    })();
    expect(error?.detail).toContain("evil.test");
    expect(error?.message).not.toContain("evil.test");
  });
});

describe("fetching metadata", () => {
  it("uses the RFC 8414 location when it is available", async () => {
    const metadata = await fetchAuthorizationServerMetadata({
      issuer: ISSUER,
      fetchImpl: serving({
        [`${ISSUER}.well-known/oauth-authorization-server`]: wellFormed(),
      }),
    });
    expect(metadata.issuer).toBe(ISSUER);
  });

  it("falls back to the OpenID Connect location", async () => {
    const metadata = await fetchAuthorizationServerMetadata({
      issuer: ISSUER,
      fetchImpl: serving({
        [`${ISSUER}.well-known/openid-configuration`]: wellFormed(),
      }),
    });
    expect(metadata.issuer).toBe(ISSUER);
  });

  it("validates a pinned document without any network access", async () => {
    let called = false;
    const metadata = await fetchAuthorizationServerMetadata({
      issuer: ISSUER,
      document: wellFormed(),
      fetchImpl: (async () => {
        called = true;
        throw new Error("should not be reached");
      }) as FetchLike,
    });
    expect(metadata.issuer).toBe(ISSUER);
    expect(called).toBe(false);
  });

  it("applies the same scrutiny to a pinned document", async () => {
    expect(
      await asyncRefusalDetail(
        fetchAuthorizationServerMetadata({
          issuer: ISSUER,
          document: wellFormed({ code_challenge_methods_supported: ["plain"] }),
        }),
      ),
    ).toMatch(/PKCE S256/);
  });

  it("reports the validation failure, not 'nothing found', when a document was reachable but wrong", async () => {
    // An operator pointed at a real but unusable issuer needs to know which
    // requirement it failed, not that three URLs were tried.
    expect(
      await asyncRefusalDetail(
        fetchAuthorizationServerMetadata({
          issuer: ISSUER,
          fetchImpl: serving({
            [`${ISSUER}.well-known/oauth-authorization-server`]: wellFormed({
              code_challenge_methods_supported: ["plain"],
            }),
          }),
        }),
      ),
    ).toMatch(/PKCE S256/);
  });

  it("lists the locations it tried when nothing was found", async () => {
    const detail = await asyncRefusalDetail(
      fetchAuthorizationServerMetadata({
        issuer: ISSUER,
        fetchImpl: serving({}),
      }),
    );
    expect(detail).toMatch(/Keine Authorization-Server-Metadaten gefunden/);
    expect(detail).toContain(".well-known/oauth-authorization-server");
  });
});

describe("client registration mode", () => {
  it("reports CIMD when the issuer advertises it", () => {
    const metadata = validateAuthorizationServerMetadata(
      wellFormed({ client_id_metadata_document_supported: true }),
      ISSUER,
    );
    expect(clientRegistrationMode(metadata)).toBe("cimd");
  });

  it("reports DCR when a registration endpoint is published", () => {
    const metadata = validateAuthorizationServerMetadata(
      wellFormed({ registration_endpoint: `${ISSUER}register` }),
      ISSUER,
    );
    expect(clientRegistrationMode(metadata)).toBe("dcr");
  });

  it("prefers CIMD when both are offered", () => {
    const metadata = validateAuthorizationServerMetadata(
      wellFormed({
        client_id_metadata_document_supported: true,
        registration_endpoint: `${ISSUER}register`,
      }),
      ISSUER,
    );
    expect(clientRegistrationMode(metadata)).toBe("cimd");
  });

  it("reports none when clients must be pre-registered by hand", () => {
    // A real answer, not an error: workable privately, a blocker for public
    // distribution.
    const metadata = validateAuthorizationServerMetadata(wellFormed(), ISSUER);
    expect(clientRegistrationMode(metadata)).toBe("none");
  });
});
