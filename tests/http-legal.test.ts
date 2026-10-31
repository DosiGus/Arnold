/**
 * B12: static legal and support pages, and the release id on /health.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createHttpApp, releaseFrom } from "../src/server/http";

let http: Server;
let base: string;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "arnold-legal-"));
  await mkdir(join(root, "public/legal"), { recursive: true });
  await writeFile(
    join(root, "public/legal/datenschutz.html"),
    "<!doctype html><title>Datenschutz</title><p>Synthetischer Entwurf</p>",
  );
  await writeFile(
    join(root, "public/legal/support.html"),
    "<!doctype html><title>Support</title>",
  );
  await writeFile(join(root, "public/legal/geheim.txt"), "nicht ausliefern");
  http = createHttpApp({
    root,
    env: { ARNOLD_RELEASE: "abc1234" },
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
  await rm(root, { recursive: true, force: true });
});

describe("legal pages", () => {
  it("serves the privacy notice as static HTML without scripts", async () => {
    const response = await fetch(`${base}/datenschutz`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Synthetischer Entwurf");
    const csp = response.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src");
  });

  it("serves the support page", async () => {
    expect((await fetch(`${base}/support`)).status).toBe(200);
  });

  it("answers 404 when the file is missing", async () => {
    const response = await fetch(`${base}/bedingungen`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(root);
  });

  it("never serves other files from the folder", async () => {
    for (const path of [
      "/legal/geheim.txt",
      "/public/legal/geheim.txt",
      "/datenschutz/../geheim.txt",
      "/support.html",
    ])
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
  });
});

describe("release on /health", () => {
  it("reports ARNOLD_RELEASE", async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.release).toBe("abc1234");
  });

  it("is null when unset and refuses malformed values", () => {
    expect(releaseFrom({})).toBeNull();
    expect(releaseFrom({ ARNOLD_RELEASE: "v0.5.0-rc.1" })).toBe("v0.5.0-rc.1");
    for (const value of ["<script>", "a b", "x".repeat(65), "-start"])
      expect(() => releaseFrom({ ARNOLD_RELEASE: value })).toThrow(
        /ARNOLD_RELEASE/,
      );
  });
});
