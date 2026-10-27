/**
 * The issuer's signing keys, cached.
 *
 * A resource server cannot hold its issuer's public keys as configuration:
 * authorization servers rotate them, usually by publishing the new key
 * alongside the old one and retiring the old one later. So Arnold resolves a
 * key by `kid` at verification time, and this module is the cache that keeps
 * that from meaning an HTTP request per MCP call.
 *
 * Three behaviours are load-bearing.
 *
 * **Rotation refetch.** An unknown `kid` is the normal signal that rotation
 * happened, so the cache refetches once rather than refusing the token. That
 * is also the obvious denial-of-service lever — a flood of tokens bearing
 * random `kid`s would become a flood of outbound requests — so a refetch is
 * rate-limited by `minRefetchIntervalMs`. Inside the cooldown an unknown
 * `kid` simply fails.
 *
 * **Single-flight.** Concurrent misses share one in-flight request. Without
 * this, a cold cache under concurrent load produces a burst of identical
 * fetches against the issuer, which is both rude and a good way to get rate-
 * limited by the very service Arnold needs to stay available.
 *
 * **Stale-on-error.** When a refresh fails but cached keys exist, the cached
 * keys keep working until their hard expiry. A transient JWKS outage should
 * not log every Arnold user out; a prolonged one should, and does.
 */
import type { PublicJwk } from "./jwt.js";
import { ArnoldAuthError } from "./errors.js";

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface JwksCacheOptions {
  jwksUri: string;
  /** How long a successful fetch is served without revalidation. */
  ttlMs?: number;
  /** How long cached keys may still be used after a failed refresh. */
  staleTtlMs?: number;
  /** Floor between two rotation-triggered refetches. */
  minRefetchIntervalMs?: number;
  /** Per-request timeout for the JWKS fetch. */
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export const DEFAULT_JWKS_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_JWKS_STALE_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_MIN_REFETCH_INTERVAL_MS = 30 * 1000;
export const DEFAULT_JWKS_TIMEOUT_MS = 5 * 1000;

/** The subset of a JWKS document Arnold reads. */
interface JwksDocument {
  keys: PublicJwk[];
}

function parseJwks(payload: unknown): PublicJwk[] {
  if (payload === null || typeof payload !== "object")
    throw new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      "JWKS-Dokument ist kein Objekt.",
    );
  const keys = (payload as JwksDocument).keys;
  if (!Array.isArray(keys))
    throw new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      "JWKS-Dokument enthält kein keys-Array.",
    );
  const usable = keys.filter(
    (key): key is PublicJwk =>
      key !== null &&
      typeof key === "object" &&
      typeof (key as PublicJwk).kty === "string",
  );
  if (usable.length === 0)
    throw new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      "JWKS-Dokument enthält keine verwendbaren Schlüssel.",
    );
  return usable;
}

export class JwksCache {
  private readonly jwksUri: string;
  private readonly ttlMs: number;
  private readonly staleTtlMs: number;
  private readonly minRefetchIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  private keys: PublicJwk[] = [];
  private fetchedAt = 0;
  /**
   * When a rotation-triggered refetch was last *attempted*. Tracked apart
   * from `fetchedAt` on purpose: an ordinary scheduled refresh must not start
   * the rotation cooldown, or a real key rotation would stay invisible for a
   * full cooldown after every routine refresh.
   */
  private rotationAttemptAt = 0;
  private inFlight: Promise<PublicJwk[]> | undefined;

  constructor(options: JwksCacheOptions) {
    this.jwksUri = options.jwksUri;
    this.ttlMs = options.ttlMs ?? DEFAULT_JWKS_TTL_MS;
    this.staleTtlMs = options.staleTtlMs ?? DEFAULT_JWKS_STALE_TTL_MS;
    this.minRefetchIntervalMs =
      options.minRefetchIntervalMs ?? DEFAULT_MIN_REFETCH_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS;
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.now = options.now ?? (() => Date.now());
  }

  /** Visible for diagnostics: how many keys are cached, and how old they are. */
  get state(): { count: number; ageMs: number | null } {
    return {
      count: this.keys.length,
      ageMs: this.fetchedAt === 0 ? null : this.now() - this.fetchedAt,
    };
  }

  private get fresh(): boolean {
    return this.keys.length > 0 && this.now() - this.fetchedAt < this.ttlMs;
  }

  private get usableWhileStale(): boolean {
    return (
      this.keys.length > 0 && this.now() - this.fetchedAt < this.staleTtlMs
    );
  }

  private async load(): Promise<PublicJwk[]> {
    // Single-flight: every concurrent miss awaits the same request.
    if (this.inFlight) return this.inFlight;
    const request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.jwksUri, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok)
          throw new ArnoldAuthError(
            "VERIFICATION_UNAVAILABLE",
            `JWKS-Endpunkt antwortete mit ${response.status}.`,
          );
        const keys = parseJwks(await response.json());
        this.keys = keys;
        this.fetchedAt = this.now();
        return keys;
      } finally {
        clearTimeout(timer);
        this.inFlight = undefined;
      }
    })();
    this.inFlight = request;
    return request;
  }

  /**
   * Resolves the key for `kid`, fetching or refetching as needed.
   *
   * A token with no `kid` resolves only when the issuer publishes exactly one
   * key. Picking "the first key that happens to verify" out of a multi-key
   * JWKS would quietly undo rotation hygiene, so it is refused instead.
   */
  async resolve(kid: string | undefined): Promise<PublicJwk> {
    let fetchedInThisCall = false;
    if (!this.fresh) {
      try {
        await this.load();
        fetchedInThisCall = true;
      } catch (error) {
        // Keep serving cached keys through a transient outage.
        if (!this.usableWhileStale) throw error;
      }
    }

    const match = this.find(kid);
    if (match) return match;

    // Unknown kid. Refetching only helps when the document in hand came from
    // the cache — if it was just fetched, it is already current and the key
    // genuinely does not exist. Guarded by a cooldown so that a flood of
    // random kids cannot be turned into a flood of outbound requests.
    if (!fetchedInThisCall) {
      const sinceRotationAttempt = this.now() - this.rotationAttemptAt;
      if (sinceRotationAttempt >= this.minRefetchIntervalMs) {
        this.rotationAttemptAt = this.now();
        try {
          await this.load();
        } catch (error) {
          if (!this.usableWhileStale) throw error;
        }
        const afterRotation = this.find(kid);
        if (afterRotation) return afterRotation;
      }
    }

    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      kid === undefined
        ? "Token ohne kid, und der Issuer veröffentlicht mehrere Schlüssel."
        : `Kein Schlüssel mit kid ${kid} im JWKS des Issuers.`,
    );
  }

  private find(kid: string | undefined): PublicJwk | undefined {
    if (kid === undefined)
      return this.keys.length === 1 ? this.keys[0] : undefined;
    return this.keys.find((key) => key.kid === kid);
  }
}

/**
 * A cache over a fixed key set, for tests and for the fixture auth mode.
 *
 * Deliberately a separate class rather than a flag on `JwksCache`: a cache
 * that can be told "never fetch, trust these keys" is one configuration
 * mistake away from being that in production.
 */
export class StaticJwks {
  constructor(private readonly keys: readonly PublicJwk[]) {}

  async resolve(kid: string | undefined): Promise<PublicJwk> {
    const match =
      kid === undefined
        ? this.keys.length === 1
          ? this.keys[0]
          : undefined
        : this.keys.find((key) => key.kid === kid);
    if (!match)
      throw new ArnoldAuthError(
        "INVALID_TOKEN",
        `Kein Schlüssel mit kid ${String(kid)} im konfigurierten Schlüsselsatz.`,
      );
    return match;
  }
}

/** What the token verifier needs from a key source. */
export interface KeyResolver {
  resolve(kid: string | undefined): Promise<PublicJwk>;
}
