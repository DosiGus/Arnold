/**
 * The connection to Arnold's Postgres database (Supabase in production).
 *
 * The one rule this module exists for: every query that touches user data
 * runs inside `asUser`, which opens a transaction and sets
 * `arnold.user_id` for exactly that transaction. The row level security
 * policies in db/migrations only let rows of that user through, so even a
 * query that forgot its own `where user_id = …` cannot see anybody else.
 *
 * The user id always comes from the verified login (`AuthenticatedArnoldContext`),
 * never from a tool argument.
 */
import pg from "pg";

/** The schema version this build expects. Bump together with a migration. */
export const EXPECTED_SCHEMA_VERSION = 4;

export type Queryable = Pick<pg.PoolClient, "query">;

export interface DatabaseOptions {
  /** Postgres connection string of the `arnold_app` role. */
  url: string;
  /** Connections per server instance. */
  maxConnections?: number;
  /**
   * PEM certificate of the database's CA (Supabase: Database settings → SSL
   * certificate). Without it the system's trusted CAs are used.
   */
  caCert?: string;
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

/**
 * Connection settings from a URL. Query parameters such as `sslmode` are
 * ignored on purpose: encryption is decided here, not by the URL, so a
 * connection string cannot switch certificate checks off. A remote database
 * is always reached over TLS with a verified certificate; only a database on
 * this machine (tests, local development) is reached without TLS.
 */
export function connectionConfig(
  url: string,
  caCert?: string,
): pg.ClientConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Die Datenbankadresse ist keine gültige URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:")
    throw new Error("Die Datenbankadresse muss mit postgres:// beginnen.");
  const local = LOCAL_HOSTS.includes(parsed.hostname);
  return {
    host: parsed.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)) || "postgres",
    ssl: local
      ? false
      : { rejectUnauthorized: true, ...(caCert ? { ca: caCert } : {}) },
  };
}

/** A user id as the database accepts it; anything else is refused early. */
const USER_ID =
  /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class Database {
  readonly pool: pg.Pool;
  private healthValue?: { ok: boolean; checkedAt: number };
  private healthCheck?: Promise<boolean>;

  constructor(options: DatabaseOptions) {
    this.pool = new pg.Pool({
      ...connectionConfig(options.url, options.caCert),
      max: options.maxConnections ?? 10,
      // A request must not hang on a dead database; it fails and the caller
      // retries with the same request_id.
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      // Cuts a statement that hangs, so a lock is never held forever.
      statement_timeout: 15_000,
      application_name: "arnold",
    });
    // An idle connection that breaks must not crash the process.
    this.pool.on("error", () => {});
  }

  /** Readiness only: no user context, one in-flight query, at most 10 s cache.
   * The 2 s deadline includes waiting for a pool connection. A timed-out query
   * keeps the single-flight slot until it settles, so repeated health checks
   * cannot accumulate queries behind a stalled connection. */
  ping(): Promise<boolean> {
    if (this.healthValue && Date.now() - this.healthValue.checkedAt < 10_000)
      return Promise.resolve(this.healthValue.ok);
    if (this.healthCheck) return this.healthCheck;
    // pg supports a per-query client timeout; its installed typings expose
    // only the shared QueryConfig fields. Structural assignment keeps both.
    const query = { text: "select 1", query_timeout: 2_000 };
    const operation = this.pool.query(query);
    this.healthCheck = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        this.healthValue = { ok, checkedAt: Date.now() };
        resolve(ok);
      };
      const deadline = setTimeout(() => finish(false), 2_000);
      operation.then(
        () => finish(true),
        () => finish(false),
      );
    });
    void operation
      .finally(() => {
        this.healthCheck = undefined;
      })
      .catch(() => {});
    return this.healthCheck;
  }

  /** One statement outside any user context (account lookup functions). */
  async query<R extends pg.QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, values as unknown[]);
  }

  /**
   * Runs `work` in one transaction as the given user. Commits when `work`
   * resolves, rolls back when it throws.
   */
  async asUser<T>(
    userId: string,
    work: (client: Queryable) => Promise<T>,
  ): Promise<T> {
    if (!USER_ID.test(userId))
      throw new Error("Ungültige Nutzerkennung für den Datenbankzugriff.");
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query("begin");
      await client.query("select set_config('arnold.user_id', $1, true)", [
        userId,
      ]);
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch (rollbackError) {
        broken = rollbackError as Error;
      }
      throw error;
    } finally {
      // A connection that could not roll back is discarded, never reused.
      client.release(broken);
    }
  }

  /**
   * Refuses to serve when the database is not at the schema this build was
   * written for, or when the server role could bypass row level security.
   */
  async assertReady(): Promise<void> {
    const version = await this.query<{ version: number | null }>(
      "select max(version)::int as version from arnold.schema_migrations",
    );
    const current = version.rows[0]?.version ?? 0;
    if (current !== EXPECTED_SCHEMA_VERSION)
      throw new Error(
        `Datenbankschema ist Version ${current}, erwartet ${EXPECTED_SCHEMA_VERSION}. Zuerst npm run db:migrate ausführen.`,
      );
    const role = await this.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    const owned = await this.query<{ owns: boolean }>(
      "select exists (select 1 from pg_tables where schemaname = 'arnold' and tableowner = current_user) as owns",
    );
    const flags = role.rows[0];
    // The table owner bypasses row level security as well.
    if (!flags || flags.rolsuper || flags.rolbypassrls || owned.rows[0]?.owns)
      throw new Error(
        "Arnold darf sich nicht als Superuser, mit BYPASSRLS oder als Tabelleneigentümer verbinden. DATABASE_URL muss die Rolle arnold_app verwenden.",
      );
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
