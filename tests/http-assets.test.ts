import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpApp } from "../src/server/http";
import { createFixtureLogging } from "../src/server/workout/fixture";
it("serves only fixed public HTML assets from hidden worktree paths, never arbitrary hidden files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arnold-assets-")),
    root = join(directory, ".hidden-worktree");
  await mkdir(join(root, "dist/ui"), { recursive: true });
  await mkdir(join(root, "dist/host"), { recursive: true });
  await writeFile(
    join(root, "dist/ui/dashboard.html"),
    "<h1>Synthetic dashboard</h1>",
  );
  await writeFile(join(root, "dist/host/host.html"), "<h1>Synthetic host</h1>");
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
    expect(await (await fetch(`${base}/preview`)).text()).toContain(
      "Synthetic dashboard",
    );
    expect(await (await fetch(`${base}/host`)).text()).toContain(
      "Synthetic host",
    );
    expect((await fetch(`${base}/.env`)).status).toBe(404);
    expect((await fetch(`${base}/dist/ui/dashboard.html`)).status).toBe(404);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
