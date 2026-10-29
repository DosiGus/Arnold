/**
 * Stored Google connections: the `google_connections` table of Task 007 §16.
 *
 * The record set is deliberately minimal, per §10's instruction not to keep
 * large token histories. What is here is what Arnold needs to act, to explain
 * the connection to its owner, and to diagnose a failure — nothing else. In
 * particular there is no access-token column: access tokens live for an hour,
 * so caching them in a durable store buys almost nothing and widens the blast
 * radius of a database leak considerably. They are held in memory for their
 * lifetime and re-minted from the refresh token afterwards.
 *
 * Reads are **always** scoped by `user_id`. There is no `findByCredentialId`
 * and no `findBySpreadsheetId`, because an id handed in from outside is not a
 * permission (§17) — an API shaped that way invites a caller to pass an
 * attacker-supplied id and get someone else's credential back. Every method
 * here takes the user id first and treats it as the authority.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SealedValue } from "./crypto.js";

export const GOOGLE_CONNECTION_STATUSES = [
  /** Usable: a refresh token is held and last use succeeded. */
  "CONNECTED",
  /**
   * Google will no longer refresh: the grant was withdrawn in the Google
   * account, the refresh token expired, or it was never issued. Arnold must
   * ask the user to reconnect and must not guess.
   */
  "REAUTH_REQUIRED",
  /** The user disconnected through Arnold. Retained only as a tombstone. */
  "DISCONNECTED",
] as const;

export type GoogleConnectionStatus =
  (typeof GOOGLE_CONNECTION_STATUSES)[number];

export interface GoogleConnection {
  credential_id: string;
  user_id: string;
  /**
   * The Google account's stable OIDC subject. The account key (§8) — never
   * the email address, which can change or be reassigned.
   */
  google_subject: string;
  /** Display only. Shown so the user can see which account is connected. */
  google_email: string | null;
  granted_scopes: string[];
  status: GoogleConnectionStatus;
  /** Absent when Google issued no refresh token, which is a real case. */
  refresh_token: SealedValue | null;
  connected_at_utc: string;
  last_success_at_utc: string | null;
  /** Last technical failure, for diagnosis. Never a token or a user message. */
  last_error_code: string | null;
  updated_at_utc: string;
}

/** What a caller may see. Never carries the sealed refresh token. */
export type GoogleConnectionView = Omit<GoogleConnection, "refresh_token"> & {
  has_refresh_token: boolean;
};

export function toView(connection: GoogleConnection): GoogleConnectionView {
  const { refresh_token, ...rest } = connection;
  return { ...rest, has_refresh_token: refresh_token !== null };
}

export interface UpsertGoogleConnection {
  userId: string;
  googleSubject: string;
  googleEmail: string | null;
  grantedScopes: string[];
  refreshToken: SealedValue | null;
}

export interface GoogleCredentialRepository {
  /** The user's active connection, or undefined. Scoped by user id. */
  findByUser(userId: string): Promise<GoogleConnection | undefined>;
  /**
   * Creates or replaces the user's connection.
   *
   * One active connection per Arnold user, which is what makes §23's
   * account-switch case detectable: reconnecting with a *different* Google
   * subject is a distinct event, and the caller is told so rather than having
   * the old connection silently overwritten.
   */
  upsert(
    input: UpsertGoogleConnection,
  ): Promise<{ connection: GoogleConnection; previousSubject: string | null }>;
  /** Records a successful Google call, for the status display. */
  markSuccess(userId: string): Promise<void>;
  /** Moves the connection out of CONNECTED and records why. */
  markStatus(
    userId: string,
    status: GoogleConnectionStatus,
    errorCode: string | null,
  ): Promise<void>;
  /**
   * Removes the stored credential.
   *
   * Deletes the row rather than blanking it: a disconnected connection has no
   * use for a retained ciphertext, and keeping one is exactly the "unnecessary
   * storage of sensitive data" §27 asks to avoid. The user's Google *file* is
   * untouched — disconnecting is not deleting (§10).
   */
  remove(userId: string): Promise<boolean>;
  /** Replaces the stored refresh token, e.g. after Google rotates it. */
  replaceRefreshToken(
    userId: string,
    refreshToken: SealedValue | null,
  ): Promise<void>;
}

interface CredentialState {
  google_connections: GoogleConnection[];
}

const nowIso = () => new Date().toISOString();

abstract class BaseCredentialRepository implements GoogleCredentialRepository {
  protected abstract read(): Promise<CredentialState>;
  protected abstract mutate<T>(
    change: (state: CredentialState) => T | Promise<T>,
  ): Promise<T>;

  async findByUser(userId: string): Promise<GoogleConnection | undefined> {
    const state = await this.read();
    return state.google_connections.find(
      (entry) => entry.user_id === userId && entry.status !== "DISCONNECTED",
    );
  }

  async upsert(
    input: UpsertGoogleConnection,
  ): Promise<{ connection: GoogleConnection; previousSubject: string | null }> {
    if (!input.userId) throw new Error("Google-Verbindung ohne Arnold-Nutzer.");
    if (!input.googleSubject)
      throw new Error("Google-Verbindung ohne stabiles Google-Subject.");
    return this.mutate((state) => {
      const timestamp = nowIso();
      const index = state.google_connections.findIndex(
        (entry) => entry.user_id === input.userId,
      );
      const previous = index >= 0 ? state.google_connections[index] : undefined;
      const previousSubject =
        previous && previous.status !== "DISCONNECTED"
          ? previous.google_subject
          : null;

      const connection: GoogleConnection = {
        credential_id: previous?.credential_id ?? `gcr_${randomUUID()}`,
        user_id: input.userId,
        google_subject: input.googleSubject,
        google_email: input.googleEmail,
        granted_scopes: [...input.grantedScopes],
        status: "CONNECTED",
        refresh_token: input.refreshToken,
        // A reconnection of the same account keeps its original date; a
        // different account is a new connection.
        connected_at_utc:
          previous && previous.google_subject === input.googleSubject
            ? previous.connected_at_utc
            : timestamp,
        last_success_at_utc: null,
        last_error_code: null,
        updated_at_utc: timestamp,
      };
      if (index >= 0) state.google_connections[index] = connection;
      else state.google_connections.push(connection);
      return { connection, previousSubject };
    });
  }

  async markSuccess(userId: string): Promise<void> {
    await this.mutate((state) => {
      const connection = state.google_connections.find(
        (entry) => entry.user_id === userId,
      );
      if (!connection) return;
      connection.last_success_at_utc = nowIso();
      connection.last_error_code = null;
      connection.updated_at_utc = connection.last_success_at_utc;
    });
  }

  async markStatus(
    userId: string,
    status: GoogleConnectionStatus,
    errorCode: string | null,
  ): Promise<void> {
    await this.mutate((state) => {
      const connection = state.google_connections.find(
        (entry) => entry.user_id === userId,
      );
      if (!connection) return;
      connection.status = status;
      connection.last_error_code = errorCode;
      connection.updated_at_utc = nowIso();
      // A connection Google will not refresh has no use for the stored
      // token, and keeping it invites a retry loop against a dead credential.
      if (status === "REAUTH_REQUIRED") connection.refresh_token = null;
    });
  }

  async remove(userId: string): Promise<boolean> {
    return this.mutate((state) => {
      const before = state.google_connections.length;
      state.google_connections = state.google_connections.filter(
        (entry) => entry.user_id !== userId,
      );
      return state.google_connections.length < before;
    });
  }

  async replaceRefreshToken(
    userId: string,
    refreshToken: SealedValue | null,
  ): Promise<void> {
    await this.mutate((state) => {
      const connection = state.google_connections.find(
        (entry) => entry.user_id === userId,
      );
      if (!connection) return;
      connection.refresh_token = refreshToken;
      connection.updated_at_utc = nowIso();
    });
  }
}

export class InMemoryGoogleCredentialRepository extends BaseCredentialRepository {
  private state: CredentialState = { google_connections: [] };
  private queue: Promise<unknown> = Promise.resolve();

  protected async read(): Promise<CredentialState> {
    return this.state;
  }

  protected mutate<T>(
    change: (state: CredentialState) => T | Promise<T>,
  ): Promise<T> {
    const result = this.queue.then(() => change(this.state));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Visible for tests. Includes sealed values so tests can assert on them. */
  snapshot(): GoogleConnection[] {
    return this.state.google_connections.map((entry) => ({ ...entry }));
  }
}

/**
 * A file-backed store for local development.
 *
 * Not for production, for the same reason as the identity store: an
 * in-process queue coordinates writes within one process and not between two.
 * The file is written `0600` and atomically replaced, because it contains
 * ciphertext that is worth protecting even in development.
 */
export class FileGoogleCredentialRepository extends BaseCredentialRepository {
  private cache: CredentialState | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {
    super();
  }

  protected async read(): Promise<CredentialState> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      const candidate = parsed as Partial<CredentialState>;
      if (!Array.isArray(candidate.google_connections))
        throw new Error(
          "Google-Verbindungsspeicher enthält keine gültige Verbindungstabelle.",
        );
      this.cache = {
        google_connections: Array.isArray(candidate.google_connections)
          ? candidate.google_connections
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.cache = { google_connections: [] };
    }
    return this.cache;
  }

  protected mutate<T>(
    change: (state: CredentialState) => T | Promise<T>,
  ): Promise<T> {
    const result = this.queue.then(async () => {
      const state = structuredClone(await this.read());
      const value = await change(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temp, this.path);
      this.cache = state;
      return value;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}
