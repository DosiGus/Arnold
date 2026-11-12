import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Regression guard (CI-001): embedded-postgres registers an exit hook that
// calls process.exit(0) and used to hide failed tests behind exit code 0.
// This starts a separate Vitest run with the real globalSetup around a test
// that fails on purpose and requires a non-zero exit code.
it("a failing run with the real globalSetup exits non-zero", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST")) delete env[key];
  }
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "tests/fixtures/exit-code/vitest.config.ts",
    ],
    { cwd: root, env, encoding: "utf8", timeout: 90_000 },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  expect(output).toMatch(/Tests\s+1 failed/);
  expect(result.status).not.toBe(0);
  expect(result.status).not.toBeNull();
}, 120_000);
