# Arnold Auth Architecture

**Status 2026-10-29: authentication, Google routes and personal tracker provisioning are locally integration-verified in the explicit single-instance Connected development profile. Not verified against real Google, a real OIDC provider or the ChatGPT host. Not production-verified.**

Current end-to-end setup and limitations: [ARNOLD-CONNECTED-E2E.md](ARNOLD-CONNECTED-E2E.md). Anonymous fixture sessions remain separate; the connected journey authenticates before creating durable onboarding state.

This document describes the authentication that exists in the code today. Anything
not yet built is marked **NOT IMPLEMENTED** with the work package that owns it.
Nothing here has been tested against a real authorization server, a real ChatGPT
connection, or a real Google account — see [Verification status](#verification-status).

---

## 1. Two separate trust relationships

Arnold needs two unrelated authorizations, and conflating them is the single most
dangerous mistake available in this design.

|                | Layer A                                 | Layer B                                                        |
| -------------- | --------------------------------------- | -------------------------------------------------------------- |
| **Question**   | Which Arnold user is this MCP call for? | May Arnold touch this person's Google Drive?                   |
| **Direction**  | ChatGPT → Arnold                        | Arnold → Google                                                |
| **Credential** | Arnold access token (bearer, JWT)       | Google refresh/access token                                    |
| **Status**     | **Implemented, with startup discovery** | **Service + routes + development tracker runtime implemented** |

The rule, from Task 007 §4:

- A valid **Google** token is never, on its own, evidence that a given ChatGPT call
  is authorized for that user.
- A valid **Arnold** token never, on its own, grants access to arbitrary Google
  Drive files.

Layer B's logic exists — the authorization flow, `drive.file` scope policy,
id_token verification, encrypted refresh-token storage, refresh, revocation and
disconnect are all implemented and tested in `src/server/google/`. What is **not**
wired is the HTTP surface (`/auth/google/*`), so there is no way for a user to
actually start the flow yet, and no Google Cloud project has been configured.
Tracker provisioning on top of it is 007-C and does not exist.

---

## 2. Arnold is a Resource Server, not an Authorization Server

Arnold **verifies** tokens. It does not issue them, does not store client secrets
for its own clients, has no `/authorize` or `/token` endpoint, and contains no
token-minting code outside `tests/fixtures/arnold-auth.ts`.

This follows Task 007 §5's explicit warning against hand-rolling an authorization
server. The MCP SDK already provides the resource-server half, and Arnold uses it
rather than reimplementing it:

| Concern                                 | Provided by             | Arnold's part                 |
| --------------------------------------- | ----------------------- | ----------------------------- |
| `WWW-Authenticate` challenge            | `requireBearerAuth`     | —                             |
| RFC 9728 protected resource metadata    | `mcpAuthMetadataRouter` | scope list, resource URL      |
| RFC 8414 AS metadata passthrough        | `mcpAuthMetadataRouter` | fetch + validate the document |
| RFC 8707 resource comparison            | `expectedResource`      | populate `AuthInfo.resource`  |
| `401`/`403` OAuth error bodies          | SDK                     | internal → wire code mapping  |
| Per-tool `insufficient_scope` challenge | `requireScopes`         | access-class → scope table    |
| **Token verification itself**           | —                       | `ArnoldTokenVerifier`         |

The protocol surface a client depends on byte-for-byte is therefore the SDK's,
which is deliberate: hand-writing those headers is how a server ends up
almost-conformant.

### Choosing the authorization server

**Not yet chosen.** Arnold is provider-agnostic: it needs an OAuth 2.1 AS that
publishes RFC 8414 metadata, serves a JWKS, supports PKCE S256, issues JWT access
tokens with an `aud` naming Arnold's `/mcp` URL, and supports whichever client
registration mechanism ChatGPT requires.

`clientRegistrationMode()` reports what a configured issuer actually offers —
`cimd`, `dcr`, or `none`. `none` is a real answer: it means clients must be
registered by hand, which is workable for a private deployment and **a blocker for
public ChatGPT distribution**. Which of CIMD or DCR ChatGPT requires is an
**open question** that must be confirmed against current OpenAI documentation
before a provider is picked.

---

## 3. Token verification

`src/server/auth/token-verifier.ts`. Checks run in this order, and the order is
load-bearing: claims are never read as trustworthy before the signature verifies,
not even into a log line.

1. **Structure** — exactly three base64url segments, strict alphabet, both header
   and payload are JSON objects.
2. **Token type** — a `typ` of `JWT+ID` is refused, so an ID token cannot be
   presented as an access token.
3. **Key resolution** — `kid` → JWKS. A token cannot nominate its own key
   (embedded `jwk` and `jku` are ignored entirely).
4. **Signature** — see [§4](#4-algorithms).
5. **`iss`** — must equal the configured issuer exactly.
6. **`sub`** — must be a non-empty string. This is the identity.
7. **`exp`** — **mandatory**. A token with no expiry is refused.
8. **`nbf` / `iat`** — if present, must not be in the future.
9. **Lifetime ceiling** — `exp - iat` above `maxLifetimeSec` (default 24h) is
   refused, so a misconfigured AS handing out year-long tokens cannot silently
   become Arnold's problem.
10. **`aud`** — must name Arnold's resource identifier (RFC 8707). A token minted
    for another MCP server behind the same AS is refused.
11. **Scopes** — `scope` (space-delimited) or `scp` (string or array).

Clock tolerance is 60s by default, applied to `exp`, `nbf` and `iat`. It is kept
small on purpose: a generous skew window is an expired token that still works.

### Error disclosure

An authentication failure tells the caller nothing about _why_. "Signature invalid"
versus "issuer mismatch" tells an attacker which half of a forged token to fix. So
`ArnoldAuthError` carries two texts:

- `.message` — flat, generic, returned to the caller.
- `.detail` — the actual diagnosis, for audit events and server logs only.

`IDENTITY_UNKNOWN` and `ACCOUNT_DISABLED` both answer `invalid_token` on the wire,
so probing Arnold with a valid token from another tenant cannot enumerate which
subjects have Arnold accounts.

---

## 4. Algorithms

Accepted: `RS256/384/512`, `PS256/384/512`, `ES256/384/512`.

Refused, and why:

- **`none`** — not in the algorithm table at all, rather than special-cased later.
  An unsigned JWS is not a token.
- **Every HMAC algorithm (`HS*`)** — this is the algorithm-confusion defence. The
  classic break hands an RS256 verifier an HS256 token so the RSA _public_ key gets
  used as an HMAC secret. There is no symmetric code path.
- **Mismatched key type** — an `ES256` header cannot be verified with an RSA key
  even if one is supplied, and `ES256` requires P-256 specifically.
- **Mismatched published `alg`** — a JWK published for `RS256` is not borrowed for
  `PS256`.
- **Non-signing keys** — `use: "enc"` or a `key_ops` without `verify`.

Implemented on Node's `crypto`, not a JOSE library. Arnold needs exactly one JWS
operation and Node 22 imports JWKs natively, so a dependency here would widen the
supply chain of the module where that matters most. ECDSA signatures are read as
the fixed-width R‖S concatenation of RFC 7518, not OpenSSL's default DER.

---

## 5. JWKS and key rotation

`src/server/auth/jwks.ts`. Keys are resolved by `kid` at verification time, never
held as configuration, because authorization servers rotate them.

- **TTL** 10 min fresh, 60 min stale-usable.
- **Single-flight** — concurrent misses share one request, so a cold cache under
  load does not burst against the issuer.
- **Rotation refetch** — an unknown `kid` triggers at most one refetch per 30s
  cooldown. A refetch is skipped entirely when the cached document was fetched in
  the same call and is therefore already current.
- **Stale-on-error** — a failed refresh keeps serving cached keys until the stale
  window closes. A transient JWKS outage should not log every user out; a
  prolonged one does.
- **No-`kid` tokens** resolve only when the issuer publishes exactly one key.
  Picking "the first key that verifies" out of a multi-key JWKS would quietly undo
  rotation hygiene.

The cooldown deliberately tracks _rotation-triggered_ refetches separately from
ordinary refreshes. Conflating them was a real bug caught by
`tests/auth-token-verifier.test.ts`: a genuine rotation stayed invisible for a full
cooldown after every routine refresh.

---

## 6. Identity

`src/server/auth/identity.ts`, `src/server/identity/repository.ts`.

```
verified token  →  (iss, sub)  →  identity_connections  →  users.user_id
```

`AuthenticatedArnoldContext` is the only accepted proof of identity:

```ts
interface AuthenticatedArnoldContext {
  userId: string; // Arnold's own id — the key for every per-user lookup
  actorId: string; // opaque, hashed from (issuer, subject)
  scopes: readonly string[];
  issuer: string;
  audience: string;
  clientId: string; // which OAuth client is acting
  authSessionId: string | undefined; // hashed from jti, when present
  firstSeen: boolean;
}
```

The type has no public constructor taking a `userId`. The only way to obtain one is
through a resolver holding a verified `AuthInfo`, which is what structurally
prevents a tool from reading a user id out of its own arguments.

Three rules:

- **`(issuer, subject)` is the key, never an email address.** An email can be
  changed, reassigned by a workspace admin, or differ in case — any of which would
  silently re-point an account (Task 007 §8).
- **The pair is unique, and `register()` is idempotent under concurrency.**
  Otherwise two concurrent first-time requests give one person two Arnold accounts,
  and later two trackers with split history.
- **The same subject from a different issuer is a different user.** Subject
  identifiers are only unique within an issuer.

`actorId` and `authSessionId` are SHA-256 derived, so a subject that happens to be
an email address does not land in audit rows in recoverable form.

### Auto-provisioning

A verified identity with no Arnold user gets one created by default. A `users` row
is an id, a status and two timestamps — no personal data — so this is not the
"durable storage of personal onboarding state" that §6 gates behind
authentication; it is what _provides_ the authenticated context that gate needs.
`autoProvision: false` is available for endpoints that must only read existing
accounts.

---

## 7. Tool access classes

`src/server/auth/scopes.ts`, `src/server/auth/tool-guard.ts`.

| Class                 | Credential                     | For                                                       |
| --------------------- | ------------------------------ | --------------------------------------------------------- |
| `PUBLIC`              | none                           | information identical for every caller (no members today) |
| `SYNTHETIC_SANDBOX`   | none, **open mode only**       | demo writes to process-local invented data                |
| `ONBOARDING_PREVIEW`  | the onboarding session secret  | Task 006's pre-authentication setup flow                  |
| `AUTHENTICATED_READ`  | `arnold.read`                  | own training data, analytics, dashboard                   |
| `AUTHENTICATED_WRITE` | `arnold.read` + `arnold.write` | logging workouts and sets                                 |
| `PLAN_WRITE`          | `arnold.read` + `arnold.plan`  | creating/activating training plans                        |
| `ACCOUNT_MANAGEMENT`  | `arnold.account`               | Google connect/disconnect, deletion                       |

Three classes run without an Arnold token, and none is an escape hatch:

- `SYNTHETIC_SANDBOX` is refused outright in `enforced` mode, so it cannot become
  a way to write without authentication in a real deployment.
- `ONBOARDING_PREVIEW` does not mean "no credential" — it means the Arnold token
  is not the credential. `OnboardingAccessControl` requires the setup's own
  256-bit secret and compares it in constant time. This is §6's unauthenticated
  preview; 007-A2 still has to add the authenticated handoff that turns a
  confirmed draft into a real user's plan.
- `PUBLIC` has no members, so the surface needing nothing at all is empty.

**Scope matching is exact. No scope implies another.** `arnold.write` does not
stand in for `arnold.plan`: a client allowed to log sets is not therefore allowed
to rewrite the plan those sets are measured against.

`PUBLIC` returns _no_ user context — not a context with empty permissions —
because a public tool has no user and should not be invited to read per-user data.

Two layers enforce this, intentionally:

1. `scopeChallengeFor(access)` on `registerTool` makes the server emit a
   protocol-correct `insufficient_scope` challenge _before_ the handler runs, so a
   client can go get a better token.
2. The guard re-checks inside the handler. The challenge is advisory plumbing; the
   guard is the actual gate. A tool relying only on the challenge would not be safe.

**The guard runs per invocation, not once per connection.** This is what makes
revocation effective mid-session — a long-lived MCP session must not be a window
where a disabled account keeps working. `tests/auth-isolation.test.ts` asserts
exactly this.

### How a tool gets its class

Classes are **not** written next to each `registerTool` call. They live in one
table, `src/server/auth/tool-access.ts`, and `guardToolRegistrations` intercepts
`McpServer.registerTool` to apply them.

Interception rather than per-call-site guards, for two reasons:

- **Coverage.** Tools are registered across five modules, some inside loops over
  a contract's keys (`WriteInputs`, `PlanWriteInputs`), some through
  `registerAppTool` (which delegates to `registerTool` internally). Interception
  catches all of them, including registration code that knows nothing about
  authentication.
- **The failure mode.** An unclassified tool throws **at registration time**, so
  the server refuses to start rather than publishing a tool with no authority
  requirement. A forgotten classification is a boot failure in development, not
  an unauthenticated write path in production.

`tests/auth-tool-access.test.ts` asks each server configuration which tools it
actually publishes and asserts every one is classified — in both directions, so
a stale entry for a deleted tool also fails. That test, not this document, is
what keeps the table honest as tools are added.

### The same tool can mean different things

`log_workout_sets` against a user's Google tracker writes personal data and needs
`arnold.write`. The identical tool against Task 004's **fixture** runtime touches
process-local invented data owned by nobody. A name-keyed table cannot express
that, so the runtime declares it: `syntheticWrites` reclassifies the write
classes to `SYNTHETIC_SANDBOX` when the write runtime's mode is `fixture`.

This cannot open a hole. The guard refuses `SYNTHETIC_SANDBOX` outright in
`enforced` mode, so setting the flag wrongly **denies** writes rather than
permitting them, and `ACCOUNT_MANAGEMENT` is never reclassified.

### What an environment-driven deployment actually exposes

Worth stating precisely, because it is easy to overestimate:

The write tools (Task 004), plan write tools (Task 005) and onboarding tools
(Task 006) are each registered **only when a runtime is injected**:
`registerOnboardingTools` returns early without an `OnboardingService`,
`registerWorkoutTools` returns early when logging is absent or `disabled`, and
`registerPlanTools` returns early when plans are `disabled`.

`createHttpApp` injects the full synthetic onboarding/planning/logging runtime for
`STORAGE_MODE=arnold_fixture` and `ARNOLD_WRITE_MODE=fixture`. Separately,
`main.ts` calls asynchronous `createConfiguredHttpApp`: it discovers OIDC metadata
and, for `STORAGE_MODE=arnold_connected`, injects a per-user authenticated runtime
and Google browser routes. The connected profile requires development mode,
OIDC and file identity persistence. Other storage profiles remain read-only.

Connected writes use the `connected` repository mode with authenticated actors,
per-user tracker resolution and durable local journals. Its onboarding tools are
reclassified from preview to `PLAN_WRITE`; its Google tools use
`ACCOUNT_MANAGEMENT`. The module-global context was replaced by AsyncLocalStorage
and is tested with interleaved users. `production` write mode remains rejected,
and `test_sheet` retains its dedicated-workbook restrictions.

### Known gap: scope refusals are not audited

An under-scoped call is refused by the SDK's registered scope challenge _before_
the handler runs. That is the protocol-correct behaviour — it answers with an
`insufficient_scope` challenge the client can act on — but it means the handler
never runs, so Arnold's own guard never sees the call and **emits no audit
event**. Scope refusals are visible to the client and absent from the audit sink
that §26 asks to monitor. Asserted in `tests/auth-http.test.ts` so it cannot be
forgotten; closing it requires reporting the challenge path as well.

### Open mode

`AUTH_MODE=open` is the pre-Task-007 behaviour, retained so the Task 001–003 demo
and read-only profiles keep working (§32). It:

- serves `AUTHENTICATED_READ` from an obviously-synthetic context
  (`usr_open_mode_synthetic`),
- **refuses every write class**, so an unauthenticated deployment cannot write even
  if a future tool author forgets,
- advertises **no** protected-resource document, because it protects nothing,
- is **refused outside `ARNOLD_ENV=development`** by the config loader.

---

## 8. Configuration

`src/server/auth/config.ts`. Validated at startup; **fails closed**.

| Variable                    | Required when       | Notes                                                                 |
| --------------------------- | ------------------- | --------------------------------------------------------------------- |
| `ARNOLD_ENV`                | —                   | `development` \| `staging` \| `production`; default `development`     |
| `ARNOLD_PUBLIC_BASE_URL`    | outside development | must be `https` in production                                         |
| `ARNOLD_MCP_RESOURCE_URL`   | —                   | defaults to `<base>/mcp`; the RFC 8707 resource id                    |
| `AUTH_MODE`                 | —                   | `open` \| `oidc`; defaults to `open` in development, `oidc` elsewhere |
| `AUTH_ISSUER`               | `oidc`              | must be `https` in production                                         |
| `AUTH_JWKS_URI`             | `oidc`              | must be `https` unless loopback                                       |
| `AUTH_AUDIENCE`             | —                   | defaults to the resource id                                           |
| `AUTH_AUTHORIZATION_SERVER` | —                   | defaults to the issuer                                                |
| `IDENTITY_STORE`            | —                   | `memory` \| `file` \| `postgres`; `postgres` required in production   |
| `IDENTITY_STORE_FILE`       | `file`              |                                                                       |
| `DATABASE_URL`              | `postgres`          | **store NOT IMPLEMENTED — 007-D**                                     |

Refusals that matter:

- `AUTH_MODE=open` outside development.
- **`AUTH_MODE=open` while `AUTH_ISSUER` is set.** This is the dangerous
  half-configuration: a reviewer scanning the environment sees `AUTH_ISSUER` and
  assumes authentication is enforced. Arnold refuses to start.
- `http` for the public base URL, issuer, or resource id in production.
- `http` JWKS on a non-loopback host — loading signing keys over plaintext means an
  on-path attacker chooses the keys, voiding the entire token check.
- `memory` or `file` identity store in production.

`describeAuthConfig()` produces the startup/`/health` summary and deliberately omits
the issuer, JWKS URI and database URL. A connection string in a log line is a
credential in a log line.

---

## 9. HTTP surface

| Route                                         | Auth                                               | Status                                                               |
| --------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| `/.well-known/oauth-protected-resource[/mcp]` | public                                             | implemented (`oidc` mode only)                                       |
| `/.well-known/oauth-authorization-server`     | public                                             | implemented (`oidc` mode only)                                       |
| `/health`                                     | public                                             | reports `auth` mode, no secrets                                      |
| `/mcp`                                        | bearer                                             | implemented                                                          |
| `/auth/google/start` `/status` `/disconnect`  | bearer + account scope                             | connected development profile only                                   |
| `/auth/google/launch`                         | one-use ticket                                     | binds browser to the authenticated start                             |
| `/auth/google/callback`                       | state + browser cookie + verified pending identity | validates the confirmed revision and provisions the personal tracker |

Discovery is mounted before everything else: an unauthenticated client must be able
to read the protected-resource document in order to learn how to authenticate.

The `401` challenge includes `resource_metadata=` pointing at the protected-resource
document. Without that pointer a client cannot discover how to authenticate, so it
is asserted in `tests/auth-http.test.ts`.

---

## 10. Verification status

Task 007 §31 requires these levels to be kept apart. They are:

| Level                     | Status                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Unit-verified**         | ✅ 251 tests in `tests/auth-*.test.ts` and `tests/google-*.test.ts`                                    |
| **Integration-verified**  | ✅ `tests/auth-http.test.ts` — real `createHttpApp`, real HTTP, real JWKS fetch from a loopback issuer |
| **Staging-verified**      | ❌ **NOT VERIFIED.** No real authorization server has been configured or contacted.                    |
| **ChatGPT-host-verified** | ❌ **NOT VERIFIED.** No ChatGPT client has connected to this build.                                    |
| **Production-verified**   | ❌ **NOT VERIFIED.**                                                                                   |

A mock-issuer test does not prove a real OAuth setup is correct, and a local MCP
test does not prove ChatGPT can connect. The loopback issuer in the integration test
is a 40-line `http.createServer` that serves a JWKS and a metadata document — it
exercises Arnold's side of the protocol and proves nothing about any real provider.

### Still required before staging

1. **Choose and provision an authorization server.** Not chosen.
2. **Confirm ChatGPT's client registration requirement** (CIMD vs DCR) against
   current OpenAI documentation.
3. **Verify the implemented `/auth/google/*` routes against real Google.** Local HTTP/browser coverage uses simulated endpoints.
4. **Create and configure a Google Cloud project** — OAuth client, consent
   screen, Drive and Sheets APIs, redirect URIs, test users. A deployment gate,
   not a code task.
5. **Implement the PostgreSQL identity store** (007-D). `IDENTITY_STORE=postgres`
   currently throws, and the pending-authorization store is single-instance.
6. **Decide whether anonymous draft adoption is needed.** The connected profile authenticates before onboarding; it does not adopt sessions from the anonymous synthetic fixture.
7. **Run the implemented tracker provisioning and end-to-end journey against real Google and ChatGPT.** Local proof covers isolated users, restart, retries, revocation and the browser flow. Distributed persistence and production operations are still missing.

---

## 11. Test inventory

| File                                | Tests | Covers                                                           |
| ----------------------------------- | ----- | ---------------------------------------------------------------- |
| `tests/auth-token-verifier.test.ts` | 45    | §29 authentication matrix, JWKS cache, JWT decoding              |
| `tests/google-oauth.test.ts`        | 48    | §8/§9/§10 OAuth flow, refresh, revocation, disconnect            |
| `tests/google-credentials.test.ts`  | 40    | token encryption, AAD binding, rotation, scope policy            |
| `tests/auth-isolation.test.ts`      | 32    | §17 multi-user isolation, access classes, per-call re-check      |
| `tests/auth-config.test.ts`         | 26    | §25 fail-closed configuration                                    |
| `tests/auth-tool-access.test.ts`    | 22    | every published tool is classified; guarded registration         |
| `tests/auth-discovery.test.ts`      | 20    | AS metadata validation, issuer spoofing, PKCE, registration mode |
| `tests/auth-http.test.ts`           | 16    | real HTTP: challenges, discovery, guarded tool calls             |

Scripts: `npm run test:auth`, `npm run test:security`, `npm run test:integration`.

Whole suite after the Tasks 004–006 merge: **1130 tests across 50 files**, with
no regressions on either side.

The §29 cases covered as _attacks_ rather than happy paths: `alg: none`, HS256
signed with the public key, swapped claims under a valid signature, ES256 against
an RSA key, a key published for another algorithm, an encryption-only key, a
foreign signing key, unknown and rotated `kid`s, cross-resource token replay,
expired/not-yet-valid/future-issued/over-long tokens, a missing `aud`, an ID token
presented as an access token, and cross-user isolation with two synthetic
identities.

The connected journey now additionally covers callback-cookie/state replay,
PKCE/nonce verification, stale confirmations, personal provisioning, two concurrent
users, server restart, lost responses and account reconnection. Google transport is
simulated. Distributed persistence, real provider acceptance and production
operations remain unverified; see the current end-to-end report.
