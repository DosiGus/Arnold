# Arnold codebase: where a Garmin watch API fits (auth, plan read, workout upload, DB, tests)

Repo state: `main` @ `914afcd` (8 Nov 2026), read-only inspection. Repo paths are relative to `/Users/kevingusmao/Desktop/Arnold`. Payload sizes were measured with a synthetic JSON sample in a scratch script, not from real data.

## 1. Auth today and what a second, device-token auth path must respect

### Takeaway

Today every authenticated request goes through one path: a WorkOS JWT checked against JWKS by `requireBearerAuth` (issuer, audience = MCP resource URL, `exp`, lifetime of at most 24 h). Then `ArnoldIdentityResolver.resolve` maps issuer+subject to an `AuthenticatedArnoldContext`. That context is stored in `AsyncLocalStorage` (`withArnoldContext`), and `DatabaseArnoldRuntime.forUser(context)` gives per-user services that only run through `Database.asUser`. A device-token path can reuse everything from `AuthenticatedArnoldContext` onward. It needs:

- its own verifier (opaque token, hashed in the DB, looked up through a SECURITY DEFINER function, because RLS hides rows before the user is known);
- its own scope set;
- an explicit `assertActive` check plus a revocation check on every request.

### Cited Findings

- `buildAuthSurface` (src/server/auth/router.ts) builds `ArnoldTokenVerifier` (issuer, audience, `JwksCache`, optional `scopeClaim`). It returns `bearerGate = requireBearerAuth({verifier, expectedResource: config.resourceUrl, resourceMetadataUrl})`, a `resolveRequest(req)` that throws `AUTH_REQUIRED` unless `config.mode === "oidc"` and `req.auth` is set, and `assertActive(context)` that throws `ACCOUNT_DISABLED` unless `repository.byId(userId).status === "ACTIVE"`. — [src/server/auth/router.ts](src/server/auth/router.ts)
- `AuthenticatedArnoldContext` fields: `userId`, `actorId` (sha256 of issuer+subject, `act_…`), `scopes`, `issuer`, `audience`, `clientId`, `authSessionId` (hashed `jti`), `firstSeen`. The doc comment says it is "the only object the rest of Arnold should accept as proof of identity" and that it has no constructor taking a userId. `ArnoldIdentityResolver.resolve(auth)` calls `verifiedSubject(auth)`, then `repository.register(issuer, subject)` (auto-provision) or `find`. It throws on `IDENTITY_UNKNOWN`, on `ACCOUNT_DISABLED`, and on a missing `auth.resource`. — [src/server/auth/identity.ts](src/server/auth/identity.ts)
- `verifiedSubject(auth)` reads `auth.extra.issuer` and `auth.extra.subject` and throws `INVALID_TOKEN` if either is missing. — [src/server/auth/token-verifier.ts](src/server/auth/token-verifier.ts) (l. 265–277)
- Token verifier limits: `DEFAULT_CLOCK_TOLERANCE_SEC = 60` and `DEFAULT_MAX_LIFETIME_SEC = 24*60*60` (hard ceiling on `exp - iat`). `exp` is mandatory, and `aud` must name the resource. — [src/server/auth/token-verifier.ts](src/server/auth/token-verifier.ts)
- Auth config env (fails closed): `AUTH_MODE`, `AUTH_ISSUER`, `AUTH_JWKS_URI` (must be https), `AUTH_AUDIENCE` (defaults to the resource URL), `AUTH_AUTHORIZATION_SERVER`, `AUTH_SCOPE_CLAIM` (URN claim, e.g. `urn:arnold:scopes`). `AUTH_MODE=open` is only allowed in `ARNOLD_ENV=development`, and stray OIDC vars in open mode stop the start. — [src/server/auth/config.ts](src/server/auth/config.ts)
- AsyncLocalStorage: `const activeContext = new AsyncLocalStorage<AuthenticatedArnoldContext|undefined>()`, with `currentArnoldContext()` to read it and `withArnoldContext(context, action)` to run code under it. The comment says "Trusted HTTP callback paths use the same isolated context as MCP handlers". `guardToolRegistrations` wraps each `registerTool`: `requireToolAccess(name)` throws for unclassified tools, `guard.authorize(name, access, ctx)` runs per call, and the handler runs inside `activeContext.run(context, …)`. Calls are logged with `logToolCall`. — [src/server/auth/guarded-server.ts](src/server/auth/guarded-server.ts)
- `TOOL_ACCESS` table: one access class per MCP tool name, and an unclassified tool throws `UnclassifiedToolError` at registration. Classes are `SYNTHETIC_SANDBOX`, `ONBOARDING_PREVIEW`, `AUTHENTICATED_READ` (`arnold.read`), `AUTHENTICATED_WRITE` (`arnold.read`+`arnold.write`), `PLAN_WRITE`, `ACCOUNT_MANAGEMENT`. `get_workout` is `AUTHENTICATED_READ` and `log_workout` is `AUTHENTICATED_WRITE`. Scopes are exact: no scope implies another. — [src/server/auth/tool-access.ts](src/server/auth/tool-access.ts); [docs/GUIDE.md](docs/GUIDE.md) („Authentifizierung und Zugriff“)
- In `/mcp` (src/server/http.ts) with a database: `options.database.forUser(await auth.resolveRequest(req))`. POSTs run under `perUser.exclusive(context, handle)` (serialised per user per instance, inside `withArnoldContext`). GETs run under `withArnoldContext(context, handle)`. — [src/server/http.ts](src/server/http.ts)
- `DatabaseArnoldRuntime.forUser(context)` calls `auth.assertActive(context)`, then builds or caches a `DatabaseUserRuntime` (LRU, 1000 users) holding `store`, `source`, `plans`, `service`, `onboarding`. Its `AuthorizationGuard.authorize` calls `this.caller(context ?? currentArnoldContext())`. That requires `caller.userId === this.userId`, re-runs `assertActive`, and returns `Actor{subject: caller.userId, kind: "authenticated", permissions: ["write","correct_completed"]}`. Workout writes also require completed setup (`onboarding.setupRequired(context)` → `PERMISSION_DENIED`). — [src/server/db/runtime.ts](src/server/db/runtime.ts)
- `Database.asUser(userId, work)` validates the userId against `^usr_<uuid>$`, opens a transaction, runs `set_config('arnold.user_id', $1, true)`, and commits or rolls back. `assertReady()` refuses to start on a schema version other than `EXPECTED_SCHEMA_VERSION = 2`, or if the role is superuser, has BYPASSRLS, or owns a table. — [src/server/db/database.ts](src/server/db/database.ts)
- Login → account lookup happens before the user is known, so it runs through the SECURITY DEFINER function `arnold.resolve_identity(p_issuer, p_subject, p_create)` (advisory lock on first contact, `last_seen_at` updated at most hourly). `arnold.account(p_user_id)` is a SECURITY DEFINER function for the per-request active check. EXECUTE is revoked from public and granted only to `arnold_app`. — [db/migrations/001_arnold.sql](db/migrations/001_arnold.sql)
- CLAUDE.md rules: auth and data fail closed; user and tracker IDs come only from the verified token, never from tool arguments; the server connects only as `arnold_app`; user context goes only through AsyncLocalStorage, never module globals. — [CLAUDE.md](CLAUDE.md)

### Inferences

- **Insertion point.** A device path only needs to produce an `AuthenticatedArnoldContext`. After that, `DatabaseArnoldRuntime.forUser`, `exclusive`, `DatabaseUserRuntime.service` and `.source` work unchanged. Suggested shape:
  - a new `src/server/auth/device-token.ts` with a `DeviceTokenVerifier`: parse `Authorization: Bearer arn_dev_<random>`, compute sha256, call a new SECURITY DEFINER `arnold.resolve_device_token(p_token_hash)` that returns `user_id, device_id, scopes, status` and bumps `last_used_at` at most hourly;
  - build the context with `issuer = "arnold.device/1"`, `subject = device_id`, `clientId = "arnold-garmin"`, `audience = resourceUrl + "/api/watch/v1"`, `scopes = ["arnold.watch.read","arnold.watch.write"]`, `authSessionId` = hash of `device_id`.
- **`actorId`.** For audit, derive `actorId` from the device id (e.g. `deriveActorId("arnold.device/1", device_id)`) so audit rows show "Kevin via watch". Caveat: `commitWrite` uses `actor.subject` (= `userId`) for the operation receipt, not `actorId` (see §4).
- **Fail closed:**
  - unknown, revoked or expired token, or a disabled account → 401 with a generic body;
  - a DB error during lookup → 503, never a pass-through;
  - the router is mounted only when `config.mode === "oidc"` and `options.database` is present, so no watch API exists in open/fixture mode unless it is explicitly sandboxed;
  - store only token hashes, never the raw token, and never log it (`tests/log-privacy.test.ts` pattern).
- **Do not reuse `requireBearerAuth`/`ArnoldTokenVerifier`** for device tokens. That gate is RFC 8707/JWKS-specific, and the `/mcp` audience must not accept a device token, or the reverse. Keep the two credentials separate: a device token must never work on `/mcp`.
- **Scopes.** Add watch-specific scopes so a leaked watch token cannot rewrite plans or delete the account: read today's session plus `log_workout` only. Mirror the "one table" idea with a `WATCH_ROUTE_ACCESS` map, e.g. in `src/server/auth/tool-access.ts` or a sibling file, so an unclassified route throws at boot.
- **Per-request revocation.** The lookup function must return `status` on every request, the same way `assertActive` re-reads `arnold.account`, so a revoked device is out immediately.
- **No caching of device-token results** beyond the request. Or, if cached, keep the TTL to seconds and invalidate on revocation. Note the single-instance `--max-instances 1` limit in GUIDE „Grenzen“.

### Gaps

- No existing code or tests for non-JWT credentials. The onboarding "session secret" (256-bit, `OnboardingAccessControl`) is the only other credential type and could serve as a pattern for hashed secrets; not inspected in detail.

## 2. WorkOS: Device Authorization Grant (RFC 8628) vs. Arnold-issued device tokens

### Takeaway

WorkOS AuthKit does support the OAuth 2.0 Device Authorization Grant, which it calls "CLI Auth": announced June 2025, hosted AuthKit only, public clients with no secret. But its access tokens are short-lived JWTs (example `expires_in` 3600 s) with rotating single-use refresh tokens, and Arnold itself rejects any JWT with a lifetime over 24 h. The watch would therefore have to manage refresh-token rotation over the phone link. An Arnold-issued, revocable device token, created after the user confirms a pairing code on a WorkOS-protected web page, is simpler for Connect IQ and fits the existing "Arnold is resource server" model only with an explicit, small extension.

### Cited Findings

- AuthKit supports CLI Auth (device authorization flow). It requires hosted AuthKit, is unavailable for headless AuthKit, and needs no extra configuration. — [WorkOS changelog: CLI Auth](https://workos.com/changelog/cli-auth); [WorkOS docs: CLI Auth](https://workos.com/docs/authkit/cli-auth)
- Endpoints:
  - User Management: `POST https://api.workos.com/user_management/authorize/device`, then poll `/user_management/authenticate`.
  - Connect apps: `https://<authkit_domain>/oauth2/device_authorization` and `https://<authkit_domain>/oauth2/token`.
  - Grant type `urn:ietf:params:oauth:grant-type:device_code`.
  - Response fields `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in` (example 300 s), `interval` (example 5 s).
  - Polling errors `authorization_pending`, `slow_down`, `access_denied`, `expired_token`.
  - Public clients send only `client_id`, and Connect apps must be "Public applications".
    — [WorkOS docs: CLI Auth](https://workos.com/docs/authkit/cli-auth)
- The token response has `access_token` (JWT), `refresh_token` (opaque), `id_token`, `token_type: Bearer`, `expires_in` (example 3600). No `scope`, `resource` or `audience` parameter is documented for the device-code token request. — [WorkOS reference: device code grant](https://workos.com/docs/reference/workos-connect/cli-auth/device-code-grant.md)
- Refresh: replace the stored refresh token after every exchange; on `invalid_grant`, discard it and restart the device flow. — [WorkOS docs: CLI Auth](https://workos.com/docs/authkit/cli-auth). Refresh tokens are rotated (single use, short grace period), and refresh only works while the user's session is active (max session length and inactivity timeout are set in the dashboard). — [WorkOS session resilience](https://workos.com/docs/authkit/session-resilience.md); [WorkOS blog: session length / access token duration](https://workos.com/blog/session-length-access-token-duration-inactivity-timeout). The sources disagree slightly: the sessions doc says refresh tokens "may be rotated". — [WorkOS sessions](https://workos.com/docs/authkit/sessions.md)
- Arnold's verifier requires `aud` = MCP resource URL (`AUTH_AUDIENCE` defaults to `resourceUrl`), a lifetime of at most 24 h, and Arnold scopes from the `urn:arnold:scopes` JWT-template claim (`AUTH_SCOPE_CLAIM`). WorkOS is configured with a default Resource Indicator equal to the `/mcp` URL. — [src/server/auth/config.ts](src/server/auth/config.ts); [src/server/auth/token-verifier.ts](src/server/auth/token-verifier.ts); [docs/GUIDE.md](docs/GUIDE.md) („Hosting auf Google Cloud Run“)
- GUIDE: "Arnold ist Resource Server, kein Authorization Server: Es prüft Tokens, stellt keine aus." — [docs/GUIDE.md](docs/GUIDE.md)
- Connect IQ alternative: `Communications.makeOAuthRequest` opens a web view on the phone via a Garmin Connect Mobile notification and returns the result keys via `registerForOAuthMessages`. It works only over Bluetooth to a phone. `makeWebRequest` has `SECURE_CONNECTION_REQUIRED (-1001)` and `NETWORK_RESPONSE_TOO_LARGE (-402)` errors (no numeric limit on that page). — [Garmin Connect IQ Toybox.Communications](https://developer.garmin.com/connect-iq/api-docs/Toybox/Communications.html)

### Inferences

**Option A, WorkOS device grant:**

- Pros: no token issuance in Arnold; WorkOS handles login and MFA; it is standard.
- Cons:
  - The watch must store and rotate refresh tokens. A lost response during rotation over a flaky BT link means `invalid_grant` and re-pairing; the grace period helps but is short.
  - Hourly access-token expiry means the watch refreshes at nearly every workout.
  - Token lifetime is bounded by the WorkOS session max length and inactivity timeout, so the watch logs out after weeks of non-use.
  - It is unclear whether device-grant tokens carry the `/mcp` audience and the `urn:arnold:scopes` claim. If they do, a watch token would have full MCP power (`arnold.plan`, `arnold.account`), which is wrong for a watch.
  - A separate public Connect app is needed (client_id).
- Arnold side: it could reuse `ArnoldTokenVerifier`, but watch-specific scopes would need a separate audience or claim.

**Option B, Arnold-issued device token (recommended for the feasibility note):**

- Flow:
  1. The watch calls `POST /api/watch/v1/pair/start` (unauthenticated, rate-limited) and gets `device_code` (secret, kept on the watch) and `user_code` (8 chars, shown on the watch), with a TTL of about 10 min.
  2. The user opens `https://<arnold>/pair` on the phone. That page requires a WorkOS login, either via the MCP OAuth token or (more likely) a small AuthKit web login, which Arnold does not have today. The user types the code and confirms.
  3. The watch polls `POST /api/watch/v1/pair/token` and receives a long-lived opaque token, stored only as a hash.
  4. The token is revocable from Arnold (e.g. a new MCP tool `list_watch_devices` / `revoke_watch_device` under `ACCOUNT_MANAGEMENT`, or a button in the card).
- Pros: no refresh on the watch; least privilege (watch scopes only); revocation is in our DB.
- Cons: Arnold becomes a (mini) token issuer, which changes the "Resource Server only" principle in GUIDE. The pairing page needs a browser login flow (AuthKit hosted login with code exchange) that the server does not yet have; today it only verifies bearer JWTs.
- Shortcut: confirm pairing inside ChatGPT instead of a web page. A new MCP tool `confirm_watch_pairing({user_code})` under a new or `ACCOUNT_MANAGEMENT` class would use the existing WorkOS-verified MCP context, so no new web login is needed. The user says "Kopple meine Uhr, Code ABCD-1234". This reuses the existing auth fully and keeps "user id only from verified token".

### Gaps

- Not verified whether WorkOS device-grant access tokens honour the dashboard default Resource Indicator (`aud`) or include JWT-template claims. The docs do not document a `resource` parameter for this grant.
- Default WorkOS access-token duration and max session length for this tenant were not checked (dashboard setting).
- The Connect IQ response size limit in bytes is not on the API page (see the Garmin-specific research).

## 3. Plan data: what a training day looks like, "values from last time, else plan target", payload size

### Takeaway

A "training day" is a set of `plan_items` with the same `session_id` in the active `plan_versions` row. The ready-made watch payload already exists as `SessionProposal` (from `proposeSession` / `proposeActivePlan` in `src/server/workout/proposal.ts`). It carries, per exercise: conventions (`load_basis`, `execution_mode`, `implement_count`, `reps_basis`), concrete sets (`reps`, `load_kg`, `side`), `source` ∈ {progression, last_time, plan}, rep range and the progression explanation. It lacks `rest_seconds`, which is on `plan_items`. "Which day is today" is `nextSession` in `src/analytics/home.ts` (the session after the last completed one, cycling).

### Cited Findings

- `ArnoldPlanItemSchema` fields: `plan_item_id`, `plan_version_id`, `session_id`, `session_order`, `session_name`, `exercise_id`, `exercise_order`, `target_sets`, `rep_min`, `rep_max`, `target_load_kg`, `target_load_basis`, `target_execution_mode`, `target_implement_count`, `rest_seconds` (nonnegative int, nullable), `notes`, `status` (active|removed), `row_revision`. — [src/shared/arnold-schema-v1.ts](src/shared/arnold-schema-v1.ts) (l. 308–341)
- Enums:
  - `load_basis` ∈ total, per_implement, machine_display, added, assistance, bodyweight_only
  - `execution_mode` ∈ bilateral_simultaneous, unilateral, alternating
  - set `reps_basis` ∈ total, per_side
  - `side` ∈ both, left, right, alternating
  - `set_type` ∈ warmup, working, drop, failure, other
  - `source` ∈ chat, ui, manual_import, sync
    — [src/shared/arnold-schema-v1.ts](src/shared/arnold-schema-v1.ts)
- `rest_seconds` is validated at most 86 400 (`MAX_REST_SECONDS`), shown in the UI as "N s Pause", and defaults to 120 in the editor. — [src/server/plan/validation.ts](src/server/plan/validation.ts); [src/ui/components/plan/format.ts](src/ui/components/plan/format.ts); [src/ui/views/TrainingPlanEditorView.tsx](src/ui/views/TrainingPlanEditorView.tsx)
- `ProposedExerciseSchema` = `{plan_item_id, exercise_id, exercise_name, conventions{load_basis, execution_mode, implement_count, reps_basis}, sets[{reps, load_kg|null, side}], source: progression|last_time|plan, last_date, progression?, target_sets, rep_min, rep_max, missing: [sets|reps|load]}`. `SessionProposalSchema` = `{plan_version_id, session_id, session_name, session_order, exercises[]}`. No `rest_seconds` field. — [src/shared/workout-contract.ts](src/shared/workout-contract.ts) (l. 54–97)
- `proposeExercise(data, exercise, item, options)` is the "Training starten / So gemacht" function:
  1. If there is history (`pastSessions`, up to `PROGRESSION_HISTORY` sessions) and the plan item has a rep range, it calls `recommendProgression({sessions: comparable, load_basis, rep_min, rep_max, step_kg: weightStep(equipment, load_basis)})` → `source: "progression"`.
  2. Otherwise it uses last time's working sets → `source: "last_time"`.
  3. Without history it uses plan targets (`target_sets` × `rep_max ?? rep_min` × `target_load_kg`) → `source: "plan"`, and anything unknown goes in `missing`.
     Comparable history stops at a change of measure (`sameMeasure`). "log_workout builds its sets from the same function, so what the user saw is what is saved". — [src/server/workout/proposal.ts](src/server/workout/proposal.ts)
- `proposeSession(data, planVersionId, sessionId, options)` and `proposeActivePlan(data, before?)` (all sessions of the active plan). `get_workout` returns `proposals: proposeActivePlan(dataset)` inside `WorkoutContextSchema`, together with all active exercises, plans, plan_items and in-progress workouts. — [src/server/workout/proposal.ts](src/server/workout/proposal.ts); [src/server/mcp-workout.ts](src/server/mcp-workout.ts) (l. 51–130)
- Progression engine: `recommendProgression`, `weightStep`, `deloadLoad`, `stalledSessions`, `PROGRESSION_VERSION = "1.0.0"`. `ProgressionSchema` = `{version, decision, reason, change_kg, rep_min, rep_max, last_date, last_sets[{reps, load_kg}], stalled_sessions}`. Rules (double progression; increase / more_reps / reduce / top_reached; steps of 2.5 kg barbell/cable, 2 kg per dumbbell, 4 kg kettlebell, 5 kg machine) are documented in GUIDE. — [src/analytics/progression.ts](src/analytics/progression.ts); [docs/GUIDE.md](docs/GUIDE.md) („Fortschritt: Gewicht fürs nächste Training“)
- Start weights without history: `src/analytics/start-load.ts` is applied at onboarding (`onboarding/start-loads.ts`) and written into `target_load_kg`. — [docs/GUIDE.md](docs/GUIDE.md) („Einrichtung“)
- `nextSession(input)` takes the active plan's sessions ordered by `session_order`, finds the last completed workout of that plan (by `workout_date_local`, then `created_at_utc`), and returns the next session (wrapping around), or the first session if there is none. It returns `{plan_version_id, session_id, session_name, exercise_count}`, exposed as `home.next_session`. — [src/analytics/home.ts](src/analytics/home.ts) (l. 89–100, 318–360)
- Measured payload size (synthetic sample, 6 exercises × 4 sets, German names, UUID-length ids): a full `SessionProposal`-like JSON including the `progression` objects is about 4.9 KB. A slim watch DTO with short keys, `[reps, kg]` arrays and `rest_seconds` is about 0.7 KB. An upload body in `log_workout` shape with per-set values and timestamps is about 1.3 KB. — measured locally with a node script (no repo source; synthetic values)

### Inferences

- **Endpoint `GET /api/watch/v1/today`.** Load the dataset via `userRuntime.source.load()`, which is what `get_workout` does. Pick the session via the `nextSession` logic (or let the watch choose among `proposeActivePlan` sessions). Call `proposeSession(dataset, plan, session)` and map it to a slim DTO.
- **DTO contents:** `exercise_name`, `plan_item_id`, `exercise_id`, `conventions`, `sets[{reps, load_kg, side}]`, `rep_min`, `rep_max`, `source`, a short progression hint (`decision`, `change_kg`), and `rest_seconds` joined from the plan item.
- **Do not send the whole `WorkoutContext`.** It includes all plan_items, all exercises and all plans, which would be tens of KB for a real account.
- **Exercises with non-empty `missing`** (no history, no target weight) must be shown on the watch as "Gewicht eingeben" or blocked. `log_workout` refuses to save with missing values.
- **Wrapper or analytics?** `nextSession` lives in `src/analytics/home.ts` as a private function inside `buildHomeAnalytics`. The watch endpoint could call `buildHomeAnalytics` and read `next_session`, or the function could be exported. Per CLAUDE.md, metrics belong in `src/analytics`, and presenters must not recompute.
- **Pinning the proposal (important).** The proposal is recomputed at upload time from the data at that moment (see §4). If the watch fetched the day before and the user logged something else in between, "So gemacht" semantics may differ. A watch upload should therefore always send explicit per-set values, not rely on server-side defaults.

### Gaps

- The exact JSON size limit the FR255 can parse via `makeWebRequest` is not known from the repo (see the Garmin research).
- `PROGRESSION_HISTORY` constant value not checked (≤ 6 sessions per GUIDE).

## 4. Workout writing: log_workout, commitWrite, idempotency, per-set data, timestamps, heart rate

### Takeaway

`log_workout` (via `WorkoutLoggingService.execute("log_workout", raw, context)`) does one-shot logging in a single `commitWrite` transaction, with `request_id` idempotency. It supports per-set values (`exercises[].sets[{reps, load_kg, side}]`), swaps, skips and extra exercises. A watch upload can reuse it almost 1:1. A retry with the same `request_id` and identical body replays the stored result, so a double upload is safe. Missing pieces:

- `log_workout` hard-codes `started_at_utc`/`ended_at_utc = null`, `set_type = "working"`, `rpe/rir = null`;
- its input `source` enum only allows `chat|ui` (the DB schema allows `sync`);
- there is no heart-rate or rest-time field anywhere;
- `DUPLICATE_WORKOUT` fires if the same session name was already saved that day without `confirm_duplicate`.

### Cited Findings

- `WriteInputs.log_workout` = `{request_id (1–128 chars), workout_date_local (ISO date), timezone (IANA, validated with Intl), plan_version_id?, session_id?, same_as_last_time?: true, session_name?, exercises?: LogWorkoutExercise[≤30], replaces_workout_id?, expected_row_revision?, notes?, confirm_duplicate?: true, source?: "chat"|"ui", confirm_unusual_values?: true}`. `LogWorkoutExercise` = `{plan_item_id?, exercise_id?, skip?, sets?: [{reps, load_kg?, side?}] (1–30), set_count?, reps?, load_kg?, load_basis?}`. — [src/shared/workout-contract.ts](src/shared/workout-contract.ts) (l. 99–252)
- `start_workout` accepts `started_at_utc` and `complete_workout` accepts `ended_at_utc` (UTC with `Z`). `log_workout_sets` accepts full `LogSetSchema` incl. `set_type`, `rpe`, `rir`, `notes`, up to 100 sets. — [src/shared/workout-contract.ts](src/shared/workout-contract.ts)
- `execute(operation, raw, context)`:
  1. `actor(context)` (`AUTH_REQUIRED` / `PERMISSION_DENIED`);
  2. `WriteInputs[op].parse(raw)`;
  3. `fingerprint({operation, input})`;
  4. `commitWrite({trackerId, store, requestId, fingerprint, actorSubject: actor.subject, clock, build})`.
     It returns a `WriteResponse{ok, operation, request_id, replayed, result{workout, sets, …, warnings}, error{code, message, retryable, details, recovery}}`. Any non-WriteError, non-Zod error becomes `STORAGE_UNAVAILABLE` (retryable). — [src/server/workout/service.ts](src/server/workout/service.ts) (l. 192–310)
- `commitWrite` runs in one store transaction, serialised per user:
  - read and validate the dataset (`ArnoldDatasetSchema`), then `assertTracker`;
  - `tx.operation(requestId)`: if found with a different fingerprint or actor → `DUPLICATE_OPERATION`; else `assertReceiptHolds` and return `{result, replayed: true}`;
  - else build, `changedDataset` (full contract), and `tx.commit` (changes + audit + receipt).
    `STORAGE_RETRY_MESSAGE` tells the caller to resend the same request_id. — [src/server/plan/commit.ts](src/server/plan/commit.ts)
- `assertReceiptHolds` throws `SCHEMA_MISMATCH` if rows from the receipt were later changed or vanished. A replay after the workout was edited or voided therefore does not return the old result. — [src/server/plan/commit.ts](src/server/plan/commit.ts)
- Receipts (`arnold.operations`) are pruned after `ARNOLD_JOURNAL_RETENTION_DAYS`, default 30 (`DEFAULT_RETENTION_DAYS`), by `arnold.prune`. — [src/server/account/retention.ts](src/server/account/retention.ts); [db/migrations/001_arnold.sql](db/migrations/001_arnold.sql)
- The `log_workout` build:
  - `DATE_IN_FUTURE` if `workout_date_local` is after today in `input.timezone`;
  - `replaces_workout_id` needs `expected_row_revision` and a completed workout, and voids the old one in the same transaction;
  - `planSession(...)`, then `proposeSession(..., {excludeWorkoutId, progression: !same_as_last_time})`, then `applyChanges(data, proposal, exercises, options)`;
  - missing values → `VALIDATION_ERROR` listing them;
  - `assertUsualValues` (`UNUSUAL_SET_LIMITS` load_kg 500, reps 100 → `CONFIRMATION_REQUIRED`);
  - at least one set with reps > 0;
  - `DUPLICATE_WORKOUT` if a completed workout with the same normalised `session_name_snapshot` exists on the same `workout_date_local` and `confirm_duplicate` is not set.
    The workout row has `status: "completed"`, `started_at_utc: null`, `ended_at_utc: null`, `source: input.source ?? "chat"`. Sets get `set_type: "working"`, `rpe: null`, `rir: null`, `notes: null`, and `set_number` counted per side. — [src/server/workout/service.ts](src/server/workout/service.ts) (l. 744–910)
- `applyChanges`: explicit `sets` replace the proposal's sets for that plan item. A swap never carries a weight over. An extra exercise (no `plan_item_id`) must bring its own weight. Weight given for a bodyweight exercise → `VALIDATION_ERROR`. — [src/server/workout/log-workout.ts](src/server/workout/log-workout.ts)
- `arnold.workouts` columns: `workout_date_local` (text, checked `YYYY-MM-DD`), `timezone`, `started_at_utc`, `ended_at_utc`, `plan_version_id`, `session_id`, `session_name_snapshot`, `status`, `source`, `notes`. `arnold.sets` columns: `set_type`, `reps`, `reps_basis`, `load_kg`, `load_basis`, `implement_count`, `execution_mode`, `side`, `rpe`, `rir`, `notes`, `status`, `source`. No heart-rate, duration, rest or timestamp-per-set columns. — [db/migrations/001_arnold.sql](db/migrations/001_arnold.sql); [src/shared/arnold-schema-v1.ts](src/shared/arnold-schema-v1.ts) (l. 342–412)
- A repo-wide grep for `heart`, `garmin`, `watch` and `rest_seconds` finds only plan-editor `rest_seconds` usage and a UI heart icon; there is no heart-rate data model. — repo grep over `src/`
- GUIDE: "Kalendertage kommen wörtlich aus `workout_date_local`"; "unbekannte Last ist unbekannt, nicht null". — [docs/GUIDE.md](docs/GUIDE.md); [CLAUDE.md](CLAUDE.md)

### Inferences

- **Idempotency for double uploads.** The watch generates `request_id` once per finished workout (e.g. `garmin-<uuid>`), persists it with the result in watch storage, and resends byte-identical JSON. The server replays with `replayed: true`.
  - Caveat: the fingerprint covers the whole parsed input. If the watch changes anything on retry (a new `ended_at`, a re-serialised float), it gets `DUPLICATE_OPERATION`. The watch must freeze the payload.
  - Caveat: after 30 days the receipt is pruned. A very late retry would then create a second workout, unless `DUPLICATE_WORKOUT` catches it (same session name, same day) and returns an error the watch must treat as "already saved".
- **What the REST layer should do on upload:**
  - set `source` to a new value (`"sync"` exists in `ArnoldSourceSchema`, or add `"watch"`); this needs widening the `log_workout` input enum or a server-side override (not caller-controlled);
  - always send explicit `sets` per plan item, so the stored values are what the watch recorded and do not depend on a proposal recomputed at upload time.
- **`DUPLICATE_WORKOUT` vs. watch retries:** with the same request_id the receipt replay happens before the build, so no `DUPLICATE_WORKOUT`. A second, different upload for the same session/day gets `DUPLICATE_WORKOUT`, and the watch has no user to ask. Policy needed: show "schon gespeichert" on the watch, or offer replace/additional on the phone or in chat.
- **Missing for a watch:**
  1. timestamps: `log_workout` ignores start/end; small change: accept optional `started_at_utc`/`ended_at_utc` and validate start ≤ end, as `complete_workout` already does;
  2. `set_type` (warm-up sets) and `rir`/`rpe` per set: `QuickSetSchema` only has reps, load_kg, side;
  3. actual rest durations and per-set timestamps: no columns;
  4. heart rate (avg/max, samples): no field at all; would need a new table, sensitive health data (GDPR Art. 9), and GUIDE states „Gesundheitsdaten werden nicht erfragt“.
- **Alternative:** the set-by-set path (`start_workout` → `log_workout_sets` → `complete_workout`) already supports `started_at_utc`, `ended_at_utc`, `set_type`, `rpe`, `rir`. But it takes three or more writes, each with its own request_id and `expected_row_revision` chaining, which is fragile offline. One-shot `log_workout` is the better fit for "upload later".
- **`workout_date_local` and `timezone`** must come from the watch's local clock and time zone at workout start (Connect IQ `Time` / system time zone). The server must not derive them from UTC.
- **Setup gate:** writes require completed onboarding (`PERMISSION_DENIED` "Zuerst die Einrichtung abschließen").

### Gaps

- Whether Connect IQ serialises floats like `62.5` deterministically across retries was not checked. That matters for fingerprint equality, but storing the exact request string on the watch avoids it.
- `fingerprint()` implementation (canonical JSON?) not inspected in detail.

## 5. HTTP layer: adding /api/watch/v1, middleware, rate limiting, logging, CORS, health

### Takeaway

`createHttpApp` in `src/server/http.ts` is a plain Express app from `createMcpExpressApp`. It has Host-header allowlisting, `express.json` (default 100 KB limit), a global middleware for nosniff, `no-store` and Origin checks (requests without Origin pass), `/health`, the legal pages, `/preview`, `/host` and `/mcp`. A watch router can be mounted before the 404 handler, like `/mcp`. **There is no rate limiting anywhere.** Logging is structured but MCP-tool-centric (`logToolCall`, `logServerError`, `logProtocolStep`).

### Cited Findings

- Middleware order:
  - `createMcpExpressApp({host, allowedHosts, allowedOrigins})` (DNS-rebinding/Host protection, `express.json`);
  - `x-powered-by` disabled;
  - `trust proxy` from `TRUST_PROXY` (Cloud Run: 1);
  - global middleware: `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, and 403 if `Origin` is present and neither same-origin nor in `ALLOWED_ORIGINS`; CORS headers only when Origin is present; `OPTIONS` → 204;
  - `auth.metadataRouter`, `/health`, legal pages, `/`, `/preview`, `/host`, `app.all("/mcp", auth.bearerGate, …)`, a 404 JSON handler, and an error handler (400 bad JSON, 413 too large, 500 generic, never echoing the body).
    — [src/server/http.ts](src/server/http.ts)
- `createMcpExpressApp` calls `express.json(jsonLimit ? {limit: jsonLimit} : undefined)`, so Express's default limit applies unless `jsonLimit` is passed. — node_modules/@modelcontextprotocol/express/dist/index.cjs (l. 179)
- `/health` returns `{status, app, auth, synthetic, source, ui_contract, version: "0.5.0", release}`. The audit notes it does not check DB reachability. — [src/server/http.ts](src/server/http.ts); [docs/audits/backend-readiness-2026-11-06.md](docs/audits/backend-readiness-2026-11-06.md)
- `http.ts`, `bootstrap.ts` and `docs/BETRIEB.md` contain no rate-limit middleware (grep for "rate|limit" finds only the Origin comment and a log query `--limit 50`). — repo grep
- Cloud Run: service `arnold`, `europe-west1`, 1 CPU, 512 MiB, max 1 instance, up to 80 concurrent requests. — [docs/audits/backend-readiness-2026-11-06.md](docs/audits/backend-readiness-2026-11-06.md); single-instance limit also in [docs/GUIDE.md](docs/GUIDE.md) („Grenzen“)
- Startup safety: `requireSafeArnoldBinding({synthetic, authenticated, host, allowedHosts, allowedOrigins})`, and a database requires `auth.summary.mode === "oidc"` with the same auth surface as the runtime. — [src/server/http.ts](src/server/http.ts)

### Inferences

- **Mount point and wiring.** Add `src/server/watch/router.ts` exporting `buildWatchRouter({database, deviceAuth, auth})`, mounted in `createHttpApp` only when `options.database` is set (fail closed: no route in fixture/open mode, unless a synthetic sandbox mode is wanted for tests). Mount it after `/health` and before the 404, e.g. `app.use("/api/watch/v1", watchRouter)`.
- **Handler pattern:**
  1. `deviceAuth.resolve(req)` → `AuthenticatedArnoldContext`;
  2. `const rt = await options.database.forUser(context)`;
  3. for writes, `options.database.exclusive(context, () => rt.service.execute("log_workout", mapped, context))`;
  4. for reads, `withArnoldContext(context, () => rt.source.load())`.
     This reuses the existing per-user serialisation and AsyncLocalStorage.
- **Watch requests** via Garmin Connect Mobile presumably have no `Origin` header, so they pass the Origin check. The `Host` header must be the Cloud Run hostname, which is already in `ALLOWED_HOSTS`. No CORS change is needed.
- **New pieces needed:**
  - rate limiting, at minimum for the unauthenticated pairing endpoints (brute force on `user_code`) and per device token (an in-memory token bucket works with 1 instance; multi-instance would need DB or Cloud Armor);
  - a per-route JSON limit (e.g. 32 KB);
  - structured logs analogous to `logToolCall` (route, outcome, ms, `user`, `code`; never the token or body), also covered by the `tests/log-privacy.test.ts` pattern;
  - the `WWW-Authenticate: Bearer` 401 shape with a generic body.
- **Content-Type:** Connect IQ `makeWebRequest` defaults to form-urlencoded for POST unless `REQUEST_CONTENT_TYPE_JSON` is set. Express only parses JSON globally, so require `application/json` and return 415 otherwise.
- **Versioning:** `/api/watch/v1` plus a DTO Zod contract in a new `src/shared/watch-contract.ts` (CLAUDE.md convention: contracts as Zod in `src/shared/*-contract.ts`).

### Gaps

- No evidence of Cloud Armor or other edge rate limiting in deploy scripts (`scripts/deploy-cloud-run.sh` not inspected in detail).

## 6. Database: migrations, schema version, RLS conventions, new tables needed

### Takeaway

Migrations are numbered SQL files (`001_arnold.sql`, `002_goals_body_weight.sql`), and `EXPECTED_SCHEMA_VERSION` in `src/server/db/database.ts` is currently 2. The server refuses to start on a mismatch. Each user table has `user_id` FK → `arnold.users ON DELETE CASCADE`, RLS with policy `own_rows` (USING and WITH CHECK `user_id = arnold.current_user_id()`), composite FKs including `user_id`, minimal grants to `arnold_app` (no DELETE on training data), and revokes for `anon`/`authenticated`. A watch needs migration `003_watch_devices.sql` (version → 3) with `watch_devices` and `watch_pairings`, plus SECURITY DEFINER lookup functions. `health_samples` should not be added (or only after a privacy decision).

### Cited Findings

- 001 header explains the four isolation layers, and that pre-auth account lookup runs via one SECURITY DEFINER function "instead of giving the server role read access to all accounts". RLS loop over 10 tables with `own_rows`. Grants:
  - `select, insert, update` on training tables;
  - `select, insert, update, delete` on `onboarding_sessions`;
  - `select, insert` on `operations`/`audit_events`;
  - `select, delete` on `users`/`identity_connections`.
    `anon`/`authenticated` are revoked. — [db/migrations/001_arnold.sql](db/migrations/001_arnold.sql)
- 002 is a template for adding tables: `user_id … on delete cascade`, a `seq bigint generated always as identity`, text ids, `*_at_utc` text timestamps, `row_revision`, partial unique indexes, an RLS loop, grants, and an anon/authenticated revoke. — [db/migrations/002_goals_body_weight.sql](db/migrations/002_goals_body_weight.sql)
- Procedure: new file `db/migrations/NNN_name.sql`, bump `EXPECTED_SCHEMA_VERSION`, `npm run db:migrate` with `DATABASE_ADMIN_URL`, and migrate before deploy. — [docs/GUIDE.md](docs/GUIDE.md); [CLAUDE.md](CLAUDE.md); BETRIEB note in [docs/BETRIEB.md](docs/BETRIEB.md) (l. 20)
- Live: RLS and `own_rows` on all twelve user tables; `arnold_app` has neither superuser nor BYPASSRLS. — [docs/audits/backend-readiness-2026-11-06.md](docs/audits/backend-readiness-2026-11-06.md)
- `DatabaseArnoldRuntime.storedData` lists what is stored per user (account, training_data, setup, write_journal, audit_log) for `get_arnold_stored_data`. — [src/server/db/runtime.ts](src/server/db/runtime.ts)
- Account deletion cascades from `arnold.users` in one statement. — [docs/GUIDE.md](docs/GUIDE.md); [src/server/db/runtime.ts](src/server/db/runtime.ts) (`deleteAccount`)

### Inferences

- **`arnold.watch_devices`:**
  - columns: `user_id` FK cascade; `device_id text` (`wdv_<uuid>`); `token_hash bytea unique` (sha256 of a 256-bit random token); `label` (e.g. "Forerunner 255"); `scopes text[]`; `status` (active|revoked); `created_at`, `last_used_at`, `revoked_at` (timestamptz);
  - PK `(user_id, device_id)`, RLS `own_rows`, grant `select, insert, update` (revoke = update status, no delete);
  - lookup by hash pre-auth via `arnold.resolve_device_token(p_hash bytea)`: SECURITY DEFINER, `search_path=''`, returns `user_id, device_id, scopes, status` only for active devices and active users; touches `last_used_at` at most hourly, like `resolve_identity`.
- **`arnold.watch_pairings`:**
  - columns: `pairing_id`; `device_code_hash` (unique); `user_code_hash` (unique while pending); `status` (pending|approved|consumed|expired); `user_id null` until approved; `expires_at`; `attempts`;
  - these rows exist before a user is known, so either no `user_id` (an exception to "every user table has user_id"; it would need SECURITY DEFINER functions `start_pairing`, `approve_pairing(user_code, …)` executed under `asUser`, and `redeem_pairing(device_code_hash)`), or the pairing state kept in memory only (acceptable with `--max-instances 1`, lost on restart; like the existing deletion tokens);
  - pruning via `arnold.prune` extension.
- **Health data:** `health_samples` is not recommended in v1. The current product explicitly avoids health data, and heart-rate data is special-category data under GDPR. If needed later: a separate table with `user_id`, `workout_id` FK `(user_id, workout_id)`, aggregate columns (avg_hr, max_hr, duration_s) rather than raw samples, RLS, and an entry in `storedData`.
- **Also update:** `storedData` (new item "Gekoppelte Uhren"), the deletion summary, `tests/db-security.test.ts` table list (RLS on all user tables), and the `arnold.prune` retention for pairings.

### Gaps

- `arnold.schema_migrations` handling in `src/server/db/migrate.ts` not read in detail.

## 7. Tests that would cover a watch API

### Takeaway

The repo already has every test harness needed: real HTTP + real token verification + embedded Postgres end-to-end (`tests/db-journey.test.ts`), RLS/role checks (`tests/db-security.test.ts`), auth HTTP behaviour with locally signed JWTs (`tests/auth-http.test.ts`, `tests/fixtures/arnold-auth.ts`), log_workout semantics (`tests/workout-quick-log.test.ts`), idempotency in the store (`tests/db-store.test.ts`), the HTTP surface (`tests/http-surface.test.ts`) and log privacy (`tests/log-privacy.test.ts`).

### Cited Findings

- `tests/db-journey.test.ts`: "real HTTP, real MCP, real token verification and the real Postgres. Two people use Arnold at the same time; neither ever sees the other". Uses `createHttpApp`, `buildAuthSurface`, `loadAuthConfig`, `PostgresIdentityRepository`, `DatabaseArnoldRuntime`, and `node:http createServer`. — [tests/db-journey.test.ts](tests/db-journey.test.ts)
- Fixtures:
  - `tests/fixtures/arnold-auth.ts`: `TEST_ISSUER`, `TEST_AUDIENCE`, `makeRsaKey`, `makeEcKey`, `signJwt`, `validClaims`, `tamperSignature`, `tamperClaims`, `jwksDocument`, `jwksServer`;
  - `tests/fixtures/arnold-db.ts`: `appDatabase`, `asOwner`, `newAccount`, `benchSet`, `logOneSet`.
    — [tests/fixtures/arnold-auth.ts](tests/fixtures/arnold-auth.ts); [tests/fixtures/arnold-db.ts](tests/fixtures/arnold-db.ts)
- Describe blocks: `db-security.test.ts` ("row level security", "accounts", "connection settings", "server connection for Supabase"); `http-surface.test.ts` ("routes and request protection"); `workout-quick-log.test.ts` ("log_workout: a whole workout in one step", "void_workout…"). — repo
- `npm test` starts embedded Postgres for `tests/db-*`; `npm run check` = build, typecheck, Vitest, Playwright. The audit reports 74 Vitest files / 1,273 tests and 100 Playwright tests green. — [CLAUDE.md](CLAUDE.md); [docs/audits/backend-readiness-2026-11-06.md](docs/audits/backend-readiness-2026-11-06.md)

### Inferences

- **`tests/db-watch-devices.test.ts`:**
  - RLS on the new tables; `arnold_app` cannot read other users' devices;
  - `resolve_device_token` returns nothing for revoked devices or disabled users;
  - cascade on account deletion.
- **`tests/watch-http.test.ts`** (pattern from `db-journey` + `auth-http`):
  - 401 without, with a wrong, or with a revoked token;
  - a device token is refused on `/mcp` and a WorkOS JWT is refused on `/api/watch/v1`;
  - two users' devices never see each other's day;
  - `GET today` matches `proposeSession`;
  - a double upload with the same request_id gives one workout and `replayed: true`;
  - a changed body with the same id gives `DUPLICATE_OPERATION`;
  - `DUPLICATE_WORKOUT` handling;
  - `DATE_IN_FUTURE` with the watch timezone;
  - setup not done → refused;
  - pairing brute-force limit and expiry.
- **`tests/watch-contract.test.ts`:** DTO size budget (e.g. assert < 2 KB for a 6×4 day) and Zod round-trip.
- **Extend `tests/log-privacy.test.ts`** so tokens, user codes and bodies never appear in logs.
- **If a pairing MCP tool is added:** add it to `TOOL_ACCESS`, `tests/auth-tool-access.test.ts`, `tests/tool-annotations.test.ts`, and the plugin-skill checks if skills mention it.

### Gaps

- `tests/e2e` Playwright patterns not inspected (likely irrelevant for a REST API).

## 8. Audits / readiness relevant to opening a new endpoint

### Takeaway

The 6 Nov 2026 backend-readiness audit gave **no go** for the beta start on 9 Nov. The reasons were three onboarding retry bugs (P1), missing alerting (P1), a live release behind `main` (P1), and unproven backups. It found no P0 data loss or cross-account access and confirmed RLS live. Opening a new public endpoint adds attack surface on a service that, per that audit, still lacked monitoring, had no rate limiting, and had a `/health` check that does not test the DB.

### Cited Findings

- „Entscheidung: aktuell kein Go für einen reibungslosen Beta-Start.“ Findings:
  1. reopening locks an open onboarding card (P1);
  2. onboarding retries are not idempotent (`REVISION_CONFLICT` before replay; partial confirm state) (P1);
  3. documented alerts and uptime checks not set up (`alertPolicies` and `uptimeCheckConfigs` empty) (P1);
  4. live release `2edfeb7` two commits behind `main` (P1).
     Backup/restore was not proven (Supabase Free per BETRIEB). — [docs/audits/backend-readiness-2026-11-06.md](docs/audits/backend-readiness-2026-11-06.md)
- Positive results:
  - workout and plan writes are atomic;
  - local load test: 30 parallel users, 600 sets with no duplicates, every cross-account access refused; median 66 ms, p95 95 ms;
  - `npm audit --omit=dev` found 0 vulnerabilities; Supabase advisors had no findings.
    The load test is local only, not production capacity. — [docs/audits/backend-readiness-2026-11-06.md](docs/audits/backend-readiness-2026-11-06.md)
- „/health prüft nur den laufenden Prozess, nicht die Erreichbarkeit der Datenbank“; tool alarms only capture `outcome=thrown`. — [docs/audits/backend-readiness-2026-11-06.md](docs/audits/backend-readiness-2026-11-06.md)
- Not proven per GUIDE: acceptance with real Supabase and the ChatGPT host after the rebuild, load tests, backup restore, Safari/Firefox/mobile. — [docs/GUIDE.md](docs/GUIDE.md) („Grenzen“)

### Inferences

- **Before a watch endpoint goes live:**
  - set up monitoring (`scripts/setup-monitoring.sh`) and extend the alerts to the watch routes' error rates;
  - add rate limiting (pairing endpoints especially);
  - decide on the auth model (§2) and record it in GUIDE, since it changes the "Resource Server only" statement;
  - add device listing and revocation to the account surface (`get_arnold_stored_data`, deletion summary).
- **The audit's idempotency findings were onboarding-only.** The workout `commitWrite` replay path, which a watch would use, is the part the audit and the tests show as solid ("Wiederholungen" in `db-store`, the load test repeating the same write).
- **The watch "upload later, maybe twice" scenario** maps directly onto the proven `request_id` replay. The residual risks are the 30-day receipt pruning, `SCHEMA_MISMATCH` on replay after an edit, and `DUPLICATE_WORKOUT` for a second distinct upload.

### Gaps

- Whether the audit's P1 items were fixed after 6 Nov was not checked (git log shows only skill/plugin commits since; `docs/audits/` is untracked in git status).
