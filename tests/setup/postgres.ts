/**
 * Starts a real Postgres for the test run (embedded binaries, no Docker),
 * applies the migrations as the owner and sets a password for the server
 * role. Tests reach it through `inject("databaseUrl")` (server role) and
 * `inject("databaseAdminUrl")` (owner, for inspection only).
 */
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { migrate, setAppPassword } from "../../src/server/db/migrate";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    databaseAdminUrl: string;
  }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

/**
 * `embedded-postgres` registers an `async-exit-hook` on import. On
 * `beforeExit` that hook calls `process.exit(0)`, which overwrites the exit
 * code Vitest set for failed tests, so a red run would end with exit 0 and
 * `npm test` / CI would report green. Remember the code seen at `beforeExit`
 * (our listener runs in the same emit, before the hook's `process.exit` tick)
 * and restore it in `exit`, where setting `process.exitCode` still counts.
 */
let preservedExitCode: number | undefined;
let exitCodeGuardInstalled = false;
function preserveFailureExitCode() {
  if (exitCodeGuardInstalled) return;
  exitCodeGuardInstalled = true;
  process.on("beforeExit", () => {
    const code = process.exitCode;
    if (code !== undefined && Number(code) !== 0)
      preservedExitCode = Number(code);
  });
  process.on("exit", () => {
    if (preservedExitCode !== undefined) process.exitCode = preservedExitCode;
  });
}

export default async function setup(project: TestProject) {
  preserveFailureExitCode();
  const directory = await mkdtemp(join(tmpdir(), "arnold-pg-"));
  const port = await freePort();
  const password = randomBytes(18).toString("hex");
  const postgres = new EmbeddedPostgres({
    databaseDir: join(directory, "data"),
    user: "postgres",
    password,
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  const admin = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  await migrate(admin);
  const appPassword = randomBytes(24).toString("hex");
  await setAppPassword(admin, appPassword);
  project.provide("databaseAdminUrl", admin);
  project.provide(
    "databaseUrl",
    `postgres://arnold_app:${appPassword}@127.0.0.1:${port}/postgres`,
  );
  return async () => {
    await postgres.stop();
    await rm(directory, { recursive: true, force: true });
  };
}
