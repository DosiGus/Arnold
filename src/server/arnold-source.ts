/**
 * Server-side Arnold data source.
 *
 * The only place that reads Google Sheets. The UI never receives credentials and
 * never talks to Google: it calls MCP tools, and this module answers them from a
 * validated `ArnoldDataset`.
 *
 * The cache here is deliberately small — one dataset, one short TTL, one
 * in-flight read — but it is shaped for what comes later. A future writing tool
 * only has to call `invalidate()` after a successful write for the next read to
 * go back to Google; nothing else needs to know a cache exists. A read that
 * fails never replaces a good dataset with demo data and never presents a cached
 * dataset as fresh: `age_ms` travels with every answer.
 */
import {
  ArnoldSheetsReadAdapter,
  ArnoldSheetsReadError,
  type ArnoldSheetsReadOptions,
  type ArnoldSheetsReadTransport,
} from "./arnold-sheets-read-adapter.js";
import { ArnoldDataError } from "./arnold-sheet-parser.js";
import type { ArnoldDataset } from "../shared/arnold-schema-v1.js";

/** Why a dataset could not be produced, in terms the UI can act on. */
export type ArnoldSourceFailure = {
  readonly code:
    | "auth_missing"
    | "permission_denied"
    | "not_found"
    | "rate_limited"
    | "unavailable"
    | "schema_incompatible"
    | "unknown";
  readonly message: string;
  /** True when simply trying again can plausibly succeed. */
  readonly retryable: boolean;
};

export class ArnoldSourceError extends Error {
  constructor(readonly failure: ArnoldSourceFailure) {
    super(failure.message);
    this.name = "ArnoldSourceError";
  }
}

/** Maps adapter and validation errors onto the UI-facing failure taxonomy. */
export function classifyFailure(error: unknown): ArnoldSourceFailure {
  if (error instanceof ArnoldSourceError) return error.failure;
  if (error instanceof ArnoldSheetsReadError) {
    const map = {
      AUTH: { code: "auth_missing", retryable: false },
      PERMISSION: { code: "permission_denied", retryable: false },
      NOT_FOUND: { code: "not_found", retryable: false },
      RATE_LIMIT: { code: "rate_limited", retryable: true },
      UNAVAILABLE: { code: "unavailable", retryable: true },
      API: { code: "unknown", retryable: true },
    } as const;
    const mapped = map[error.code];
    return {
      code: mapped.code,
      message: error.message,
      retryable: mapped.retryable,
    };
  }
  if (error instanceof ArnoldDataError)
    return {
      code: "schema_incompatible",
      message:
        "Die Arnold-Datei passt nicht zum erwarteten Schema v1. Struktur und Spalten der sechs Tabellen prüfen.",
      retryable: false,
    };
  return {
    code: "unknown",
    message:
      "Die Trainingsdaten konnten nicht geladen werden. Verbindung und Serverprotokoll prüfen.",
    retryable: true,
  };
}

/** A dataset plus how old it is, so nothing stale is ever shown as current. */
export type DatasetSnapshot = {
  readonly dataset: ArnoldDataset;
  readonly fetchedAt: string;
  readonly ageMs: number;
};

export interface ArnoldDataSource {
  readonly mode: "arnold_sheets";
  readonly label: string;
  readonly description: string;
  /** Validated dataset; throws `ArnoldSourceError` on any failure. */
  load(): Promise<DatasetSnapshot>;
  /** Drops the cached dataset. Call after a successful write. */
  invalidate(): void;
}

export type ArnoldSheetsSourceOptions = ArnoldSheetsReadOptions & {
  /** How long a dataset may be reused. 0 disables reuse entirely. */
  readonly cacheTtlMs?: number;
  readonly label?: string;
  readonly description?: string;
  /** Injected for tests; production uses the adapter's Google transport. */
  readonly transport?: ArnoldSheetsReadTransport;
  readonly now?: () => number;
};

/**
 * Reads the Arnold workbook through the Task 001 adapter and caches the result
 * for `cacheTtlMs`. Concurrent callers share one in-flight read, so opening the
 * dashboard does not multiply Google requests.
 */
export class ArnoldSheetsDataSource implements ArnoldDataSource {
  readonly mode = "arnold_sheets" as const;
  readonly label: string;
  readonly description: string;
  private readonly adapter: ArnoldSheetsReadAdapter;
  private readonly ttl: number;
  private readonly now: () => number;
  private cached?: { dataset: ArnoldDataset; at: number };
  private pending?: Promise<DatasetSnapshot>;
  /**
   * Bumped by every `invalidate()`. A read carries the generation it started in
   * and may only write the cache while that generation is still current, so a
   * slow read cannot resurrect data that was explicitly invalidated — which is
   * exactly what a later write tool will rely on.
   */
  private generation = 0;
  private pendingGeneration = -1;
  private pendingToken: symbol | undefined;

  constructor(options: ArnoldSheetsSourceOptions) {
    // The adapter's option schema is strict: it accepts adapter options only.
    // Source-level concerns (cache, labels, transport, clock) must be split off
    // here, or constructing the source rejects the documented configuration
    // before any Google call is attempted.
    const {
      cacheTtlMs,
      label,
      description,
      transport,
      now,
      ...adapterOptions
    } = options;
    this.adapter = new ArnoldSheetsReadAdapter(adapterOptions, transport);
    this.ttl = Math.max(cacheTtlMs ?? 15_000, 0);
    this.now = now ?? Date.now;
    this.label = label ?? "Arnold · Google Sheets";
    this.description =
      description ??
      "Deine Arnold-Trainingsdatei wird ausschließlich lesend über den Server ausgewertet.";
  }

  private snapshot(dataset: ArnoldDataset, at: number): DatasetSnapshot {
    return {
      dataset,
      fetchedAt: new Date(at).toISOString(),
      ageMs: Math.max(this.now() - at, 0),
    };
  }

  async load(): Promise<DatasetSnapshot> {
    const cached = this.cached;
    if (cached && this.now() - cached.at < this.ttl)
      return this.snapshot(cached.dataset, cached.at);
    // A read started before an invalidation is not reused afterwards.
    if (this.pending && this.pendingGeneration === this.generation)
      return this.pending;
    const generation = this.generation;
    const token = Symbol("read");
    this.pendingToken = token;
    const pending = (async () => {
      try {
        const dataset = await this.adapter.getDataset();
        const at = this.now();
        if (generation === this.generation) this.cached = { dataset, at };
        return this.snapshot(dataset, at);
      } catch (error) {
        // A failed read must not leave a stale dataset looking authoritative.
        throw new ArnoldSourceError(classifyFailure(error));
      } finally {
        // Only the newest read clears the shared slot.
        if (this.pendingToken === token) this.pending = undefined;
      }
    })();
    this.pending = pending;
    this.pendingGeneration = generation;
    return pending;
  }

  invalidate(): void {
    this.cached = undefined;
    this.generation += 1;
  }
}

/** In-memory source over a fixed dataset; used by tests and fixture servers. */
export class StaticArnoldDataSource implements ArnoldDataSource {
  readonly mode = "arnold_sheets" as const;
  readonly label: string;
  readonly description: string;
  private failure?: ArnoldSourceFailure;
  constructor(
    private dataset: ArnoldDataset,
    options: {
      label?: string;
      description?: string;
      failure?: ArnoldSourceFailure;
    } = {},
  ) {
    this.label = options.label ?? "Arnold · Testdatei";
    this.description =
      options.description ??
      "Synthetische Arnold-Fixture; ausschließlich lesend.";
    this.failure = options.failure;
  }
  /** Lets a test flip the source into a failing state at runtime. */
  setFailure(failure?: ArnoldSourceFailure) {
    this.failure = failure;
  }
  setDataset(dataset: ArnoldDataset) {
    this.dataset = dataset;
  }
  async load(): Promise<DatasetSnapshot> {
    if (this.failure) throw new ArnoldSourceError(this.failure);
    return {
      dataset: this.dataset,
      fetchedAt: new Date().toISOString(),
      ageMs: 0,
    };
  }
  invalidate(): void {}
}
