/** A new UI bundle gets a new resource URI; the same bundle keeps its URI. */
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/server/http";
import { buildAuthSurface } from "../src/server/auth/router";
import { loadAuthConfig } from "../src/server/auth/config";
import { uiDomain } from "../src/server/ui-resource";
import {
  bundleTag,
  dashboardResourceUri,
  onboardingResourceUri,
} from "../src/server/ui-resource";

describe("UI resource URIs", () => {
  it("follow the bundle's content", () => {
    const dir = mkdtempSync(join(tmpdir(), "arnold-ui-"));
    const file = join(dir, "dashboard.html");
    writeFileSync(file, "<div id=root>eins</div>");
    const first = dashboardResourceUri(file);
    expect(first).toMatch(/^ui:\/\/arnold\/dashboard-v2-[0-9a-f]{12}\.html$/);
    expect(dashboardResourceUri(file)).toBe(first);
    writeFileSync(file, "<div id=root>zwei</div>");
    // A later write with a new timestamp is noticed.
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(dashboardResourceUri(file)).not.toBe(first);
    expect(onboardingResourceUri(file)).toMatch(
      /^ui:\/\/arnold\/onboarding-v2-[0-9a-f]{12}\.html$/,
    );
  });

  it("stays usable without a bundle", () => {
    expect(bundleTag(undefined)).toBe("dev");
    expect(bundleTag("/does/not/exist.html")).toBe("dev");
  });
});

type UiMeta = { ui?: Record<string, unknown> };

async function cardMeta(env: Record<string, string>, withAuth = false) {
  const root = mkdtempSync(join(tmpdir(), "arnold-root-"));
  mkdirSync(join(root, "dist/ui"), { recursive: true });
  writeFileSync(join(root, "dist/ui/dashboard.html"), "<html>stub</html>");
  const http = createHttpApp({
    env,
    root,
    ...(withAuth
      ? { auth: buildAuthSurface({ config: loadAuthConfig(env) }) }
      : {}),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const port = (http.address() as { port: number }).port;
  const client = new Client({ name: "ui-domain", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
      ),
    );
    const listed = (await client.listResources()).resources.filter((r) =>
      r.uri.startsWith("ui://arnold/"),
    );
    const read = await client.readResource({
      uri: listed.find((r) => r.uri.includes("dashboard-v2-"))!.uri,
    });
    return {
      listed: listed.map((r) => (r._meta as UiMeta | undefined)?.ui),
      read: (read.contents[0]!._meta as UiMeta | undefined)?.ui,
    };
  } finally {
    await client.close();
    await new Promise<void>((resolve) => {
      http.close(() => resolve());
      http.closeAllConnections();
    });
  }
}

describe("_meta.ui.domain of the card resources", () => {
  it("is the origin of the configured public address", async () => {
    const meta = await cardMeta({
      ARNOLD_ENV: "development",
      ARNOLD_PUBLIC_BASE_URL: "https://example.test/ignored/path",
    });
    expect(meta.listed.length).toBeGreaterThan(0);
    for (const ui of [...meta.listed, meta.read]) {
      expect(ui?.domain).toBe("https://example.test");
      expect(ui?.csp).toEqual({ connectDomains: [], resourceDomains: [] });
      expect(ui?.prefersBorder).toBe(false);
    }
  });

  it("is set also when the caller passes its own auth (as bootstrap does)", async () => {
    const env = {
      ARNOLD_ENV: "development",
      ARNOLD_PUBLIC_BASE_URL: "https://example.test",
    };
    const meta = await cardMeta(env, true);
    for (const ui of [...meta.listed, meta.read])
      expect(ui?.domain).toBe("https://example.test");
    const none = await cardMeta({}, true);
    for (const ui of [...none.listed, none.read])
      expect(ui).not.toHaveProperty("domain");
  });

  it("is left out in development without a configured address", async () => {
    const meta = await cardMeta({});
    for (const ui of [...meta.listed, meta.read]) {
      expect(ui).toBeDefined();
      expect(ui).not.toHaveProperty("domain");
      expect(ui?.csp).toEqual({ connectDomains: [], resourceDomains: [] });
    }
  });

  it("reduces an address to its origin", () => {
    expect(uiDomain("https://a.example/x?y=1")).toBe("https://a.example");
    expect(uiDomain(undefined)).toBeUndefined();
  });
});
