/**
 * Storage for onboarding sessions.
 *
 * Onboarding state never touches the six Arnold tables. `CONFIG` says so
 * itself — `onboarding_storage: BACKEND_ONLY` — and the reason is structural:
 * setup answers are not training data, and they belong to a setup conversation
 * that may be abandoned.
 *
 * Two implementations:
 *
 *   - `InMemoryOnboardingRepository` for the fixture profile and tests.
 *   - `PostgresOnboardingRepository` (src/server/db/onboarding.ts) for real
 *     accounts.
 *
 * Both enforce the same two retention rules, because an abandoned setup must
 * not accumulate forever:
 *
 *   1. An expired session is returned as expired exactly once so the user can
 *      be told, and is then collectable.
 *   2. `purge` removes sessions whose grace period after expiry has passed.
 *      There is no path that keeps an orphaned draft indefinitely.
 *
 * The stored record carries a *hash* of the session secret, never the secret.
 * See `access.ts` for why.
 */
import { z } from "zod";
import {
  OnboardingSessionSchema,
  type OnboardingSession,
} from "../../shared/onboarding-contract.js";
import { InProcessWriteCoordinator } from "../workout/infrastructure.js";

/**
 * A session plus the fields that must never leave the server.
 *
 * Keeping them in a separate wrapper rather than on `OnboardingSession` means
 * the public contract cannot accidentally serialise a token hash or an owner
 * subject into a tool result.
 */
export const OnboardingRecordSchema = z.strictObject({
  session: OnboardingSessionSchema,
  /** SHA-256 of the session secret. The secret itself is never stored. */
  token_fingerprint: z.string().length(64),
  /** The principal that created the session. A fixture subject before Task 007. */
  owner_subject: z.string().min(1),
  /** Request ids already applied, with the revision they produced. Idempotency. */
  applied: z.record(z.string(), z.number().int().positive()),
});
export type OnboardingRecord = z.infer<typeof OnboardingRecordSchema>;

/** How long after expiry a record is kept before it is collectable. */
export const ONBOARDING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface OnboardingStateRepository {
  /**
   * `memory` is per process, `local` survives a restart on one machine,
   * `distributed` would survive a multi-instance deployment. Reported to the
   * client so resumption is never overstated.
   */
  readonly durability: "memory" | "local" | "distributed";
  createSession(record: OnboardingRecord): Promise<OnboardingRecord>;
  getSession(sessionId: string): Promise<OnboardingRecord | undefined>;
  /** Refuses when `expectedRevision` no longer matches the stored one. */
  updateSession(
    record: OnboardingRecord,
    expectedRevision: number,
  ): Promise<OnboardingRecord>;
  /** Marks a session expired. Idempotent. */
  expireSession(sessionId: string): Promise<OnboardingRecord | undefined>;
  /**
   * The owner's most recently updated session, of any status. Only meaningful
   * where the owner is a verified account; see `OnboardingAccessControl.perOwner`.
   */
  findLatestByOwner(owner: string): Promise<OnboardingRecord | undefined>;
  /**
   * Replaces the stored secret fingerprint, so a verified owner who lost the
   * secret (a new chat) can be handed a fresh one. The old secret stops
   * working. Refuses when `expectedRevision` no longer matches.
   */
  reissueToken(
    sessionId: string,
    fingerprint: string,
    expectedRevision: number,
  ): Promise<OnboardingRecord>;
  /** Drops records whose retention window has passed. Returns how many. */
  purge(now: Date): Promise<number>;
}

export class RepositoryConflictError extends Error {
  readonly code = "REVISION_CONFLICT" as const;
  constructor(message = "Die Einrichtung wurde zwischenzeitlich geändert.") {
    super(message);
    this.name = "RepositoryConflictError";
  }
}

/** True once the expiry timestamp has passed. */
export const isExpired = (session: OnboardingSession, now: Date) =>
  Date.parse(session.expires_at_utc) <= now.getTime();

const collectable = (record: OnboardingRecord, now: Date) =>
  Date.parse(record.session.expires_at_utc) + ONBOARDING_RETENTION_MS <=
  now.getTime();

/** Shared retention and revision rules, so both backends behave identically. */
abstract class BaseOnboardingRepository implements OnboardingStateRepository {
  abstract readonly durability: "memory" | "local" | "distributed";
  protected abstract load(): Promise<OnboardingRecord[]>;
  protected abstract store(records: OnboardingRecord[]): Promise<void>;
  /** Serialises read-modify-write so two concurrent updates cannot interleave. */
  protected queue = new InProcessWriteCoordinator();
  protected lock = "onboarding";

  async createSession(record: OnboardingRecord) {
    return this.queue.exclusive(this.lock, async () => {
      const parsed = OnboardingRecordSchema.parse(record);
      const records = await this.load();
      if (
        records.some(
          (r) =>
            r.session.onboarding_session_id ===
            parsed.session.onboarding_session_id,
        )
      )
        throw new RepositoryConflictError(
          "Diese Einrichtungssitzung existiert bereits.",
        );
      records.push(parsed);
      await this.store(records);
      return structuredClone(parsed);
    });
  }

  async getSession(sessionId: string) {
    const record = (await this.load()).find(
      (r) => r.session.onboarding_session_id === sessionId,
    );
    return record && structuredClone(record);
  }

  async updateSession(record: OnboardingRecord, expectedRevision: number) {
    return this.queue.exclusive(this.lock, async () => {
      const parsed = OnboardingRecordSchema.parse(record);
      const records = await this.load();
      const index = records.findIndex(
        (r) =>
          r.session.onboarding_session_id ===
          parsed.session.onboarding_session_id,
      );
      if (index < 0)
        throw new RepositoryConflictError(
          "Diese Einrichtungssitzung existiert nicht mehr.",
        );
      // Optimistic locking: the caller states which revision it read, and a
      // write built on anything else is refused rather than overwriting.
      if (records[index].session.revision !== expectedRevision)
        throw new RepositoryConflictError();
      // Identity and creation time are immutable; a token may never be swapped
      // on an existing session, which would be a session-fixation path.
      const current = records[index];
      if (
        current.token_fingerprint !== parsed.token_fingerprint ||
        current.owner_subject !== parsed.owner_subject ||
        current.session.created_at_utc !== parsed.session.created_at_utc
      )
        throw new RepositoryConflictError(
          "Identität einer Einrichtungssitzung ist unveränderlich.",
        );
      records[index] = parsed;
      await this.store(records);
      return structuredClone(parsed);
    });
  }

  async expireSession(sessionId: string) {
    return this.queue.exclusive(this.lock, async () => {
      const records = await this.load();
      const index = records.findIndex(
        (r) => r.session.onboarding_session_id === sessionId,
      );
      if (index < 0) return undefined;
      const next: OnboardingRecord = {
        ...records[index],
        session: {
          ...records[index].session,
          status: "EXPIRED",
          handoff_status: "not_ready",
          revision: records[index].session.revision + 1,
        },
      };
      records[index] = OnboardingRecordSchema.parse(next);
      await this.store(records);
      return structuredClone(records[index]);
    });
  }

  async findLatestByOwner(owner: string) {
    const mine = (await this.load()).filter(
      (record) => record.owner_subject === owner,
    );
    const latest = mine.sort(
      (a, b) =>
        Date.parse(b.session.updated_at_utc) -
          Date.parse(a.session.updated_at_utc) ||
        b.session.revision - a.session.revision,
    )[0];
    return latest && structuredClone(latest);
  }

  async reissueToken(
    sessionId: string,
    fingerprint: string,
    expectedRevision: number,
  ) {
    return this.queue.exclusive(this.lock, async () => {
      const records = await this.load();
      const index = records.findIndex(
        (r) => r.session.onboarding_session_id === sessionId,
      );
      if (index < 0)
        throw new RepositoryConflictError(
          "Diese Einrichtungssitzung existiert nicht mehr.",
        );
      if (records[index].session.revision !== expectedRevision)
        throw new RepositoryConflictError();
      records[index] = OnboardingRecordSchema.parse({
        ...records[index],
        token_fingerprint: fingerprint,
      });
      await this.store(records);
      return structuredClone(records[index]);
    });
  }

  async purge(now: Date) {
    return this.queue.exclusive(this.lock, async () => {
      const records = await this.load();
      const keep = records.filter((record) => !collectable(record, now));
      if (keep.length === records.length) return 0;
      await this.store(keep);
      return records.length - keep.length;
    });
  }
}

export class InMemoryOnboardingRepository extends BaseOnboardingRepository {
  readonly durability = "memory" as const;
  private records: OnboardingRecord[] = [];
  protected async load() {
    return this.records.map((r) => structuredClone(r));
  }
  protected async store(records: OnboardingRecord[]) {
    this.records = records.map((r) => structuredClone(r));
  }
  /** Test helper: how many records are held. Never used in product code. */
  get size() {
    return this.records.length;
  }
}
