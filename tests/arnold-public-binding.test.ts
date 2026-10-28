/**
 * Which deployments may listen beyond loopback.
 *
 * This is the boundary that decides whether somebody's training file can be
 * reached from the internet, so it is tested as a matrix rather than by
 * example: real data without authentication must be refused on a public
 * address, and everything else must be allowed — including a synthetic
 * deployment, which is the whole point of a tunnel or a hosted test instance.
 *
 * A regression here is not a failing feature, it is an exposed Google file.
 */
import { describe, expect, it } from "vitest";
import {
  isPublicBinding,
  requireLoopbackOnly,
  requireSafeArnoldBinding,
} from "../src/server/storage-config";
import { createHttpApp } from "../src/server/http";
import { StaticArnoldDataSource } from "../src/server/arnold-source";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { fullDataset } from "./fixtures/arnold-dashboard";
import type { ArnoldDataSource } from "../src/server/arnold-source";
import type { AuthSurface } from "../src/server/auth/router";

const LOOPBACK = {
  host: "127.0.0.1",
  allowedHosts: ["127.0.0.1"],
  allowedOrigins: [],
};
const PUBLIC = {
  host: "0.0.0.0",
  allowedHosts: ["arnold.example.com"],
  allowedOrigins: [],
};

/** A source that reads a real Google file, as far as the guard is concerned. */
function realSource(): ArnoldDataSource {
  const source = new StaticArnoldDataSource(fullDataset(), {
    label: "Arnold · echte Datei",
  });
  // Only the flag matters to the guard; the data stays synthetic so no test
  // ever touches a real file.
  return Object.defineProperty(source, "synthetic", { value: false });
}

/** Minimal auth surface, so a test can state the mode without the env. */
function authSurface(mode: "open" | "oidc"): AuthSurface {
  return {
    summary: { mode },
    bearerGate: (_req: unknown, _res: unknown, next: () => void) => next(),
    guard: undefined,
    metadataRouter: undefined,
  } as unknown as AuthSurface;
}

describe("recognising a public binding", () => {
  it("accepts every loopback spelling as private", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"])
      expect(isPublicBinding(host, [host], [])).toBe(false);
  });

  it("sees a non-loopback bind host", () => {
    expect(isPublicBinding("0.0.0.0", ["127.0.0.1"], [])).toBe(true);
  });

  it("sees a public name in allowedHosts, even on a loopback bind", () => {
    // A tunnel reaches a loopback-bound server: the allowed host is what makes
    // it publicly addressable, so it counts.
    expect(
      isPublicBinding("127.0.0.1", ["127.0.0.1", "abc.trycloudflare.com"], []),
    ).toBe(true);
  });

  it("sees a public allowed origin", () => {
    expect(
      isPublicBinding("127.0.0.1", ["127.0.0.1"], ["https://chat.openai.com"]),
    ).toBe(true);
  });
});

describe("the binding rule for Arnold sources", () => {
  it("allows a real file on loopback without authentication", () => {
    expect(() =>
      requireSafeArnoldBinding({
        synthetic: false,
        authenticated: false,
        ...LOOPBACK,
      }),
    ).not.toThrow();
  });

  it("REFUSES a real file on a public address without authentication", () => {
    expect(() =>
      requireSafeArnoldBinding({
        synthetic: false,
        authenticated: false,
        ...PUBLIC,
      }),
    ).toThrow(/öffentliche Adresse|Authentifizierung/);
  });

  it("allows a real file on a public address once authentication is active", () => {
    expect(() =>
      requireSafeArnoldBinding({
        synthetic: false,
        authenticated: true,
        ...PUBLIC,
      }),
    ).not.toThrow();
  });

  it("allows a synthetic deployment on a public address", () => {
    // The case the old blanket rule blocked for no safety gain: an in-memory
    // dataset has nothing to leak, and this is what a tunnel test needs.
    expect(() =>
      requireSafeArnoldBinding({
        synthetic: true,
        authenticated: false,
        ...PUBLIC,
      }),
    ).not.toThrow();
  });

  it("refuses a real file behind a tunnel hostname too", () => {
    expect(() =>
      requireSafeArnoldBinding({
        synthetic: false,
        authenticated: false,
        host: "127.0.0.1",
        allowedHosts: ["127.0.0.1", "abc.trycloudflare.com"],
        allowedOrigins: [],
      }),
    ).toThrow();
  });

  it("names the three ways out in its refusal", () => {
    try {
      requireSafeArnoldBinding({
        synthetic: false,
        authenticated: false,
        ...PUBLIC,
      });
      throw new Error("should have refused");
    } catch (error) {
      const message = (error as Error).message;
      // A refusal that does not say what to do instead gets worked around.
      expect(message).toMatch(/Loopback|Tunnel/);
      expect(message).toMatch(/AUTH_MODE=oidc/);
      expect(message).toMatch(/arnold_fixture/);
    }
  });
});

describe("the legacy Sheets rule is unchanged", () => {
  it("still refuses any public binding", () => {
    expect(() =>
      requireLoopbackOnly(
        PUBLIC.host,
        PUBLIC.allowedHosts,
        PUBLIC.allowedOrigins,
      ),
    ).toThrow(/Loopback/);
  });

  it("still allows loopback", () => {
    expect(() =>
      requireLoopbackOnly(
        LOOPBACK.host,
        LOOPBACK.allowedHosts,
        LOOPBACK.allowedOrigins,
      ),
    ).not.toThrow();
  });
});

describe("createHttpApp applies the rule", () => {
  it("starts a synthetic deployment on a public host", () => {
    // What a tunnel or a hosted test instance actually does.
    expect(() =>
      createHttpApp({
        workoutRuntime: createFixtureOnboarding(),
        host: "0.0.0.0",
        allowedHosts: ["arnold.example.com", "127.0.0.1"],
        allowedOrigins: [],
        auth: authSurface("open"),
      }),
    ).not.toThrow();
  });

  it("refuses a real-data deployment on a public host without authentication", () => {
    expect(() =>
      createHttpApp({
        arnoldSource: realSource(),
        host: "0.0.0.0",
        allowedHosts: ["arnold.example.com"],
        allowedOrigins: [],
        auth: authSurface("open"),
      }),
    ).toThrow(/öffentliche Adresse|Authentifizierung/);
  });

  it("allows a real-data deployment on a public host with authentication", () => {
    expect(() =>
      createHttpApp({
        arnoldSource: realSource(),
        host: "0.0.0.0",
        allowedHosts: ["arnold.example.com"],
        allowedOrigins: [],
        auth: authSurface("oidc"),
      }),
    ).not.toThrow();
  });

  it("still allows a real-data deployment on loopback", () => {
    expect(() =>
      createHttpApp({
        arnoldSource: realSource(),
        host: "127.0.0.1",
        allowedHosts: ["127.0.0.1", "localhost"],
        allowedOrigins: [],
        auth: authSurface("open"),
      }),
    ).not.toThrow();
  });
});
