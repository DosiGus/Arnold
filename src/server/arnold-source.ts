/**
 * Server-side read path for the dashboard.
 *
 * The UI never talks to the database: it calls MCP tools, and this module
 * answers them from a validated `ArnoldDataset`. A read that fails never
 * falls back to other data; it becomes a failure the UI can act on.
 */
import {
  ArnoldDatasetSchema,
  strengthTrainingView,
} from "../shared/arnold-schema-v1.js";
import {
  runTrainingDates,
  type DatasetWithRunDays,
} from "../analytics/activity.js";
import { runRecapInputsOf } from "../analytics/recap.js";
import { scoreRunsOf, type ScoreHealthInput } from "../analytics/scores.js";
import type { Recovery } from "../shared/write-recovery.js";
import type { ArnoldDataset } from "../shared/arnold-schema-v1.js";
import type { WatchDelivery } from "../shared/watch-contract.js";
import type { ArnoldStore } from "./workout/infrastructure.js";

/** Why a dataset could not be produced, in terms the UI can act on. */
export type ArnoldSourceFailure = {
  readonly code: "unavailable" | "schema_incompatible" | "unknown";
  readonly message: string;
  /** True when simply trying again can plausibly succeed. */
  readonly retryable: boolean;
  /** What the user should do next; derived from `retryable` when absent. */
  readonly recovery?: Recovery;
};

export class ArnoldSourceError extends Error {
  constructor(readonly failure: ArnoldSourceFailure) {
    super(failure.message);
    this.name = "ArnoldSourceError";
  }
}

/** Maps a read error onto the UI-facing failure taxonomy. */
export function classifyFailure(error: unknown): ArnoldSourceFailure {
  if (error instanceof ArnoldSourceError) return error.failure;
  return {
    code: "unavailable",
    message:
      "Die Trainingsdaten konnten gerade nicht geladen werden. Bitte gleich noch einmal versuchen.",
    retryable: true,
    recovery: "retry_same_request",
  };
}

/** A dataset plus when it was read. */
export type DatasetSnapshot = {
  readonly dataset: ArnoldDataset;
  readonly fetchedAt: string;
  readonly ageMs: number;
};

export interface ArnoldDataSource {
  readonly label: string;
  readonly description: string;
  /**
   * True when the source serves invented data only.
   *
   * This decides whether the server may listen on a public address without a
   * login: a synthetic dataset has nothing to leak, real training data has
   * everything. See `requireSafeArnoldBinding`.
   */
  readonly synthetic: boolean;
  /** Validated dataset; throws `ArnoldSourceError` on any failure. */
  load(): Promise<DatasetSnapshot>;
  /**
   * Watch recordings and stored health data for these client sessions, only
   * the caller's own. Only a database source has them; without one a watch
   * workout shows no recording.
   */
  watchRecordings?(
    clientSessionIds: readonly string[],
  ): Promise<readonly WatchRecordingData[]>;
  /**
   * Watch values for the recovery score (UX-009), only the caller's own and
   * only with active consent. Only a database source has them.
   */
  scoreHealth?(referenceDate: string, now: Date): Promise<ScoreHealthInput>;
  /**
   * UX-007: whether this dataset's plan is on the user's watch, from the
   * marks the watches confirmed. Only a database source has watches; never
   * throws (a failure is `unknown`).
   */
  watchDelivery?(dataset: ArnoldDataset): Promise<WatchDelivery>;
}

/**
 * The watch values for the scores, failing safe: a source without them has
 * no consent to speak of, and a failed read counts as "unavailable" so only
 * the training part is used. Never a guessed value.
 */
export async function scoreHealthOf(
  source: Pick<ArnoldDataSource, "scoreHealth">,
  referenceDate: string,
  now: Date,
): Promise<ScoreHealthInput> {
  if (!source.scoreHealth) return { status: "no_consent" };
  try {
    return await source.scoreHealth(referenceDate, now);
  } catch {
    return { status: "unavailable" };
  }
}

/** One watch recording as stored (UMSETZUNG §3.3, §3.4); gaps stay null. */
export interface WatchRecordingData {
  client_session_id: string;
  started_at_utc: string;
  ended_at_utc: string;
  set_timings: readonly {
    exercise_order: number;
    set_number: number;
    side: string;
    rest_before_s: number | null;
  }[];
  /** Null without stored health data (no consent, or not sent yet). */
  health: {
    hr: {
      interval_s: number;
      start_utc: string;
      values: readonly (number | null)[];
    } | null;
    calories_kcal: number | null;
    before: WatchSnapshotData | null;
    after: WatchSnapshotData | null;
  } | null;
}
export interface WatchSnapshotData {
  at_utc: string;
  body_battery?: number | null;
  stress?: number | null;
  resting_hr?: number | null;
}

/** The dashboard's view of a store: every read is fresh. */
export function storeSource(
  store: ArnoldStore,
  options: { synthetic: boolean; label: string; description: string },
): ArnoldDataSource {
  return {
    synthetic: options.synthetic,
    label: options.label,
    description: options.description,
    async load() {
      let raw: ArnoldDataset;
      try {
        raw = await store.read();
      } catch (error) {
        throw new ArnoldSourceError(classifyFailure(error));
      }
      const parsed = ArnoldDatasetSchema.safeParse(raw);
      if (!parsed.success)
        throw new ArnoldSourceError({
          code: "schema_incompatible",
          message:
            "Die gespeicherten Trainingsdaten passen nicht zum erwarteten Format.",
          retryable: false,
          recovery: "contact_support",
        });
      // Completed runs reach the dashboard only as calendar days (RUN-022):
      // the dates are read here, from this user's own rows, and travel with
      // the strength-only dataset.
      const runDays = runTrainingDates(parsed.data);
      // The scores (UX-009) also need distance, duration and type of the
      // completed runs; nothing else reads these summaries.
      const runScores = scoreRunsOf(parsed.data);
      // UX-014: the recap after a run reads the same way.
      const runRecaps = runRecapInputsOf(parsed.data);
      const strength = strengthTrainingView(parsed.data);
      const dataset: DatasetWithRunDays = runDays.length
        ? {
            ...strength,
            runTrainingDates: runDays,
            ...(runScores.length ? { runScoreInputs: runScores } : {}),
            ...(runRecaps.length ? { runRecapInputs: runRecaps } : {}),
          }
        : strength;
      return {
        // Dashboard, analytics and workout lists read strength training
        // only; runs and planned workouts are left out (RUN-003).
        dataset,
        fetchedAt: new Date().toISOString(),
        ageMs: 0,
      };
    },
  };
}

/** In-memory source over a fixed dataset; used by tests. */
export class StaticArnoldDataSource implements ArnoldDataSource {
  /** Holds only the dataset it was constructed with. */
  readonly synthetic = true;
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
    this.label = options.label ?? "Arnold · Testdaten";
    this.description =
      options.description ??
      "Synthetische Arnold-Daten; ausschließlich lesend.";
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
}
