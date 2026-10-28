/**
 * Google token storage: encryption at rest, and per-user isolation of it.
 *
 * Task 007 §10 asks for encrypted refresh tokens and §17 asks that no user can
 * reach another's credentials. Those two requirements meet in one specific
 * attack, which the first group below is built around: an attacker who can
 * *write* the database — SQL injection, a restored backup, a careless
 * migration — copying user B's encrypted refresh token into user A's row.
 * Encryption alone does not stop that. The AAD binding does.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EncryptionError,
  TokenCipher,
  generateEncryptionKey,
  loadTokenCipher,
  parseEncryptionKey,
  secretEquals,
} from "../src/server/google/crypto.js";
import {
  FileGoogleCredentialRepository,
  InMemoryGoogleCredentialRepository,
  toView,
} from "../src/server/google/credential-repository.js";
import {
  DRIVE_FILE_SCOPE,
  FORBIDDEN_GOOGLE_SCOPES,
  REQUESTED_GOOGLE_SCOPES,
  describeScopeVerdict,
  parseGrantedScopes,
  verifyGrantedScopes,
} from "../src/server/google/scopes.js";

const key1 = generateEncryptionKey("k1");
const key2 = generateEncryptionKey("k2");

const aliceCtx = {
  userId: "usr_alice",
  accountRef: "google-alice",
  field: "refresh_token",
};
const bobCtx = {
  userId: "usr_bob",
  accountRef: "google-bob",
  field: "refresh_token",
};

describe("refresh token encryption", () => {
  it("round-trips a token", () => {
    const cipher = new TokenCipher(key1);
    const sealed = cipher.seal("1//google-refresh-token", aliceCtx);
    expect(cipher.open(sealed, aliceCtx)).toBe("1//google-refresh-token");
  });

  it("never stores the plaintext in the envelope", () => {
    const cipher = new TokenCipher(key1);
    const sealed = cipher.seal("1//google-refresh-token", aliceCtx);
    expect(JSON.stringify(sealed)).not.toContain("google-refresh-token");
    expect(JSON.stringify(sealed)).not.toContain("1//");
  });

  it("uses a fresh IV per record, so identical tokens differ on disk", () => {
    const cipher = new TokenCipher(key1);
    const a = cipher.seal("same-token", aliceCtx);
    const b = cipher.seal("same-token", aliceCtx);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("refuses a ciphertext moved to another user's row", () => {
    // The attack this binding exists for. Both rows use the same key, so
    // without AAD the bytes would decrypt perfectly and Arnold would act on
    // Bob's Drive believing it was acting for Alice.
    const cipher = new TokenCipher(key1);
    const bobsToken = cipher.seal("bobs-refresh-token", bobCtx);

    expect(() => cipher.open(bobsToken, aliceCtx)).toThrow(EncryptionError);
  });

  it("refuses a token carried across the same user's account switch", () => {
    // The row keeps its credential id when a user connects a different Google
    // account, so binding to the account subject is what stops the old
    // account's token from being read as the new account's.
    const cipher = new TokenCipher(key1);
    const sealed = cipher.seal("token", aliceCtx);
    expect(() =>
      cipher.open(sealed, { ...aliceCtx, accountRef: "google-alice-second" }),
    ).toThrow(EncryptionError);
  });

  it("refuses a ciphertext reused for a different field", () => {
    const cipher = new TokenCipher(key1);
    const sealed = cipher.seal("token", aliceCtx);
    expect(() =>
      cipher.open(sealed, { ...aliceCtx, field: "access_token" }),
    ).toThrow(EncryptionError);
  });

  it("refuses a tampered ciphertext", () => {
    const cipher = new TokenCipher(key1);
    const sealed = cipher.seal("token", aliceCtx);
    const flipped = Buffer.from(sealed.ct, "base64");
    flipped[0] ^= 0xff;
    expect(() =>
      cipher.open({ ...sealed, ct: flipped.toString("base64") }, aliceCtx),
    ).toThrow(EncryptionError);
  });

  it("refuses a tampered authentication tag", () => {
    const cipher = new TokenCipher(key1);
    const sealed = cipher.seal("token", aliceCtx);
    const tag = Buffer.from(sealed.tag, "base64");
    tag[0] ^= 0xff;
    expect(() =>
      cipher.open({ ...sealed, tag: tag.toString("base64") }, aliceCtx),
    ).toThrow(EncryptionError);
  });

  it("refuses a ciphertext from a different key", () => {
    const sealed = new TokenCipher(key1).seal("token", aliceCtx);
    expect(() => new TokenCipher(key2).open(sealed, aliceCtx)).toThrow(
      /nicht im Schlüsselring/,
    );
  });

  it("refuses an unknown envelope version", () => {
    const cipher = new TokenCipher(key1);
    const sealed = cipher.seal("token", aliceCtx);
    expect(() => cipher.open({ ...sealed, v: 99 }, aliceCtx)).toThrow(
      /Envelope-Version/,
    );
  });

  it("refuses an envelope with the wrong IV length", () => {
    const cipher = new TokenCipher(key1);
    const sealed = cipher.seal("token", aliceCtx);
    expect(() =>
      cipher.open(
        { ...sealed, iv: Buffer.alloc(8).toString("base64") },
        aliceCtx,
      ),
    ).toThrow(/IV- oder Tag-Länge/);
  });
});

describe("key rotation", () => {
  it("writes under the active key and still reads the retired one", () => {
    const old = new TokenCipher(key1).seal("old-token", aliceCtx);
    const rotated = new TokenCipher(key2, [key1]);

    expect(rotated.open(old, aliceCtx)).toBe("old-token");
    expect(rotated.seal("new-token", aliceCtx).kid).toBe("k2");
  });

  it("flags rows written under a retired key for re-wrapping", () => {
    const old = new TokenCipher(key1).seal("old-token", aliceCtx);
    const rotated = new TokenCipher(key2, [key1]);

    expect(rotated.needsRewrap(old)).toBe(true);
    expect(rotated.needsRewrap(rotated.seal("x", aliceCtx))).toBe(false);
  });

  it("refuses a keyring with a duplicate key id", () => {
    expect(() => new TokenCipher(key1, [{ ...key2, kid: "k1" }])).toThrow(
      /doppelt belegt/,
    );
  });
});

describe("key material validation", () => {
  it("refuses a key that is not 32 bytes", () => {
    expect(() =>
      parseEncryptionKey("k1", Buffer.alloc(16).toString("base64")),
    ).toThrow(/erwartet werden 32/);
  });

  it("refuses a key id with unusual characters", () => {
    expect(() =>
      parseEncryptionKey("k 1!", Buffer.alloc(32).toString("base64")),
    ).toThrow(/unzulässige Zeichen/);
  });

  it("loads a keyring from the environment", () => {
    const cipher = loadTokenCipher({
      TOKEN_ENCRYPTION_KEY: `k2:${key2.key.toString("base64")}`,
      TOKEN_ENCRYPTION_KEYS_OLD: `k1:${key1.key.toString("base64")}`,
    } as NodeJS.ProcessEnv);

    expect(cipher.activeKeyId).toBe("k2");
    const old = new TokenCipher(key1).seal("old", aliceCtx);
    expect(cipher.open(old, aliceCtx)).toBe("old");
  });

  it("refuses to start without a key", () => {
    expect(() => loadTokenCipher({} as NodeJS.ProcessEnv)).toThrow(
      /TOKEN_ENCRYPTION_KEY fehlt/,
    );
  });

  it("refuses a key without a kid prefix", () => {
    expect(() =>
      loadTokenCipher({
        TOKEN_ENCRYPTION_KEY: key1.key.toString("base64"),
      } as NodeJS.ProcessEnv),
    ).toThrow(/<kid>:<base64>/);
  });
});

describe("constant-time secret comparison", () => {
  it("matches equal values and rejects different ones", () => {
    expect(secretEquals("abc", "abc")).toBe(true);
    expect(secretEquals("abc", "abd")).toBe(false);
  });

  it("rejects values of different length without throwing", () => {
    expect(secretEquals("abc", "abcd")).toBe(false);
    expect(secretEquals("", "x")).toBe(false);
  });
});

describe("credential repository", () => {
  const sealed = new TokenCipher(key1).seal("refresh", aliceCtx);

  it("stores and returns a connection for its own user", async () => {
    const repository = new InMemoryGoogleCredentialRepository();
    await repository.upsert({
      userId: "usr_alice",
      googleSubject: "google-alice",
      googleEmail: "alice@example.com",
      grantedScopes: [DRIVE_FILE_SCOPE],
      refreshToken: sealed,
    });

    const found = await repository.findByUser("usr_alice");
    expect(found?.google_subject).toBe("google-alice");
    expect(found?.status).toBe("CONNECTED");
  });

  it("returns nothing for a different user", async () => {
    const repository = new InMemoryGoogleCredentialRepository();
    await repository.upsert({
      userId: "usr_alice",
      googleSubject: "google-alice",
      googleEmail: null,
      grantedScopes: [DRIVE_FILE_SCOPE],
      refreshToken: sealed,
    });

    expect(await repository.findByUser("usr_bob")).toBeUndefined();
  });

  it("keeps two users' connections entirely separate", async () => {
    const repository = new InMemoryGoogleCredentialRepository();
    await repository.upsert({
      userId: "usr_alice",
      googleSubject: "google-alice",
      googleEmail: null,
      grantedScopes: [DRIVE_FILE_SCOPE],
      refreshToken: sealed,
    });
    await repository.upsert({
      userId: "usr_bob",
      googleSubject: "google-bob",
      googleEmail: null,
      grantedScopes: [DRIVE_FILE_SCOPE],
      refreshToken: new TokenCipher(key1).seal("bob-refresh", bobCtx),
    });

    const alice = await repository.findByUser("usr_alice");
    const bob = await repository.findByUser("usr_bob");
    expect(alice?.google_subject).toBe("google-alice");
    expect(bob?.google_subject).toBe("google-bob");
    expect(alice?.credential_id).not.toBe(bob?.credential_id);
  });

  it("reports the previous subject when the Google account changes", async () => {
    const repository = new InMemoryGoogleCredentialRepository();
    await repository.upsert({
      userId: "usr_alice",
      googleSubject: "google-alice",
      googleEmail: null,
      grantedScopes: [DRIVE_FILE_SCOPE],
      refreshToken: sealed,
    });
    const second = await repository.upsert({
      userId: "usr_alice",
      googleSubject: "google-someone-else",
      googleEmail: null,
      grantedScopes: [DRIVE_FILE_SCOPE],
      refreshToken: sealed,
    });

    expect(second.previousSubject).toBe("google-alice");
  });

  it("keeps the original connection date when the same account reconnects", async () => {
    const repository = new InMemoryGoogleCredentialRepository();
    const first = await repository.upsert({
      userId: "usr_alice",
      googleSubject: "google-alice",
      googleEmail: null,
      grantedScopes: [DRIVE_FILE_SCOPE],
      refreshToken: sealed,
    });
    const again = await repository.upsert({
      userId: "usr_alice",
      googleSubject: "google-alice",
      googleEmail: null,
      grantedScopes: [DRIVE_FILE_SCOPE],
      refreshToken: sealed,
    });

    expect(again.connection.connected_at_utc).toBe(
      first.connection.connected_at_utc,
    );
    expect(again.previousSubject).toBe("google-alice");
  });

  it("drops the stored token when reauthorization becomes necessary", async () => {
    // A credential Google will not refresh has no use, and keeping it invites
    // a retry loop against a dead token.
    const repository = new InMemoryGoogleCredentialRepository();
    await repository.upsert({
      userId: "usr_alice",
      googleSubject: "google-alice",
      googleEmail: null,
      grantedScopes: [DRIVE_FILE_SCOPE],
      refreshToken: sealed,
    });

    await repository.markStatus(
      "usr_alice",
      "REAUTH_REQUIRED",
      "invalid_grant",
    );

    const found = await repository.findByUser("usr_alice");
    expect(found?.status).toBe("REAUTH_REQUIRED");
    expect(found?.refresh_token).toBeNull();
    expect(found?.last_error_code).toBe("invalid_grant");
  });

  it("removes only the requested user's credential", async () => {
    const repository = new InMemoryGoogleCredentialRepository();
    for (const userId of ["usr_alice", "usr_bob"])
      await repository.upsert({
        userId,
        googleSubject: `google-${userId}`,
        googleEmail: null,
        grantedScopes: [DRIVE_FILE_SCOPE],
        refreshToken: sealed,
      });

    expect(await repository.remove("usr_alice")).toBe(true);
    expect(await repository.findByUser("usr_alice")).toBeUndefined();
    expect(await repository.findByUser("usr_bob")).toBeDefined();
  });

  it("reports nothing removed for a user with no connection", async () => {
    const repository = new InMemoryGoogleCredentialRepository();
    expect(await repository.remove("usr_nobody")).toBe(false);
  });

  it("refuses a connection with no Google subject", async () => {
    const repository = new InMemoryGoogleCredentialRepository();
    await expect(
      repository.upsert({
        userId: "usr_alice",
        googleSubject: "",
        googleEmail: null,
        grantedScopes: [],
        refreshToken: null,
      }),
    ).rejects.toThrow(/Google-Subject/);
  });

  it("omits the sealed token from the view a caller sees", () => {
    const view = toView({
      credential_id: "gcr_1",
      user_id: "usr_alice",
      google_subject: "google-alice",
      google_email: "alice@example.com",
      granted_scopes: [DRIVE_FILE_SCOPE],
      status: "CONNECTED",
      refresh_token: sealed,
      connected_at_utc: "2026-10-27T00:00:00.000Z",
      last_success_at_utc: null,
      last_error_code: null,
      updated_at_utc: "2026-10-27T00:00:00.000Z",
    });

    expect(view.has_refresh_token).toBe(true);
    expect(JSON.stringify(view)).not.toContain(sealed.ct);
    expect("refresh_token" in view).toBe(false);
  });
});

describe("file-backed credential store", () => {
  it("persists ciphertext only, with restrictive permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arnold-gcred-"));
    try {
      const path = join(directory, "credentials.json");
      const repository = new FileGoogleCredentialRepository(path);
      await repository.upsert({
        userId: "usr_alice",
        googleSubject: "google-alice",
        googleEmail: null,
        grantedScopes: [DRIVE_FILE_SCOPE],
        refreshToken: new TokenCipher(key1).seal(
          "1//very-secret-refresh",
          aliceCtx,
        ),
      });

      const raw = await readFile(path, "utf8");
      expect(raw).not.toContain("very-secret-refresh");
      expect(raw).toContain("google-alice");

      // A second instance reads the same rows back.
      const reopened = new FileGoogleCredentialRepository(path);
      const found = await reopened.findByUser("usr_alice");
      expect(found?.google_subject).toBe("google-alice");
      expect(
        new TokenCipher(key1).open(found!.refresh_token!, {
          userId: "usr_alice",
          accountRef: found!.google_subject,
          field: "refresh_token",
        }),
      ).toBe("1//very-secret-refresh");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Google scope policy", () => {
  it("requests drive.file and never broad Drive access", () => {
    expect(REQUESTED_GOOGLE_SCOPES).toContain(DRIVE_FILE_SCOPE);
    for (const forbidden of FORBIDDEN_GOOGLE_SCOPES)
      expect(REQUESTED_GOOGLE_SCOPES).not.toContain(forbidden);
  });

  it("requests openid, because the account key is the OIDC subject", () => {
    expect(REQUESTED_GOOGLE_SCOPES).toContain("openid");
  });

  it("accepts a grant with exactly the required scopes", () => {
    const verdict = verifyGrantedScopes(["openid", DRIVE_FILE_SCOPE]);
    expect(verdict.usable).toBe(true);
    expect(verdict.missing).toEqual([]);
  });

  it("treats a declined email scope as still usable", () => {
    // Cosmetic, not required: a user who declines it gets a working tracker
    // without their address shown in the UI.
    expect(verifyGrantedScopes(["openid", DRIVE_FILE_SCOPE]).usable).toBe(true);
  });

  it("refuses a grant missing drive.file", () => {
    const verdict = verifyGrantedScopes(["openid", "email"]);
    expect(verdict.usable).toBe(false);
    expect(verdict.missing).toContain(DRIVE_FILE_SCOPE);
    expect(describeScopeVerdict(verdict)).toMatch(/eigene Tabelle/);
  });

  it("refuses a grant that is too broad", () => {
    // A misconfigured OAuth client handing Arnold full Drive access is a
    // problem to stop on, not to accept gratefully.
    const verdict = verifyGrantedScopes([
      "openid",
      DRIVE_FILE_SCOPE,
      "https://www.googleapis.com/auth/drive",
    ]);
    expect(verdict.usable).toBe(false);
    expect(verdict.excessive).toContain(
      "https://www.googleapis.com/auth/drive",
    );
    expect(describeScopeVerdict(verdict)).toMatch(/mehr Rechte/);
  });

  it("refuses a grant carrying the full spreadsheets scope", () => {
    const verdict = verifyGrantedScopes([
      "openid",
      DRIVE_FILE_SCOPE,
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
    expect(verdict.usable).toBe(false);
  });

  it("parses Google's space-delimited scope string", () => {
    expect(parseGrantedScopes("openid email  drive.file")).toEqual([
      "openid",
      "email",
      "drive.file",
    ]);
    expect(parseGrantedScopes(undefined)).toEqual([]);
  });
});
