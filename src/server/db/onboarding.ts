/**
 * One user's setup sessions in Postgres.
 *
 * Each session is one JSON document with an optimistic revision: an update
 * built on an older revision is refused instead of overwriting.
 */
import {
  ONBOARDING_RETENTION_MS,
  OnboardingRecordSchema,
  RepositoryConflictError,
  type OnboardingRecord,
  type OnboardingStateRepository,
} from "../onboarding/repository.js";
import type { Database, Queryable } from "./database.js";

const parse = (raw: unknown) => OnboardingRecordSchema.parse(raw);

export class PostgresOnboardingRepository implements OnboardingStateRepository {
  readonly durability = "distributed" as const;

  constructor(
    private readonly db: Database,
    private readonly userId: string,
  ) {}

  private run<T>(work: (client: Queryable) => Promise<T>) {
    return this.db.asUser(this.userId, work);
  }

  private async load(client: Queryable, sessionId: string, lock = false) {
    const row = (
      await client.query<{ record: unknown }>(
        `select record from arnold.onboarding_sessions
          where user_id = $1 and onboarding_session_id = $2${lock ? " for update" : ""}`,
        [this.userId, sessionId],
      )
    ).rows[0];
    return row ? parse(row.record) : undefined;
  }

  private async store(
    client: Queryable,
    record: OnboardingRecord,
    insert: boolean,
  ) {
    const values = [
      this.userId,
      record.session.onboarding_session_id,
      record.owner_subject,
      record.session.status,
      record.session.revision,
      record.session.expires_at_utc,
      record.session.updated_at_utc,
      JSON.stringify(record),
    ];
    await client.query(
      insert
        ? `insert into arnold.onboarding_sessions
             (user_id, onboarding_session_id, owner_subject, status, revision, expires_at, updated_at, record)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`
        : `update arnold.onboarding_sessions
              set owner_subject = $3, status = $4, revision = $5,
                  expires_at = $6, updated_at = $7, record = $8
            where user_id = $1 and onboarding_session_id = $2`,
      values,
    );
  }

  createSession(record: OnboardingRecord) {
    const parsed = parse(record);
    return this.run(async (client) => {
      if (await this.load(client, parsed.session.onboarding_session_id))
        throw new RepositoryConflictError(
          "Diese Einrichtungssitzung existiert bereits.",
        );
      await this.store(client, parsed, true);
      return structuredClone(parsed);
    });
  }

  getSession(sessionId: string) {
    return this.run((client) => this.load(client, sessionId));
  }

  updateSession(record: OnboardingRecord, expectedRevision: number) {
    const parsed = parse(record);
    return this.run(async (client) => {
      const current = await this.load(
        client,
        parsed.session.onboarding_session_id,
        true,
      );
      if (!current)
        throw new RepositoryConflictError(
          "Diese Einrichtungssitzung existiert nicht mehr.",
        );
      if (current.session.revision !== expectedRevision)
        throw new RepositoryConflictError();
      // Identity and creation time are immutable; a token may never be
      // swapped on an existing session (session fixation).
      if (
        current.token_fingerprint !== parsed.token_fingerprint ||
        current.owner_subject !== parsed.owner_subject ||
        current.session.created_at_utc !== parsed.session.created_at_utc
      )
        throw new RepositoryConflictError(
          "Identität einer Einrichtungssitzung ist unveränderlich.",
        );
      await this.store(client, parsed, false);
      return structuredClone(parsed);
    });
  }

  expireSession(sessionId: string) {
    return this.run(async (client) => {
      const current = await this.load(client, sessionId, true);
      if (!current) return undefined;
      const next = parse({
        ...current,
        session: {
          ...current.session,
          status: "EXPIRED",
          handoff_status: "not_ready",
          revision: current.session.revision + 1,
        },
      });
      await this.store(client, next, false);
      return next;
    });
  }

  findLatestByOwner(owner: string) {
    return this.run(async (client) => {
      const row = (
        await client.query<{ record: unknown }>(
          `select record from arnold.onboarding_sessions
            where user_id = $1 and owner_subject = $2
            order by updated_at desc, revision desc limit 1`,
          [this.userId, owner],
        )
      ).rows[0];
      return row ? parse(row.record) : undefined;
    });
  }

  reissueToken(
    sessionId: string,
    fingerprint: string,
    expectedRevision: number,
  ) {
    return this.run(async (client) => {
      const current = await this.load(client, sessionId, true);
      if (!current)
        throw new RepositoryConflictError(
          "Diese Einrichtungssitzung existiert nicht mehr.",
        );
      if (current.session.revision !== expectedRevision)
        throw new RepositoryConflictError();
      const next = parse({ ...current, token_fingerprint: fingerprint });
      await this.store(client, next, false);
      return next;
    });
  }

  /** Drops this user's expired, uncompleted sessions past their grace period. */
  purge(now: Date) {
    return this.run(async (client) => {
      const result = await client.query(
        `delete from arnold.onboarding_sessions
          where user_id = $1 and status <> 'COMPLETED'
            and expires_at <= $2`,
        [this.userId, new Date(now.getTime() - ONBOARDING_RETENTION_MS)],
      );
      return result.rowCount ?? 0;
    });
  }
}
