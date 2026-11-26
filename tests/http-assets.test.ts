import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpApp } from "../src/server/http";
import { createFixtureLogging } from "../src/server/workout/fixture";
it("serves only fixed public HTML assets from hidden worktree paths, never arbitrary hidden files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arnold-assets-")),
    root = join(directory, ".hidden-worktree");
  await mkdir(join(root, "dist/views/host"), { recursive: true });
  await writeFile(
    join(root, "dist/views/host/host.html"),
    "<h1>Synthetic host</h1>",
  );
  await writeFile(join(root, ".env"), "SYNTHETIC_PRIVATE_VALUE=not-public");
  const server = createHttpApp({
    root,
    workoutRuntime: createFixtureLogging(),
  }).listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    // "/preview" (and "/") lead to the test host and keep the query.
    const preview = await fetch(`${base}/preview?onboarding=1`, {
      redirect: "manual",
    });
    expect(preview.headers.get("location")).toBe("/host?onboarding=1");
    expect(await (await fetch(`${base}/host`)).text()).toContain(
      "Synthetic host",
    );
    expect((await fetch(`${base}/.env`)).status).toBe(404);
    expect((await fetch(`${base}/dist/views/host/host.html`)).status).toBe(404);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
