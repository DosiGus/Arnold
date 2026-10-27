/**
 * Configuration must fail closed: Task 007 §25.
 *
 * Almost every test here asserts a *refusal*, because the dangerous outcome
 * of a configuration bug is never a crash — it is a server that starts
 * happily with authentication switched off. The one combination this file
 * cares most about is the half-configuration: `AUTH_MODE` left open while
 * `AUTH_ISSUER` sits in the environment, which looks like a secured
 * deployment at a glance and is not one.
 */
import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  describeAuthConfig,
  loadAuthConfig,
} from "../src/server/auth/config.js";

const base = {
  ARNOLD_PUBLIC_BASE_URL: "https://arnold.example.com",
  AUTH_ISSUER: "https://auth.example.com/",
  AUTH_JWKS_URI: "https://auth.example.com/.well-known/jwks.json",
} as const;

const load = (env: Record<string, string | undefined>) =>
  loadAuthConfig(env as NodeJS.ProcessEnv);

describe("development defaults", () => {
  it("runs open with an in-memory store and needs no configuration", () => {
    const config = load({});
    expect(config.environment).toBe("development");
    expect(config.mode).toBe("open");
    expect(config.identityStore.kind).toBe("memory");
    expect(config.oidc).toBeUndefined();
    expect(config.resourceUrl.toString()).toBe("http://127.0.0.1:8787/mcp");
  });

  it("derives the resource identifier from the public base URL", () => {
    const config = load({
      ARNOLD_PUBLIC_BASE_URL: "https://arnold.example.com",
      AUTH_MODE: "open",
    });
    expect(config.resourceUrl.toString()).toBe(
      "https://arnold.example.com/mcp",
    );
  });

  it("accepts an explicit resource identifier", () => {
    const config = load({
      ARNOLD_PUBLIC_BASE_URL: "https://arnold.example.com",
      ARNOLD_MCP_RESOURCE_URL: "https://arnold.example.com/v2/mcp",
      AUTH_MODE: "open",
    });
    expect(config.resourceUrl.toString()).toBe(
      "https://arnold.example.com/v2/mcp",
    );
  });

  it("allows oidc in development against a loopback issuer", () => {
    const config = load({
      AUTH_MODE: "oidc",
      ARNOLD_PUBLIC_BASE_URL: "http://127.0.0.1:8787",
      AUTH_ISSUER: "http://localhost:9000/",
      AUTH_JWKS_URI: "http://localhost:9000/jwks",
    });
    expect(config.oidc?.issuer).toBe("http://localhost:9000/");
  });
});

describe("open mode is confined to development", () => {
  it("is refused in staging", () => {
    expect(() =>
      load({ ARNOLD_ENV: "staging", AUTH_MODE: "open", ...base }),
    ).toThrow(ConfigurationError);
  });

  it("is refused in production", () => {
    expect(() =>
      load({ ARNOLD_ENV: "production", AUTH_MODE: "open", ...base }),
    ).toThrow(/nur in ARNOLD_ENV=development/);
  });

  it("is not the default outside development", () => {
    // Staging must authenticate, so omitting AUTH_MODE there means oidc and
    // therefore demands issuer settings rather than quietly running open.
    const config = load({
      ARNOLD_ENV: "staging",
      ...base,
      IDENTITY_STORE: "memory",
    });
    expect(config.mode).toBe("oidc");
  });

  it("refuses the reassuring half-configuration", () => {
    // The failure this exists to catch: auth off, issuer set. A reviewer
    // scanning the environment sees AUTH_ISSUER and assumes it is enforced.
    expect(() =>
      load({ AUTH_MODE: "open", AUTH_ISSUER: "https://auth.example.com/" }),
    ).toThrow(/sieht nach aktiver Authentifizierung aus/);
  });

  it("names every stray issuer variable it found", () => {
    const error = (() => {
      try {
        load({
          AUTH_MODE: "open",
          AUTH_ISSUER: "https://a.test/",
          AUTH_JWKS_URI: "https://a.test/jwks",
        });
        return null;
      } catch (caught) {
        return caught as Error;
      }
    })();
    expect(error?.message).toContain("AUTH_ISSUER");
    expect(error?.message).toContain("AUTH_JWKS_URI");
  });
});

describe("oidc mode requires a complete issuer configuration", () => {
  it("refuses a missing issuer", () => {
    expect(() =>
      load({ ARNOLD_ENV: "staging", ...base, AUTH_ISSUER: undefined }),
    ).toThrow(/AUTH_ISSUER fehlt/);
  });

  it("refuses a missing JWKS URI", () => {
    expect(() =>
      load({ ARNOLD_ENV: "staging", ...base, AUTH_JWKS_URI: undefined }),
    ).toThrow(/AUTH_JWKS_URI fehlt/);
  });

  it("refuses a plaintext JWKS URI on a public host", () => {
    // Loading signing keys over http means an on-path attacker chooses the
    // keys, which voids the entire token check.
    expect(() =>
      load({
        ARNOLD_ENV: "staging",
        ...base,
        AUTH_JWKS_URI: "http://auth.example.com/jwks",
      }),
    ).toThrow(/muss https sein/);
  });

  it("defaults the audience to Arnold's own resource identifier", () => {
    const config = load({
      ARNOLD_ENV: "staging",
      ...base,
      IDENTITY_STORE: "memory",
    });
    expect(config.oidc?.audience).toBe("https://arnold.example.com/mcp");
  });

  it("accepts an explicit audience", () => {
    const config = load({
      ARNOLD_ENV: "staging",
      ...base,
      AUTH_AUDIENCE: "https://arnold.example.com/mcp",
      IDENTITY_STORE: "memory",
    });
    expect(config.oidc?.audience).toBe("https://arnold.example.com/mcp");
  });

  it("defaults the authorization server to the issuer", () => {
    const config = load({
      ARNOLD_ENV: "staging",
      ...base,
      IDENTITY_STORE: "memory",
    });
    expect(config.oidc?.authorizationServer).toBe("https://auth.example.com/");
  });

  it("rejects a non-URL issuer", () => {
    expect(() =>
      load({ ARNOLD_ENV: "staging", ...base, AUTH_ISSUER: "not-a-url" }),
    ).toThrow(ConfigurationError);
  });
});

describe("production hardening", () => {
  const production = {
    ARNOLD_ENV: "production",
    ...base,
    IDENTITY_STORE: "postgres",
    DATABASE_URL: "postgres://arnold@db.internal:5432/arnold",
  } as const;

  it("accepts a fully specified production configuration", () => {
    const config = load({ ...production });
    expect(config.mode).toBe("oidc");
    expect(config.identityStore).toEqual({
      kind: "postgres",
      url: "postgres://arnold@db.internal:5432/arnold",
    });
  });

  it("refuses a plaintext public base URL", () => {
    expect(() =>
      load({
        ...production,
        ARNOLD_PUBLIC_BASE_URL: "http://arnold.example.com",
      }),
    ).toThrow(/muss in production https sein/);
  });

  it("refuses a plaintext issuer", () => {
    expect(() =>
      load({
        ...production,
        AUTH_ISSUER: "http://auth.example.com/",
        AUTH_JWKS_URI: "https://auth.example.com/jwks",
      }),
    ).toThrow(/AUTH_ISSUER muss in production https sein/);
  });

  it("refuses an in-memory identity store", () => {
    // Identity in process memory means a restart loses every account mapping
    // and two instances disagree about who exists.
    expect(() => load({ ...production, IDENTITY_STORE: "memory" })).toThrow(
      /nicht zulässig/,
    );
  });

  it("refuses a file identity store", () => {
    expect(() =>
      load({
        ...production,
        IDENTITY_STORE: "file",
        IDENTITY_STORE_FILE: "data/identity.json",
      }),
    ).toThrow(/Mehrnutzerbetrieb/);
  });

  it("defaults to postgres and then demands a DATABASE_URL", () => {
    expect(() =>
      load({
        ...production,
        IDENTITY_STORE: undefined,
        DATABASE_URL: undefined,
      }),
    ).toThrow(/DATABASE_URL fehlt/);
  });

  it("requires an explicit public base URL", () => {
    expect(() =>
      load({ ...production, ARNOLD_PUBLIC_BASE_URL: undefined }),
    ).toThrow(/ARNOLD_PUBLIC_BASE_URL fehlt/);
  });
});

describe("identity store selection", () => {
  it("requires a path for the file store", () => {
    expect(() => load({ IDENTITY_STORE: "file" })).toThrow(
      /IDENTITY_STORE_FILE fehlt/,
    );
  });

  it("accepts a file store with a path in development", () => {
    const config = load({
      IDENTITY_STORE: "file",
      IDENTITY_STORE_FILE: "data/identity.json",
    });
    expect(config.identityStore).toEqual({
      kind: "file",
      path: "data/identity.json",
    });
  });
});

describe("configuration summary", () => {
  it("describes the posture without naming a single secret", () => {
    const config = load({
      ARNOLD_ENV: "production",
      ...base,
      IDENTITY_STORE: "postgres",
      DATABASE_URL: "postgres://arnold:s3cr3t@db.internal:5432/arnold",
    });
    const summary = describeAuthConfig(config);

    expect(summary).toContain("env=production");
    expect(summary).toContain("auth=oidc");
    expect(summary).toContain("identity_store=postgres");
    // A connection string in a startup log is a credential in a startup log.
    expect(summary).not.toContain("s3cr3t");
    expect(summary).not.toContain("postgres://");
    expect(summary).not.toContain("auth.example.com");
  });
});
