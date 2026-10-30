/**
 * Arnold behind a TLS-terminating proxy (Cloud Run).
 *
 * The browser sends `Origin: https://<host>`, but the request reaches Node as
 * plain HTTP. Only with `TRUST_PROXY` set does the same-origin check read the
 * forwarded protocol; without it the forwarded header must be ignored.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createHttpApp, parseTrustProxy } from "../src/server/http";

let http: Server | undefined;

async function start(env: NodeJS.ProcessEnv) {
  http = createHttpApp({ env }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http!.once("listening", resolve);
    http!.once("error", reject);
  });
  return `127.0.0.1:${(http.address() as { port: number }).port}`;
}

async function preflight(host: string) {
  return fetch(`http://${host}/mcp`, {
    method: "OPTIONS",
    headers: { Origin: `https://${host}`, "X-Forwarded-Proto": "https" },
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!http) return resolve();
    http.close(() => resolve());
    http.closeAllConnections();
  });
  http = undefined;
});

describe("TRUST_PROXY", () => {
  it("accepts the server's own https origin behind one proxy", async () => {
    const host = await start({ TRUST_PROXY: "1" });
    expect((await preflight(host)).status).toBe(204);
  });

  it("ignores forwarded headers when not configured", async () => {
    const host = await start({});
    expect((await preflight(host)).status).toBe(403);
  });

  it("still rejects foreign origins behind a proxy", async () => {
    const host = await start({ TRUST_PROXY: "1" });
    const response = await fetch(`http://${host}/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(response.status).toBe(403);
  });

  it.each(["yes", "-1", "1.5", "true", "11"])(
    "refuses TRUST_PROXY=%s at startup",
    (value) => {
      expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY/);
      expect(() => createHttpApp({ env: { TRUST_PROXY: value } })).toThrow(
        /TRUST_PROXY/,
      );
    },
  );

  it("treats unset and empty as off", () => {
    expect(parseTrustProxy(undefined)).toBe(0);
    expect(parseTrustProxy("")).toBe(0);
    expect(parseTrustProxy("1")).toBe(1);
  });
});
