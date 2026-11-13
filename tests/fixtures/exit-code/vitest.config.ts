import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Used only by tests/exit-code.test.ts: the real globalSetup (with its
// embedded-postgres import) around one test that fails on purpose.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export default defineConfig({
  root,
  test: {
    include: ["tests/fixtures/exit-code/red.fixture.ts"],
    globalSetup: ["tests/setup/postgres.ts"],
  },
});
