/**
 * Arnold accounts in Postgres.
 *
 * Login → user resolution runs through the SQL function
 * `arnold.resolve_identity`, which creates the account on first contact and
 * is safe when two first requests arrive at once. It only writes
 * `last_seen_at` once an hour, so an ordinary request does not write at all.
 */
import type {
  ArnoldUser,
  IdentityConnection,
  IdentityRepository,
  ResolvedIdentity,
  UserStatus,
} from "../identity/repository.js";
import type { Database } from "./database.js";

type ResolvedRow = {
  user_id: string;
  status: UserStatus;
  tracker_id: string;
  created: boolean;
  user_created_at: Date;
  user_updated_at: Date;
  connection_id: string;
  connection_created_at: Date;
  last_seen_at: Date;
};

const iso = (value: Date) => value.toISOString();

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly db: Database) {}

  private async resolve(
    issuer: string,
    subject: string,
    create: boolean,
  ): Promise<ResolvedIdentity | undefined> {
    if (issuer.length === 0 || subject.length === 0)
      throw new Error("Identität benötigt issuer und subject.");
    const row = (
      await this.db.query<ResolvedRow>(
        "select * from arnold.resolve_identity($1, $2, $3)",
        [issuer, subject, create],
      )
    ).rows[0];
    if (!row) return undefined;
    return {
      user: {
        user_id: row.user_id,
        status: row.status,
        created_at_utc: iso(row.user_created_at),
        updated_at_utc: iso(row.user_updated_at),
      },
      connection: {
        connection_id: row.connection_id,
        user_id: row.user_id,
        issuer,
        subject,
        created_at_utc: iso(row.connection_created_at),
        last_seen_at_utc: iso(row.last_seen_at),
      },
      created: row.created,
    };
  }

  find(issuer: string, subject: string) {
    return this.resolve(issuer, subject, false);
  }

  async register(issuer: string, subject: string) {
    const resolved = await this.resolve(issuer, subject, true);
    if (!resolved) throw new Error("Konto konnte nicht angelegt werden.");
    return resolved;
  }

  /** The tracker id of an account; stable for the account's lifetime. */
  async trackerId(userId: string): Promise<string | undefined> {
    const row = (
      await this.db.query<{ tracker_id: string }>(
        "select tracker_id from arnold.account($1)",
        [userId],
      )
    ).rows[0];
    return row?.tracker_id;
  }

  async byId(userId: string): Promise<ArnoldUser | undefined> {
    const row = (
      await this.db.query<{
        user_id: string;
        status: UserStatus;
        created_at: Date;
        updated_at: Date;
      }>(
        "select user_id, status, created_at, updated_at from arnold.account($1)",
        [userId],
      )
    ).rows[0];
    return row
      ? {
          user_id: row.user_id,
          status: row.status,
          created_at_utc: iso(row.created_at),
          updated_at_utc: iso(row.updated_at),
        }
      : undefined;
  }

  /** Account status is managed in the database by an operator, not by the app. */
  async setStatus(_userId: string, _status: UserStatus): Promise<ArnoldUser> {
    throw new Error(
      "Der Kontostatus wird direkt in der Datenbank verwaltet (arnold.users.status).",
    );
  }

  async connectionsFor(userId: string): Promise<IdentityConnection[]> {
    return this.db.asUser(userId, async (client) =>
      (
        await client.query<{
          connection_id: string;
          user_id: string;
          issuer: string;
          subject: string;
          created_at: Date;
          last_seen_at: Date;
        }>(
          `select connection_id, user_id, issuer, subject, created_at, last_seen_at
             from arnold.identity_connections where user_id = $1`,
          [userId],
        )
      ).rows.map((row) => ({
        connection_id: row.connection_id,
        user_id: row.user_id,
        issuer: row.issuer,
        subject: row.subject,
        created_at_utc: iso(row.created_at),
        last_seen_at_utc: iso(row.last_seen_at),
      })),
    );
  }

  /** Deletes the account; every table of the user follows by cascade. */
  async remove(userId: string): Promise<boolean> {
    return this.db.asUser(userId, async (client) => {
      const result = await client.query(
        "delete from arnold.users where user_id = $1",
        [userId],
      );
      return result.rowCount === 1;
    });
  }
}
