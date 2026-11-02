/**
 * Arnold users and the login identities that map onto them.
 *
 * `users` and `identity_connections` behind an interface, with an in-memory
 * implementation (fixture profile, tests) and a Postgres one
 * (src/server/db/identity.ts).
 *
 * Two invariants carry the multi-user safety, and both implementations
 * enforce them rather than leaving them to callers:
 *
 * **One Arnold user per login identity.** `(issuer, subject)` is unique.
 * Without that, two concurrent first requests for the same person could each
 * create a user, and that person would own two Arnold accounts with split
 * history. `register` is therefore idempotent under concurrency.
 *
 * **Identity is never the email address.** The key is the issuer's stable
 * subject identifier. An email address can be changed or reassigned, and
 * either would silently re-point an account.
 */
import { randomUUID } from "node:crypto";

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface ArnoldUser {
  user_id: string;
  status: UserStatus;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface IdentityConnection {
  connection_id: string;
  user_id: string;
  /** The `iss` of the token that proved this identity. */
  issuer: string;
  /** The issuer's stable subject identifier. Never an email address. */
  subject: string;
  created_at_utc: string;
  last_seen_at_utc: string;
}

export interface IdentityState {
  users: ArnoldUser[];
  identity_connections: IdentityConnection[];
}

export interface ResolvedIdentity {
  user: ArnoldUser;
  connection: IdentityConnection;
  /** True when this call created the user row. Drives the audit event. */
  created: boolean;
}

export interface IdentityRepository {
  /** The mapping for a verified identity, or undefined if none exists yet. */
  find(issuer: string, subject: string): Promise<ResolvedIdentity | undefined>;
  /**
   * The mapping for a verified identity, creating the user on first sight.
   *
   * Idempotent: concurrent calls for the same `(issuer, subject)` resolve to
   * one user. Also refreshes `last_seen_at_utc`.
   */
  register(issuer: string, subject: string): Promise<ResolvedIdentity>;
  byId(userId: string): Promise<ArnoldUser | undefined>;
  setStatus(userId: string, status: UserStatus): Promise<ArnoldUser>;
  /** Every identity connected to one user. For the account-info endpoint. */
  connectionsFor(userId: string): Promise<IdentityConnection[]>;
  /**
   * Deletes the user and every identity connected to it (account deletion).
   * A later login with the same identity creates a new, empty user.
   */
  remove(userId: string): Promise<boolean>;
}

const nowIso = () => new Date().toISOString();

/**
 * Shared logic for both implementations.
 *
 * `mutate` is the subclass's unit of atomicity: the base class never holds
 * state across an await, so the only way two writes can interleave is if a
 * subclass lets them. Both subclasses serialize.
 */
abstract class BaseIdentityRepository implements IdentityRepository {
  protected abstract mutate<T>(
    change: (state: IdentityState) => T | Promise<T>,
  ): Promise<T>;
  protected abstract read(): Promise<IdentityState>;

  async find(
    issuer: string,
    subject: string,
  ): Promise<ResolvedIdentity | undefined> {
    const state = await this.read();
    return this.match(state, issuer, subject);
  }

  private match(
    state: IdentityState,
    issuer: string,
    subject: string,
  ): ResolvedIdentity | undefined {
    const connection = state.identity_connections.find(
      (entry) => entry.issuer === issuer && entry.subject === subject,
    );
    if (!connection) return undefined;
    const user = state.users.find(
      (entry) => entry.user_id === connection.user_id,
    );
    // A connection without its user is a corrupt store, not a missing user.
    // Surfacing it as "no identity" would silently mint a duplicate account.
    if (!user)
      throw new Error(
        `identity_connections verweist auf unbekannten user_id ${connection.user_id}.`,
      );
    return { user, connection, created: false };
  }

  async register(issuer: string, subject: string): Promise<ResolvedIdentity> {
    if (issuer.length === 0 || subject.length === 0)
      throw new Error("Identität benötigt issuer und subject.");
    return this.mutate((state) => {
      const existing = this.match(state, issuer, subject);
      if (existing) {
        existing.connection.last_seen_at_utc = nowIso();
        return { ...existing, created: false };
      }
      const timestamp = nowIso();
      const user: ArnoldUser = {
        user_id: `usr_${randomUUID()}`,
        status: "ACTIVE",
        created_at_utc: timestamp,
        updated_at_utc: timestamp,
      };
      const connection: IdentityConnection = {
        connection_id: `idc_${randomUUID()}`,
        user_id: user.user_id,
        issuer,
        subject,
        created_at_utc: timestamp,
        last_seen_at_utc: timestamp,
      };
      state.users.push(user);
      state.identity_connections.push(connection);
      return { user, connection, created: true };
    });
  }

  async byId(userId: string): Promise<ArnoldUser | undefined> {
    const state = await this.read();
    return state.users.find((entry) => entry.user_id === userId);
  }

  async setStatus(userId: string, status: UserStatus): Promise<ArnoldUser> {
    return this.mutate((state) => {
      const user = state.users.find((entry) => entry.user_id === userId);
      if (!user) throw new Error(`Unbekannter Arnold-Nutzer ${userId}.`);
      user.status = status;
      user.updated_at_utc = nowIso();
      return { ...user };
    });
  }

  async connectionsFor(userId: string): Promise<IdentityConnection[]> {
    const state = await this.read();
    return state.identity_connections
      .filter((entry) => entry.user_id === userId)
      .map((entry) => ({ ...entry }));
  }

  async remove(userId: string): Promise<boolean> {
    return this.mutate((state) => {
      const before = state.users.length;
      state.users = state.users.filter((entry) => entry.user_id !== userId);
      state.identity_connections = state.identity_connections.filter(
        (entry) => entry.user_id !== userId,
      );
      return state.users.length < before;
    });
  }
}

/** For tests and for a single-process development server. */
export class InMemoryIdentityRepository extends BaseIdentityRepository {
  private state: IdentityState = { users: [], identity_connections: [] };
  private queue: Promise<unknown> = Promise.resolve();

  protected async read(): Promise<IdentityState> {
    return this.state;
  }

  protected mutate<T>(
    change: (state: IdentityState) => T | Promise<T>,
  ): Promise<T> {
    const result = this.queue.then(() => change(this.state));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Visible for tests: the raw rows, copied. */
  snapshot(): IdentityState {
    return {
      users: this.state.users.map((user) => ({ ...user })),
      identity_connections: this.state.identity_connections.map((entry) => ({
        ...entry,
      })),
    };
  }
}
