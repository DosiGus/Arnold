/**
 * Arnold users and the external identities that map onto them.
 *
 * This is the first two tables of the Task 007 §16 data model — `users` and
 * `identity_connections` — behind an interface, with an in-memory and a
 * file-backed implementation. The PostgreSQL implementation belongs to 007-D;
 * what matters now is that the *shape* is the one a relational store can
 * honour, so that swapping the implementation is not a redesign.
 *
 * Two invariants carry the multi-user safety of Task 007 §17, and both are
 * enforced here rather than left to callers:
 *
 * **One Arnold user per external identity.** `(issuer, subject)` is unique.
 * Without that uniqueness, two concurrent first-time requests for the same
 * ChatGPT user could each create a user row, and the same person would own two
 * Arnold accounts — which later means two trackers, split history, and no
 * obvious way to merge them. `registerIdentity` is therefore idempotent under
 * concurrency: it returns the existing mapping rather than creating a second.
 *
 * **Identity is never the email address.** The key is the issuer's stable
 * subject identifier, per Task 007 §8. An email address is a display
 * attribute: it can be changed, reassigned by a workspace administrator, or
 * differ in case, and any of those would silently re-point an account.
 *
 * What is deliberately *not* here: anything about training. No workouts, no
 * plans, no sets. The internal database holds identity and technical state;
 * the user's own Google Sheet holds their training data (Task 007 §3). Keeping
 * that boundary visible in the type surface is what stops the backend from
 * quietly becoming a second, contradictory source of training truth.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

/**
 * A JSON-file store, for local development across restarts.
 *
 * Explicitly **not** a production store, and Task 007 §16 says why: a file
 * plus an in-process promise queue coordinates writes within one process and
 * not at all between two. It is here so that a developer restarting the server
 * does not lose their identity mapping, and it is rejected by the production
 * configuration guard in `config.ts`.
 */
export class FileIdentityRepository extends BaseIdentityRepository {
  private cache: IdentityState | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {
    super();
  }

  protected async read(): Promise<IdentityState> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      this.cache = normalizeState(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.cache = { users: [], identity_connections: [] };
    }
    return this.cache;
  }

  protected mutate<T>(
    change: (state: IdentityState) => T | Promise<T>,
  ): Promise<T> {
    const result = this.queue.then(async () => {
      const state = structuredClone(await this.read());
      const value = await change(state);
      await this.persist(state);
      this.cache = state;
      return value;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async persist(state: IdentityState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    // Atomic replace, so a crash mid-write cannot leave a truncated store.
    await rename(temp, this.path);
  }
}

function normalizeState(parsed: unknown): IdentityState {
  if (parsed === null || typeof parsed !== "object")
    throw new Error("Identitätsspeicher ist kein Objekt.");
  const candidate = parsed as Partial<IdentityState>;
  if (
    !Array.isArray(candidate.users) ||
    !Array.isArray(candidate.identity_connections)
  )
    throw new Error("Identitätsspeicher enthält keine gültigen Kontotabellen.");
  return {
    users: Array.isArray(candidate.users) ? candidate.users : [],
    identity_connections: Array.isArray(candidate.identity_connections)
      ? candidate.identity_connections
      : [],
  };
}
