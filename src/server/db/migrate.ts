/**
 * Applies the SQL files in db/migrations in order, each exactly once.
 *
 * Runs with the owner connection (DATABASE_ADMIN_URL, on Supabase the
 * `postgres` role), never with the server's own role. Each file runs in its
 * own transaction under an advisory lock, so two runs at once cannot apply a
 * migration twice.
 *
 *   npm run db:migrate            (reads DATABASE_ADMIN_URL)
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { connectionConfig } from "./database.js";

const NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

export function migrationsDirectory(root = process.cwd()) {
  return resolve(root, "db/migrations");
}

export async function migrate(
  adminUrl: string,
  directory = migrationsDirectory(),
): Promise<number[]> {
  const files = (await readdir(directory)).filter((f) => NAME.test(f)).sort();
  const client = new pg.Client(
    connectionConfig(adminUrl, process.env.DATABASE_CA_CERT),
  );
  await client.connect();
  const applied: number[] = [];
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext('arnold.migrate'))",
    );
    await client.query("create schema if not exists arnold");
    await client.query(
      "create table if not exists arnold.schema_migrations (version integer primary key, name text not null, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (
        await client.query<{ version: number }>(
          "select version from arnold.schema_migrations",
        )
      ).rows.map((row) => row.version),
    );
    for (const file of files) {
      const version = Number(NAME.exec(file)![1]);
      if (done.has(version)) continue;
      await client.query(await readFile(resolve(directory, file), "utf8"));
      await client.query(
        "insert into arnold.schema_migrations (version, name) values ($1, $2)",
        [version, file],
      );
      applied.push(version);
    }
    // The server checks the version at start, so it may read this table.
    await client.query(
      "grant select on arnold.schema_migrations to arnold_app",
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  return applied;
}

/** Sets the password of the server role. Never logged. */
export async function setAppPassword(adminUrl: string, password: string) {
  if (password.length < 32)
    throw new Error(
      "Das Passwort für arnold_app muss mindestens 32 Zeichen haben.",
    );
  const client = new pg.Client(
    connectionConfig(adminUrl, process.env.DATABASE_CA_CERT),
  );
  await client.connect();
  try {
    const quoted = (
      await client.query<{ q: string }>("select quote_literal($1) as q", [
        password,
      ])
    ).rows[0].q;
    await client.query(`alter role arnold_app with login password ${quoted}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error("DATABASE_ADMIN_URL fehlt.");
    process.exit(1);
  }
  const applied = await migrate(url);
  console.log(
    applied.length
      ? `Migrationen angewendet: ${applied.join(", ")}`
      : "Datenbank ist aktuell.",
  );
}
