/**
 * Encryption for stored Google refresh tokens.
 *
 * A Google refresh token is a long-lived credential for someone else's Drive.
 * Task 007 §10 requires it encrypted at rest with key material held outside
 * the application code, so this module is the only place in Arnold that
 * handles one in plaintext.
 *
 * AES-256-GCM, random 96-bit IV per record, authentication tag retained.
 *
 * The part worth explaining is the **additional authenticated data**. Each
 * ciphertext is bound to the user id, the credential id and the field name it
 * belongs to. Without that binding, encryption alone would not stop the attack
 * that matters most here: anyone able to *write* the database — a SQL
 * injection, a restored backup, a careless migration — could copy user B's
 * encrypted refresh token into user A's row. The bytes would still decrypt,
 * and Arnold would then act on B's Drive while believing it was acting for A.
 * Binding the AAD to the row's identity makes that ciphertext undecryptable
 * anywhere but its own row, which is the Task 007 §17 cross-account property
 * extended to the storage layer.
 *
 * The envelope carries a key id so rotation does not require re-encrypting
 * every row at once: new writes use the active key, old rows keep decrypting
 * under the key they were written with until a migration re-wraps them.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ENVELOPE_VERSION = 1;

/** One decryption key, identified so rotation can be incremental. */
export interface EncryptionKey {
  /** Short stable label stored alongside each ciphertext, e.g. `k1`. */
  kid: string;
  /** Exactly 32 bytes. */
  key: Buffer;
}

export interface SealedValue {
  v: number;
  kid: string;
  /** base64 IV. */
  iv: string;
  /** base64 ciphertext. */
  ct: string;
  /** base64 GCM authentication tag. */
  tag: string;
}

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

/**
 * Identifies which row and field a ciphertext belongs to.
 *
 * Every field is mandatory: an optional AAD component is one that gets
 * omitted at a call site and silently removes the binding it was meant to
 * provide.
 *
 * `accountRef` is the **Google OIDC subject**, not Arnold's own credential id.
 * That choice is deliberate and was not the first attempt. Binding to the
 * credential id creates a chicken-and-egg problem — the id is assigned by the
 * store on insert, so the token has to be sealed before its own AAD is known,
 * and the only way out is to seal twice. Worse, a re-seal step is exactly the
 * kind of thing that gets skipped on one code path and leaves an
 * undecryptable row.
 *
 * The Google subject is known before the insert and never changes, so it needs
 * no dance. It is also the stronger binding: it ties the ciphertext to the
 * Google *account* it came from, which additionally prevents a token being
 * carried across a user's own account switch (§23) — a case the credential id
 * would have missed, since the row keeps its id when the account changes.
 */
export interface SealContext {
  userId: string;
  /** The Google account's stable OIDC subject. */
  accountRef: string;
  field: string;
}

function aadFor(context: SealContext): Buffer {
  return Buffer.from(
    [
      "arnold.google-credential/1",
      context.userId,
      context.accountRef,
      context.field,
    ].join(" "),
    "utf8",
  );
}

/**
 * Parses a key from its base64 representation.
 *
 * Rejects anything that is not exactly 32 bytes rather than stretching or
 * truncating it. A silently padded short key is a weak key that looks fine.
 */
export function parseEncryptionKey(
  kid: string,
  material: string,
): EncryptionKey {
  let key: Buffer;
  try {
    key = Buffer.from(material, "base64");
  } catch {
    throw new EncryptionError(`Schlüssel ${kid} ist kein gültiges base64.`);
  }
  if (key.length !== KEY_BYTES)
    throw new EncryptionError(
      `Schlüssel ${kid} ist ${key.length} Byte lang, erwartet werden ${KEY_BYTES}.`,
    );
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid))
    throw new EncryptionError(
      `Schlüssel-ID ${kid} enthält unzulässige Zeichen.`,
    );
  return { kid, key };
}

/** Generates a fresh key. For local development and tests only. */
export function generateEncryptionKey(kid = "dev"): EncryptionKey {
  return { kid, key: randomBytes(KEY_BYTES) };
}

/**
 * A keyring: one active key for writes, any number retained for reads.
 *
 * Rotation is therefore: add the new key as active, keep the old one, re-wrap
 * rows in the background, drop the old key once none reference it.
 */
export class TokenCipher {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeKid: string;

  constructor(active: EncryptionKey, retired: readonly EncryptionKey[] = []) {
    this.activeKid = active.kid;
    this.keys.set(active.kid, active.key);
    for (const key of retired) {
      if (this.keys.has(key.kid))
        throw new EncryptionError(
          `Schlüssel-ID ${key.kid} ist doppelt belegt.`,
        );
      this.keys.set(key.kid, key.key);
    }
  }

  /** Which key new writes use. Exposed so a migration can spot stale rows. */
  get activeKeyId(): string {
    return this.activeKid;
  }

  seal(plaintext: string, context: SealContext): SealedValue {
    const key = this.keys.get(this.activeKid);
    if (!key) throw new EncryptionError("Kein aktiver Schlüssel konfiguriert.");
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(aadFor(context));
    const ct = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return {
      v: ENVELOPE_VERSION,
      kid: this.activeKid,
      iv: iv.toString("base64"),
      ct: ct.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  /**
   * Decrypts, or throws.
   *
   * A tag mismatch is indistinguishable here from a ciphertext moved between
   * rows, and deliberately so: both mean "this value is not the one that
   * belongs here", and neither is a situation to continue from.
   */
  open(sealed: SealedValue, context: SealContext): string {
    if (sealed.v !== ENVELOPE_VERSION)
      throw new EncryptionError(`Unbekannte Envelope-Version ${sealed.v}.`);
    const key = this.keys.get(sealed.kid);
    if (!key)
      throw new EncryptionError(
        `Schlüssel ${sealed.kid} ist nicht im Schlüsselring. Rotierte Schlüssel müssen zum Lesen erhalten bleiben.`,
      );
    const iv = Buffer.from(sealed.iv, "base64");
    const tag = Buffer.from(sealed.tag, "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
      throw new EncryptionError(
        "Envelope hat eine ungültige IV- oder Tag-Länge.",
      );
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aadFor(context));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.ct, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new EncryptionError(
        "Token konnte nicht entschlüsselt werden. Entweder ist der Schlüssel falsch oder der Datensatz gehört nicht zu diesem Nutzer.",
      );
    }
  }

  /** True when a row was written under a key that is no longer active. */
  needsRewrap(sealed: SealedValue): boolean {
    return sealed.kid !== this.activeKid;
  }
}

/**
 * Loads the keyring from the environment.
 *
 * `TOKEN_ENCRYPTION_KEY` is `<kid>:<base64 key>`; `TOKEN_ENCRYPTION_KEYS_OLD`
 * is a comma-separated list in the same form. Reading key material from the
 * environment is how it stays out of the code and out of git — the value
 * itself is expected to come from a secret manager, which is why the
 * configuration name in Task 007 §25 is a *reference*.
 */
export function loadTokenCipher(env: NodeJS.ProcessEnv): TokenCipher {
  const active = env.TOKEN_ENCRYPTION_KEY;
  if (!active)
    throw new EncryptionError(
      "TOKEN_ENCRYPTION_KEY fehlt. Ohne Schlüssel speichert Arnold keine Google-Tokens.",
    );
  const parse = (entry: string): EncryptionKey => {
    const separator = entry.indexOf(":");
    if (separator <= 0)
      throw new EncryptionError(
        "Schlüssel müssen die Form <kid>:<base64> haben.",
      );
    return parseEncryptionKey(
      entry.slice(0, separator),
      entry.slice(separator + 1),
    );
  };
  const retired = (env.TOKEN_ENCRYPTION_KEYS_OLD ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parse);
  return new TokenCipher(parse(active), retired);
}

/**
 * Constant-time comparison for opaque values such as an OAuth `state`.
 *
 * Lives here because it is the same class of mistake as logging a token: a
 * `===` on a secret is a timing oracle, and the fix belongs next to the other
 * credential handling rather than reinvented per call site.
 */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
