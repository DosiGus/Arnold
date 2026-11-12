/**
 * The watch API `/api/watch/v1` (UMSETZUNG §3.1, §5, §6).
 *
 * One router for every watch route. In order, each request passes: JSON-only
 * body (415) within 64 KB (413), the route's rate limit (429 with
 * Retry-After), the watch token for non-pairing routes (401, or 503 when the
 * database cannot answer), the route's scope, and then the handler in the
 * user's context: writes serialised per user (`exclusive`), reads in
 * `withArnoldContext`. Errors always have the §3.1 shape and never say whether
 * a token exists. One log line per request: route pattern, status, outcome,
 * duration, internal user id and error code; never tokens, codes or bodies.
 */
import {
  Router,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { IncomingHttpHeaders } from "node:http";
import {
  requireWatchRouteAccess,
  type WatchRouteAccess,
} from "../auth/tool-access.js";
import {
  WATCH_SCOPES,
  WatchAuthError,
  WatchTokenVerifier,
  type WatchPrincipal,
} from "../auth/watch-token.js";
import { withArnoldContext } from "../auth/guarded-server.js";
import type { DatabaseArnoldRuntime } from "../db/runtime.js";
import { healthRoutes } from "./health.js";
import { pairingRoutes } from "./pairing.js";
import { planRoutes } from "./plan.js";
import { workoutRoutes } from "./workouts.js";
import { safeCode, toolLogEnabled } from "../tool-log.js";
import {
  WATCH_API_VERSION,
  WATCH_BODY_LIMIT_BYTES,
  WATCH_MIN_APP_VERSION,
} from "../../shared/watch-contract.js";
import type { z } from "zod";
import type { WatchErrorCodeSchema } from "../../shared/watch-contract.js";

export const WATCH_BASE_PATH = "/api/watch/v1";

export type WatchErrorCode = z.infer<typeof WatchErrorCodeSchema>;
export type WatchLanguage = "de" | "en";

/** Fields every watch response carries. */
export const watchEnvelope = () => ({
  api_version: WATCH_API_VERSION,
  min_app_version: WATCH_MIN_APP_VERSION,
});

/** A refusal with a §3.1 code. Handlers throw this; nothing else is shown. */
export class WatchApiError extends Error {
  constructor(
    readonly code: WatchErrorCode,
    readonly status: number,
    readonly retryable = false,
    readonly headers: Record<string, string> = {},
    /** Short slug for the log only (never shown to the watch, no values). */
    readonly reason?: string,
  ) {
    super(code);
    this.name = "WatchApiError";
  }
}

const MESSAGES: Record<WatchErrorCode, Record<WatchLanguage, string>> = {
  AUTH_REQUIRED: {
    de: "Uhr ist nicht verbunden. Bitte neu verbinden.",
    en: "Watch is not connected. Please connect again.",
  },
  UPGRADE_REQUIRED: {
    de: "Bitte die Arnold-App auf der Uhr aktualisieren.",
    en: "Please update the Arnold app on your watch.",
  },
  RATE_LIMITED: {
    de: "Zu viele Anfragen. Bitte kurz warten.",
    en: "Too many requests. Please wait a moment.",
  },
  SETUP_REQUIRED: {
    de: "Schließe zuerst die Einrichtung in ChatGPT ab.",
    en: "Finish the setup in ChatGPT first.",
  },
  NO_ACTIVE_PLAN: {
    de: "Kein aktiver Trainingsplan. Lege ihn in ChatGPT an.",
    en: "No active training plan. Create one in ChatGPT.",
  },
  DUPLICATE_WORKOUT: {
    de: "Dieses Training ist schon gespeichert.",
    en: "This workout is already saved.",
  },
  DUPLICATE_OPERATION: {
    de: "Diese Anfrage wurde mit anderem Inhalt schon gesendet.",
    en: "This request was already sent with different content.",
  },
  VALIDATION_ERROR: {
    de: "Die Anfrage ist ungültig.",
    en: "The request is invalid.",
  },
  CONSENT_REQUIRED: {
    de: "Messwerte werden nur mit deiner Einwilligung gespeichert.",
    en: "Health data is stored only with your consent.",
  },
  WORKOUT_PENDING: {
    de: "Das Training ist noch nicht angekommen. Später erneut senden.",
    en: "The workout has not arrived yet. Send again later.",
  },
  CONFIRMATION_REQUIRED: {
    de: "Ungewöhnliche Werte. Bitte bestätigen.",
    en: "Unusual values. Please confirm.",
  },
  SCHEMA_MISMATCH: {
    de: "Das Training wurde inzwischen geändert.",
    en: "The workout has been changed in the meantime.",
  },
  STORAGE_UNAVAILABLE: {
    de: "Arnold ist gerade nicht erreichbar. Später erneut versuchen.",
    en: "Arnold is unavailable right now. Try again later.",
  },
  DATE_IN_FUTURE: {
    de: "Das Datum liegt in der Zukunft.",
    en: "The date is in the future.",
  },
};

export function watchErrorMessage(
  code: WatchErrorCode,
  lang: WatchLanguage,
): string {
  return MESSAGES[code][lang];
}

/** de when the first preferred language is German, otherwise en (07 D-04). */
export function watchLanguage(header: string | undefined): WatchLanguage {
  return /^\s*de\b/i.test(header ?? "") ? "de" : "en";
}

/**
 * Fixed-window counters in memory (07 D-15: one instance). Old windows are
 * dropped once the map grows, so memory stays bounded.
 */
export class MemoryRateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  /** Counts one hit; `retryAfterS` is set when the limit is exceeded. */
  hit(
    key: string,
    limit: number,
    windowMs: number,
  ): { allowed: boolean; retryAfterS: number } {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      if (this.windows.size >= 10_000) this.prune(now);
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return window.count <= limit
      ? { allowed: true, retryAfterS: 0 }
      : {
          allowed: false,
          retryAfterS: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
        };
  }

  /** True while `key` is still within `limit` in its current window. */
  peek(key: string, limit: number): boolean {
    const window = this.windows.get(key);
    return !window || window.resetAt <= this.now() || window.count < limit;
  }

  private prune(now: number) {
    for (const [key, window] of this.windows)
      if (window.resetAt <= now) this.windows.delete(key);
  }
}

/** UMSETZUNG §5. */
export const WATCH_RATE_LIMITS = {
  pairStartPerIpHour: 10,
  /** One poll per 5 s per address and hour; slow_down is the database's. */
  pairTokenPerIpHour: 720,
  perDeviceMinute: 120,
  /** Failed token checks per address (M037): random tokens never flood the database. */
  failedAuthPerIpMinute: 60,
} as const;

export interface WatchCall {
  params: Record<string, string>;
  body: unknown;
  headers: IncomingHttpHeaders;
  lang: WatchLanguage;
  ip: string;
  /** Set for WATCH_READ and WATCH_WRITE routes, never for pairing. */
  principal?: WatchPrincipal;
}

export interface WatchReply {
  status?: number;
  /** Omitted for 204/304. */
  body?: unknown;
  headers?: Record<string, string>;
}

export interface WatchRoute {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  handler: (call: WatchCall) => Promise<WatchReply>;
}

export interface WatchApiOptions {
  runtime: DatabaseArnoldRuntime;
  /** Defaults to the product routes (`watchRoutes`). Tests inject their own. */
  routes?: WatchRoute[];
  limiter?: MemoryRateLimiter;
  verifier?: WatchTokenVerifier;
}

/** The product routes. Each task wires its own handlers here. */
export function watchRoutes(runtime: DatabaseArnoldRuntime): WatchRoute[] {
  return [
    ...pairingRoutes(runtime),
    ...planRoutes(runtime),
    ...workoutRoutes(runtime),
    ...healthRoutes(runtime),
  ];
}

const REQUIRED_SCOPES: Record<WatchRouteAccess, readonly string[]> = {
  WATCH_PAIRING: [],
  WATCH_READ: [WATCH_SCOPES.read],
  WATCH_WRITE: [WATCH_SCOPES.read, WATCH_SCOPES.write],
};

interface WatchLogEvent {
  route: string;
  status: number;
  outcome: "ok" | "error" | "refused" | "thrown";
  ms: number;
  user?: string;
  code?: string;
  reason?: string;
}

/** Same switch and shape as logToolCall: ARNOLD_TOOL_LOG=json. */
export function logWatchRequest(event: WatchLogEvent): void {
  if (!toolLogEnabled()) return;
  const severity =
    event.outcome === "ok"
      ? "INFO"
      : event.outcome === "thrown"
        ? "ERROR"
        : "WARNING";
  console.log(
    JSON.stringify({
      severity,
      message: `watch ${event.route}`,
      ...event,
      ...(event.code ? { code: safeCode(event.code) } : {}),
      ...(event.reason ? { reason: safeCode(event.reason) } : {}),
    }),
  );
}

function sendError(
  res: Response,
  lang: WatchLanguage,
  error: WatchApiError,
): void {
  for (const [name, value] of Object.entries(error.headers))
    res.setHeader(name, value);
  res.locals.watchCode = error.code;
  if (error.reason) res.locals.watchReason = error.reason;
  res.status(error.status).json({
    ...watchEnvelope(),
    error: {
      code: error.code,
      retryable: error.retryable,
      message: watchErrorMessage(error.code, lang),
    },
  });
}

const unauthenticated = () => new WatchApiError("AUTH_REQUIRED", 401);
const unavailable = () => new WatchApiError("STORAGE_UNAVAILABLE", 503, true);
const rateLimited = (retryAfterS: number) =>
  new WatchApiError("RATE_LIMITED", 429, true, {
    "Retry-After": String(retryAfterS),
  });

/** Last app version / part number stored per device; the write happens on change only. */
const knownDevices = new Map<string, string>();

/**
 * `X-Arnold-Watch: <app-version>/<part-number>` is stored on the device row so
 * the account card and support see which build and watch model it is. Best
 * effort: a failed write never fails the watch request.
 */
export async function rememberDevice(
  runtime: DatabaseArnoldRuntime,
  principal: WatchPrincipal,
  header: string | undefined,
): Promise<void> {
  const [version, part] = (header ?? "").split("/").map((v) => v.trim());
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return;
  const partNumber = part && /^[0-9A-Za-z-]{1,32}$/.test(part) ? part : null;
  const key = `${principal.deviceId} ${version} ${partNumber ?? ""}`;
  if (knownDevices.get(principal.deviceId) === key) return;
  try {
    await runtime.options.db.asUser(principal.context.userId, (c) =>
      c.query(
        `update arnold.watch_devices set app_version = $3, part_number = coalesce($4, part_number)
          where user_id = $1 and device_id = $2
            and (app_version is distinct from $3 or part_number is distinct from coalesce($4, part_number))`,
        [principal.context.userId, principal.deviceId, version, partNumber],
      ),
    );
    knownDevices.set(principal.deviceId, key);
  } catch {
    // Metadata only; tried again on the next request.
  }
}

function bodyTooLarge(req: Request): boolean {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > WATCH_BODY_LIMIT_BYTES)
    return true;
  // Chunked bodies carry no length; the parsed body is measured instead.
  return (
    req.body !== undefined &&
    Buffer.byteLength(JSON.stringify(req.body)) > WATCH_BODY_LIMIT_BYTES
  );
}

export function createWatchRouter(options: WatchApiOptions): Router {
  const runtime = options.runtime;
  const limiter = options.limiter ?? new MemoryRateLimiter();
  const verifier =
    options.verifier ??
    new WatchTokenVerifier({
      db: runtime.options.db,
      auth: runtime.options.auth,
    });
  const router = Router();
  for (const route of options.routes ?? watchRoutes(runtime)) {
    // Throws for an unclassified route, so the server does not start.
    const access = requireWatchRouteAccess(route.method, route.path);
    const name = `${route.method} ${route.path}`;
    const register = {
      GET: router.get,
      POST: router.post,
      PUT: router.put,
      DELETE: router.delete,
    }[route.method].bind(router);
    register(route.path, async (req: Request, res: Response) => {
      const started = performance.now();
      const lang = watchLanguage(req.get("accept-language"));
      let principal: WatchPrincipal | undefined;
      let thrown = false;
      res.on("finish", () =>
        logWatchRequest({
          route: name,
          status: res.statusCode,
          outcome: thrown
            ? "thrown"
            : res.statusCode < 400
              ? "ok"
              : res.statusCode === 401 || res.statusCode === 429
                ? "refused"
                : "error",
          ms: Math.round(performance.now() - started),
          ...(principal ? { user: principal.context.userId } : {}),
          ...(res.locals.watchCode ? { code: res.locals.watchCode } : {}),
          ...(res.locals.watchReason ? { reason: res.locals.watchReason } : {}),
        }),
      );
      try {
        if (route.method === "POST" || route.method === "PUT") {
          if (!req.is("application/json"))
            throw new WatchApiError("VALIDATION_ERROR", 415);
          if (bodyTooLarge(req))
            throw new WatchApiError("VALIDATION_ERROR", 413);
        }
        const ip = req.ip ?? "unknown";
        if (access === "WATCH_PAIRING") {
          const limit =
            route.path === "/pair/start"
              ? WATCH_RATE_LIMITS.pairStartPerIpHour
              : WATCH_RATE_LIMITS.pairTokenPerIpHour;
          const hit = limiter.hit(`${name} ${ip}`, limit, 3_600_000);
          if (!hit.allowed) throw rateLimited(hit.retryAfterS);
        } else {
          const failedKey = `authfail ${ip}`;
          if (!limiter.peek(failedKey, WATCH_RATE_LIMITS.failedAuthPerIpMinute))
            throw rateLimited(60);
          try {
            principal = await verifier.verify(req.get("authorization"));
          } catch (error) {
            if (error instanceof WatchAuthError) {
              if (error.reason === "unavailable") throw unavailable();
              limiter.hit(
                failedKey,
                WATCH_RATE_LIMITS.failedAuthPerIpMinute,
                60_000,
              );
              throw unauthenticated();
            }
            throw error;
          }
          const hit = limiter.hit(
            `device ${principal.deviceId}`,
            WATCH_RATE_LIMITS.perDeviceMinute,
            60_000,
          );
          if (!hit.allowed) throw rateLimited(hit.retryAfterS);
          const held = new Set(principal.context.scopes);
          if (!REQUIRED_SCOPES[access].every((scope) => held.has(scope)))
            throw unauthenticated();
          await rememberDevice(runtime, principal, req.get("x-arnold-watch"));
        }
        const call: WatchCall = {
          params: { ...(req.params as Record<string, string>) },
          body: req.body,
          headers: req.headers,
          lang,
          ip,
          ...(principal ? { principal } : {}),
        };
        const run = () => route.handler(call);
        const reply = !principal
          ? await run()
          : access === "WATCH_WRITE"
            ? await runtime.exclusive(principal.context, run)
            : await withArnoldContext(principal.context, run);
        for (const [header, value] of Object.entries(reply.headers ?? {}))
          res.setHeader(header, value);
        res.status(reply.status ?? 200);
        if (reply.body === undefined) res.end();
        else res.json(reply.body);
      } catch (error) {
        if (error instanceof WatchApiError) return sendError(res, lang, error);
        // Unknown failures: retryable, no detail to the watch; the log line
        // says "thrown" and the 5xx alarm sees it.
        thrown = true;
        sendError(res, lang, unavailable());
      }
    });
  }
  return router;
}

/**
 * Body-parser failures happen before the router (express.json is global), so
 * they get the watch error shape here: broken JSON 400, too large 413.
 */
function watchErrorHandler(
  error: Error & { status?: number; type?: string },
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (res.headersSent) return next(error);
  const status =
    error.type === "entity.parse.failed"
      ? 400
      : error.status === 413
        ? 413
        : error.status === 415
          ? 415
          : undefined;
  if (!status) return next(error);
  sendError(
    res,
    watchLanguage(req.get("accept-language")),
    new WatchApiError("VALIDATION_ERROR", status),
  );
}

/** Mounts the router and its body-error handler under /api/watch/v1. */
export function mountWatchApi(app: Express, options: WatchApiOptions): void {
  app.use(WATCH_BASE_PATH, createWatchRouter(options));
  app.use(WATCH_BASE_PATH, watchErrorHandler);
}
