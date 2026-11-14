/**
 * Mock of the Arnold watch API (/api/watch/v1) for the simulator and device tests.
 * Synthetic data only: the plan comes from the contract fixtures in tests/fixtures/watch.
 *
 *   npx tsx apps/garmin/scripts/mock-server.ts              start (127.0.0.1:8812)
 *   npx tsx apps/garmin/scripts/mock-server.ts --self-test  start, check every route, exit
 *
 * Environment:
 *   MOCK_PORT            port (default 8812; Playwright uses 8792–8806)
 *   MOCK_HOST            bind address (default 127.0.0.1)
 *   WATCH_FIXTURES_DIR   folder with directory.json, typical-day.json, extreme-day.json
 *                        (default tests/fixtures/watch in this repository)
 *   MOCK_FAULT           fault active from the start, same syntax as below
 *
 * Faults (switch at run time, loopback only; forwarded control requests are rejected):
 *   POST /__mock/fault {"fault":"<fault>","count":n,"route":"POST /workouts"}
 *     <fault> is an error code of the contract (e.g. STORAGE_UNAVAILABLE, AUTH_REQUIRED,
 *     WORKOUT_PENDING, RATE_LIMITED), "status:<http>", "hang" (never answers),
 *     "delay:<ms>" or "large:<bytes>" (a padded 200 answer of that size).
 *     "plan:8192" returns a valid nested 8KiB plan fixture on a session route.
 *     count = how many requests it hits (default: until cleared); route = only that route.
 *   DELETE /__mock/fault   clear;  GET /__mock/log   request log;  POST /__mock/reset   all state
 *
 * Finished runs (RUN-018): POST /runs is checked against WatchRunRequestSchema of the server (strict keys, limits),
 * answers 201 {workout_id, replayed:false, hr_discarded}, the same request_id and content again 200 replayed:true, the
 * same request_id with other content or the same session_uuid under another request_id 409 DUPLICATE_OPERATION /
 * DUPLICATE_WORKOUT. Heart rate values without the consent are dropped (hr_discarded:true). PATCH /runs/:id/rpe is not
 * here: a Connect IQ watch cannot send PATCH, the effort travels in POST /runs.
 *   POST /__mock/health-consent {"on":false}   switch the consent (loopback only)
 *   npx tsx apps/garmin/scripts/mock-server.ts --run-e2e <log file of the simulator>   post the printed runs, check, exit
 *
 * Planned runs (RUN-012): GET /runs/upcoming (today and the next six days, relative to the current
 * UTC date) and GET /runs/:id (prescription, ETag `"<tag>"`; the list carries the tag without quotes,
 * as the server does). Both with If-None-Match, like the plan routes.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WatchRunRequestSchema } from "../../../src/shared/run-contract.js";

const BASE = "/api/watch/v1";
const BODY_LIMIT = 64 * 1024;
const envelope = { api_version: 1, min_app_version: "1.0.0" } as const;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** HTTP status and retry flag per contract error code (as the server sends them). */
const ERRORS: Record<string, [number, boolean]> = {
  AUTH_REQUIRED: [401, false],
  UPGRADE_REQUIRED: [426, false],
  RATE_LIMITED: [429, true],
  SETUP_REQUIRED: [409, false],
  NO_ACTIVE_PLAN: [404, false],
  DUPLICATE_WORKOUT: [409, false],
  DUPLICATE_OPERATION: [409, false],
  VALIDATION_ERROR: [422, false],
  CONSENT_REQUIRED: [403, false],
  WORKOUT_PENDING: [409, true],
  CONFIRMATION_REQUIRED: [422, false],
  SCHEMA_MISMATCH: [409, false],
  STORAGE_UNAVAILABLE: [503, true],
  DATE_IN_FUTURE: [422, false],
};

type Json = Record<string, unknown>;
type Fault = { fault: string; count: number | null; route: string | null };
type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};
type LogEntry = {
  at: string;
  route: string;
  status: number;
  request_id?: string;
  fault?: string;
};

function loadFixtures(dir: string) {
  const read = (name: string): Json => {
    const file = join(dir, name);
    if (!existsSync(file))
      throw new Error(
        `Fixture fehlt: ${file}. WATCH_FIXTURES_DIR auf tests/fixtures/watch eines Stands mit dem Uhr-Vertrag setzen (z. B. Worktree feat/garmin-server).`,
      );
    return JSON.parse(readFileSync(file, "utf8")) as Json;
  };
  return {
    directory: read("directory.json"),
    typical: read("typical-day.json"),
    extreme: read("extreme-day.json"),
  };
}

// A valid nested D-22 fixture, calibrated in UTF-8 without padding fields.
function sizedPlan(source: Json, bytes: number): Json {
  const plan = JSON.parse(JSON.stringify(source)) as Json;
  const size = () => Buffer.byteLength(JSON.stringify(plan), "utf8");
  for (const item of plan.items as Json[]) {
    for (const key of ["h", "l", "n"]) {
      while (
        size() > bytes &&
        typeof item[key] === "string" &&
        String(item[key]).length > 1
      ) {
        item[key] = String(item[key]).slice(0, -1);
      }
      if (size() < bytes)
        item[key] = String(item[key]) + "a".repeat(bytes - size());
      if (size() === bytes) return plan;
    }
  }
  throw new Error("Plan fixture cannot meet requested byte size");
}

const etagOf = (body: unknown) =>
  `"${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
const bodyHash = (body: unknown) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex");
const errorBody = (code: string, message: string) => ({
  ...envelope,
  error: { code, retryable: ERRORS[code]?.[1] ?? false, message },
});
const fail = (code: string, message = code): Reply => ({
  status: ERRORS[code]?.[0] ?? 400,
  body: errorBody(code, message),
});

/** Synthetic planned runs: today, tomorrow and in six days (no minutes: a long run set by nothing). */
function mockRuns() {
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const make = (
    id: string,
    offset: number,
    name: string,
    minutes: number | null,
    work: number[],
  ) => {
    const p = {
      k: 1,
      n: name,
      e: 0,
      s: [[0, 1, 300, 0, 0, 0], work, [3, 1, 300, 0, 0, 0]],
    };
    // Same tag as the server: first 12 characters of the base64url SHA-256 of the prescription.
    const tag = createHash("sha256")
      .update(JSON.stringify(p))
      .digest("base64url")
      .slice(0, 12);
    return {
      entry: {
        id,
        d: day(offset),
        n: name,
        k: 1,
        m: minutes,
        dm: null,
        e: 0,
        tag,
      },
      detail: { ...envelope, id, p },
      etag: `"${tag}"`,
    };
  };
  return [
    make("run_mock_1", 0, "Zone 2", 45, [1, 1, 1200, 1, 2, 2]),
    make("run_mock_2", 1, "Intervalle", 50, [1, 1, 900, 1, 4, 5]),
    make("run_mock_3", 6, "Langer Lauf", null, [1, 0, 0, 0, 0, 0]),
  ];
}

export function createMockState(fixtures: ReturnType<typeof loadFixtures>) {
  const days = fixtures.directory.days as Json[];
  // Day bodies: the next day is the typical fixture, the second the extreme one,
  // every other day a copy of the typical one under its own id and name.
  const sessions = new Map<string, Json>();
  days.forEach((day, i) => {
    const source = i === 1 ? fixtures.extreme : fixtures.typical;
    sessions.set(String(day.id), {
      ...source,
      p: fixtures.directory.p,
      id: day.id,
      n: day.n,
    });
  });
  const directory: Json = {
    ...fixtures.directory,
    days: days.map((day) => ({
      ...day,
      tag: etagOf(sessions.get(String(day.id))),
    })),
  };
  const firstDay = sessions.get(String(directory.next)) ?? fixtures.typical;
  const recent = {
    ...envelope,
    cat: ((firstDay.cat as Json[]) ?? []).slice(0, 10),
  };
  return {
    directory,
    gateTemplate: fixtures.extreme,
    sessions,
    recent,
    pairings: new Map<string, { polls: number; userCode: string }>(),
    token: null as string | null,
    deviceId: null as string | null,
    healthConsent: true,
    runs: mockRuns(),
    workouts: new Map<
      string,
      { hash: string; response: Json; count: number }
    >(),
    workoutSessions: new Set<string>(),
    runUploads: new Map<
      string,
      { hash: string; response: Json; count: number; stored: Json }
    >(),
    runSessions: new Map<string, string>(),
    health: new Map<string, Json>(),
    fault: null as Fault | null,
    log: [] as LogEntry[],
  };
}
type State = ReturnType<typeof createMockState>;

function parseFault(value: unknown, count?: unknown, route?: unknown): Fault {
  const fault = String(value ?? "");
  const known =
    fault in ERRORS ||
    fault === "hang" ||
    /^status:\d{3}$/.test(fault) ||
    /^delay:\d+$/.test(fault) ||
    /^large:\d+$/.test(fault) ||
    fault === "plan:8192";
  if (!known) throw new Error(`Unbekannter Fehlerfall: ${fault}`);
  return {
    fault,
    count: typeof count === "number" && count > 0 ? count : null,
    route: typeof route === "string" && route ? route : null,
  };
}

function userCode() {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Routes of the watch API. Returns null for unknown paths. */
function route(
  state: State,
  method: string,
  path: string,
  headers: IncomingMessage["headers"],
  body: Json | null,
): Reply | null {
  const authorized = () =>
    state.token !== null && headers.authorization === `Bearer ${state.token}`;

  if (method === "POST" && path === "/pair/start") {
    const deviceCode = randomBytes(32).toString("base64url").slice(0, 43);
    const code = userCode();
    state.pairings.set(deviceCode, { polls: 0, userCode: code });
    return {
      status: 200,
      body: {
        ...envelope,
        device_code: deviceCode,
        user_code: code,
        expires_in: 600,
        interval: 5,
      },
    };
  }
  if (method === "POST" && path === "/pair/token") {
    const pairing = state.pairings.get(String(body?.device_code ?? ""));
    if (!pairing)
      return { status: 200, body: { ...envelope, status: "expired" } };
    // The mock confirms on the second poll, as if the user clicked in ChatGPT.
    pairing.polls += 1;
    if (pairing.polls < 2)
      return { status: 200, body: { ...envelope, status: "pending" } };
    state.pairings.delete(String(body?.device_code));
    state.token = `arn_w_${randomBytes(32).toString("base64url").slice(0, 43)}`;
    state.deviceId = `wd_${randomUUID()}`;
    return {
      status: 200,
      body: {
        ...envelope,
        access_token: state.token,
        device_id: state.deviceId,
        account_label: "Arnold · mock",
      },
    };
  }

  const isWatchRoute =
    /^\/(device|plan|plan\/recent|plan\/sessions\/[^/]+|runs|runs\/[^/]+|workouts|workouts\/[^/]+\/health)$/.test(
      path,
    );
  if (!isWatchRoute) return null;
  if (!authorized()) return fail("AUTH_REQUIRED", "Uhr nicht gekoppelt.");

  if (method === "GET" && path === "/device")
    return {
      status: 200,
      body: {
        ...envelope,
        device_id: state.deviceId,
        paired: true,
        health_consent: state.healthConsent,
        server_time_utc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      },
    };
  if (method === "DELETE" && path === "/device") {
    state.token = null;
    state.deviceId = null;
    return { status: 200, body: { ...envelope, unpaired: true } };
  }
  const cached = (body: Json): Reply => {
    const tag = etagOf(body);
    return headers["if-none-match"] === tag
      ? { status: 304, headers: { ETag: tag } }
      : { status: 200, body, headers: { ETag: tag } };
  };
  if (method === "GET" && path === "/plan") return cached(state.directory);
  if (method === "GET" && path === "/plan/recent") return cached(state.recent);
  const day = /^\/plan\/sessions\/([^/]+)$/.exec(path);
  if (method === "GET" && day) {
    const session = state.sessions.get(decodeURIComponent(day[1]!));
    return session
      ? cached(session)
      : {
          status: 404,
          body: errorBody("VALIDATION_ERROR", "Unbekannter Tag."),
        };
  }
  if (method === "GET" && path === "/runs/upcoming") {
    const body = {
      ...envelope,
      d: new Date().toISOString().slice(0, 10),
      hc: state.healthConsent,
      runs: state.runs.map((run) => run.entry),
      next: null,
    };
    const tag = etagOf(body);
    return headers["if-none-match"] === tag
      ? { status: 304, headers: { ETag: tag } }
      : { status: 200, body, headers: { ETag: tag } };
  }
  const run = /^\/runs\/([^/]+)$/.exec(path);
  if (method === "GET" && run) {
    const found = state.runs.find(
      (r) => r.entry.id === decodeURIComponent(run[1]!),
    );
    if (!found)
      return {
        status: 404,
        body: errorBody("VALIDATION_ERROR", "Unbekannter Lauf."),
      };
    return headers["if-none-match"] === found.etag
      ? { status: 304, headers: { ETag: found.etag } }
      : { status: 200, body: found.detail, headers: { ETag: found.etag } };
  }
  if (method === "POST" && path === "/workouts") {
    const requestId = body?.request_id;
    const sessionUuid = body?.session_uuid;
    if (
      typeof requestId !== "string" ||
      typeof sessionUuid !== "string" ||
      !Array.isArray(body?.exercises) ||
      body.exercises.length === 0
    )
      return fail(
        "VALIDATION_ERROR",
        "request_id, session_uuid und exercises fehlen.",
      );
    const hash = bodyHash(body);
    const seen = state.workouts.get(requestId);
    if (seen) {
      seen.count += 1;
      if (seen.hash !== hash)
        return fail(
          "DUPLICATE_OPERATION",
          "Gleiche request_id mit anderem Inhalt.",
        );
      return { status: 200, body: { ...seen.response, replayed: true } };
    }
    const response = {
      ...envelope,
      workout_id: `wo_${randomUUID()}`,
      replayed: false,
      summary: { records: [], next: [] },
    };
    state.workouts.set(requestId, { hash, response, count: 1 });
    state.workoutSessions.add(sessionUuid);
    return { status: 200, body: response };
  }
  if (method === "POST" && path === "/runs") {
    const parsed = WatchRunRequestSchema.safeParse(body);
    if (!parsed.success)
      return fail(
        "VALIDATION_ERROR",
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")
          .slice(0, 300),
      );
    const request = parsed.data;
    const hash = bodyHash(body);
    const seen = state.runUploads.get(request.request_id);
    if (seen) {
      seen.count += 1;
      if (seen.hash !== hash)
        return fail(
          "DUPLICATE_OPERATION",
          "Gleiche request_id mit anderem Inhalt.",
        );
      return { status: 200, body: { ...seen.response, replayed: true } };
    }
    if (state.runSessions.has(request.session_uuid))
      return fail("DUPLICATE_WORKOUT", "Dieser Lauf ist schon gespeichert.");
    const hasHr =
      request.hr != null || request.segments.some((segment) => segment.hr);
    const discarded = hasHr && !state.healthConsent;
    const stored: Json = { ...request };
    if (discarded) {
      delete stored.hr;
      stored.segments = request.segments.map(({ hr: _hr, ...rest }) => rest);
    }
    const response = {
      ...envelope,
      workout_id: `wo_${randomUUID()}`,
      replayed: false,
      hr_discarded: discarded,
    };
    state.runUploads.set(request.request_id, {
      hash,
      response,
      count: 1,
      stored,
    });
    state.runSessions.set(request.session_uuid, request.request_id);
    return { status: 201, body: response };
  }
  const health = /^\/workouts\/([^/]+)\/health$/.exec(path);
  if (method === "PUT" && health) {
    const sessionUuid = decodeURIComponent(health[1]!);
    if (!state.healthConsent)
      return fail("CONSENT_REQUIRED", "Keine Einwilligung für Messwerte.");
    if (!state.workoutSessions.has(sessionUuid))
      return fail("WORKOUT_PENDING", "Training noch nicht gespeichert.");
    state.health.set(sessionUuid, body ?? {});
    return {
      status: 200,
      body: { ...envelope, session_uuid: sessionUuid, stored: true },
    };
  }
  return fail("VALIDATION_ERROR", "Methode nicht erlaubt.");
}

function routeName(method: string, path: string) {
  return `${method} ${path
    .replace(/^\/plan\/sessions\/[^/]+$/, "/plan/sessions/:session_id")
    .replace(/^\/runs\/(?!upcoming$)[^/]+$/, "/runs/:id")
    .replace(/^\/workouts\/[^/]+\/health$/, "/workouts/:session_uuid/health")}`;
}

/** Applies an active fault. Returns a reply, "hang", or null to continue normally. */
async function applyFault(
  state: State,
  name: string,
  path: string,
): Promise<Reply | "hang" | null> {
  const fault = state.fault;
  if (!fault || (fault.route && fault.route !== name)) return null;
  if (fault.count !== null) {
    fault.count -= 1;
    if (fault.count <= 0) state.fault = null;
  }
  const f = fault.fault;
  if (f === "hang") return "hang";
  if (f.startsWith("delay:")) {
    await new Promise((r) => setTimeout(r, Number(f.slice(6))));
    return null;
  }
  if (f.startsWith("status:")) {
    const status = Number(f.slice(7));
    return {
      status,
      body: errorBody("STORAGE_UNAVAILABLE", `Testfehler ${status}`),
    };
  }
  if (f === "plan:8192") {
    const id = decodeURIComponent(path.replace(/^\/plan\/sessions\//, ""));
    const original = state.sessions.get(id);
    if (!original)
      return fail("VALIDATION_ERROR", "Plan fixture route expected");
    const fixture = sizedPlan(
      { ...state.gateTemplate, id, p: original.p },
      8192,
    );
    return { status: 200, body: fixture, headers: { ETag: etagOf(fixture) } };
  }
  if (f.startsWith("large:")) {
    const size = Number(f.slice(6));
    const base = JSON.stringify({ ...envelope, pad: "" });
    return {
      status: 200,
      body: { ...envelope, pad: "x".repeat(Math.max(0, size - base.length)) },
    };
  }
  return f === "RATE_LIMITED"
    ? { ...fail(f, "Zu viele Anfragen."), headers: { "Retry-After": "30" } }
    : fail(f, `Testfehler ${f}`);
}

function send(res: ServerResponse, reply: Reply) {
  for (const [k, v] of Object.entries(reply.headers ?? {})) res.setHeader(k, v);
  if (reply.body === undefined) {
    res.statusCode = reply.status;
    res.end();
    return;
  }
  const text = JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string | "too_large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) return "too_large";
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function startMockServer(options: {
  port: number;
  host: string;
  fixturesDir: string;
  fault?: string;
  quiet?: boolean;
}) {
  const state = createMockState(loadFixtures(options.fixturesDir));
  if (options.fault) state.fault = parseFault(options.fault);
  const log = (entry: LogEntry) => {
    state.log.push(entry);
    if (state.log.length > 1000) state.log.shift();
    if (!options.quiet)
      console.log(
        [
          entry.at,
          entry.route,
          entry.status,
          entry.request_id ?? "",
          entry.fault ?? "",
        ]
          .join(" ")
          .trim(),
      );
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const method = req.method ?? "GET";
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    );
    try {
      if (url.pathname.startsWith("/__mock/")) {
        const forwarded = [
          "cf-connecting-ip",
          "x-forwarded-for",
          "forwarded",
        ].some((name) => name in req.headers);
        if (!loopback || forwarded)
          return send(res, { status: 404, body: { error: "not found" } });
        const raw = await readBody(req);
        const input =
          raw && raw !== "too_large" ? (JSON.parse(raw) as Json) : {};
        if (url.pathname === "/__mock/fault" && method === "POST") {
          state.fault = parseFault(input.fault, input.count, input.route);
          return send(res, { status: 200, body: { fault: state.fault } });
        }
        if (url.pathname === "/__mock/fault" && method === "DELETE") {
          state.fault = null;
          return send(res, { status: 200, body: { fault: null } });
        }
        if (url.pathname === "/__mock/health-consent" && method === "POST") {
          state.healthConsent = input.on === true;
          return send(res, {
            status: 200,
            body: { health_consent: state.healthConsent },
          });
        }
        if (url.pathname === "/__mock/log")
          return send(res, {
            status: 200,
            body: {
              runs: Object.fromEntries(
                [...state.runUploads].map(([id, r]) => [id, r.count]),
              ),
              log: state.log,
              workouts: Object.fromEntries(
                [...state.workouts].map(([id, w]) => [id, w.count]),
              ),
            },
          });
        if (url.pathname === "/__mock/reset" && method === "POST") {
          Object.assign(
            state,
            createMockState(loadFixtures(options.fixturesDir)),
          );
          return send(res, { status: 200, body: { reset: true } });
        }
        return send(res, { status: 404, body: { error: "not found" } });
      }
      if (!url.pathname.startsWith(BASE + "/")) {
        return send(res, {
          status: 404,
          body: errorBody("VALIDATION_ERROR", "Unbekannte Route."),
        });
      }
      const path = url.pathname.slice(BASE.length);
      const name = routeName(method, path);
      const activeFault = state.fault?.fault;
      const faulted = await applyFault(state, name, path);
      if (faulted === "hang") {
        log({
          at: new Date().toISOString(),
          route: name,
          status: 0,
          fault: "hang",
        });
        return; // never answers; the client must time out
      }
      let body: Json | null = null;
      if (method === "POST" || method === "PUT") {
        if (
          !String(req.headers["content-type"] ?? "").includes(
            "application/json",
          )
        )
          return send(res, {
            status: 415,
            body: errorBody("VALIDATION_ERROR", "JSON erwartet."),
          });
        const raw = await readBody(req);
        if (raw === "too_large")
          return send(res, {
            status: 413,
            body: errorBody("VALIDATION_ERROR", "Anfrage zu groß."),
          });
        try {
          body = raw ? (JSON.parse(raw) as Json) : {};
        } catch {
          return send(res, {
            status: 400,
            body: errorBody("VALIDATION_ERROR", "Ungültiges JSON."),
          });
        }
      }
      const reply = faulted ??
        route(state, method, path, req.headers, body) ?? {
          status: 404,
          body: errorBody("VALIDATION_ERROR", "Unbekannte Route."),
        };
      log({
        at: new Date().toISOString(),
        route: name,
        status: reply.status,
        request_id:
          typeof body?.request_id === "string" ? body.request_id : undefined,
        fault: faulted ? activeFault : undefined,
      });
      send(res, reply);
    } catch (error) {
      send(res, {
        status: 500,
        body: errorBody("STORAGE_UNAVAILABLE", (error as Error).message),
      });
    }
  });
  server.listen(options.port, options.host);
  return { server, state };
}

async function selfTest(port: number, fixturesDir: string) {
  const { server, state } = startMockServer({
    port,
    host: "127.0.0.1",
    fixturesDir,
    quiet: true,
  });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${port}`;
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(base + path, {
      method,
      headers:
        body === undefined
          ? headers
          : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text ? (JSON.parse(text) as Json) : null,
      etag: res.headers.get("etag"),
    };
  };
  const checks: [string, boolean][] = [];
  const check = (name: string, ok: boolean) => checks.push([name, ok]);

  check("ohne Token 401", (await call("GET", `${BASE}/plan`)).status === 401);
  const start = await call("POST", `${BASE}/pair/start`, {
    device_label: "Forerunner 255",
    part_number: "006-B3992-00",
    app_version: "0.1.0",
  });
  check(
    "pair/start liefert Code",
    start.status === 200 &&
      /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(String(start.body?.user_code)),
  );
  const poll1 = await call("POST", `${BASE}/pair/token`, {
    device_code: start.body?.device_code,
  });
  check("erste Abfrage pending", poll1.body?.status === "pending");
  const poll2 = await call("POST", `${BASE}/pair/token`, {
    device_code: start.body?.device_code,
  });
  const token = String(poll2.body?.access_token ?? "");
  check("zweite Abfrage Token", /^arn_w_[A-Za-z0-9_-]{43}$/.test(token));
  const auth = { Authorization: `Bearer ${token}` };
  const dir = await call("GET", `${BASE}/plan`, undefined, auth);
  check("Verzeichnis", dir.status === 200 && Array.isArray(dir.body?.days));
  check(
    "Verzeichnis 304",
    (
      await call("GET", `${BASE}/plan`, undefined, {
        ...auth,
        "If-None-Match": dir.etag ?? "",
      })
    ).status === 304,
  );
  const days = dir.body?.days as Json[];
  const day = await call(
    "GET",
    `${BASE}/plan/sessions/${encodeURIComponent(String(days[0]!.id))}`,
    undefined,
    auth,
  );
  check(
    "Tag mit ETag aus dem Verzeichnis",
    day.status === 200 && day.etag === days[0]!.tag,
  );
  check(
    "unbekannter Tag 404",
    (await call("GET", `${BASE}/plan/sessions/nope`, undefined, auth))
      .status === 404,
  );
  check(
    "recent",
    (await call("GET", `${BASE}/plan/recent`, undefined, auth)).status === 200,
  );
  const upcoming = await call("GET", `${BASE}/runs/upcoming`, undefined, auth);
  const upRuns = (upcoming.body?.runs ?? []) as Json[];
  check(
    "Läufe: Liste mit heute und Tag in sechs Tagen",
    upcoming.status === 200 &&
      upRuns.length === 3 &&
      upRuns[0]!.d === upcoming.body?.d &&
      upcoming.body?.hc === true,
  );
  check(
    "Läufe: Liste 304",
    (
      await call("GET", `${BASE}/runs/upcoming`, undefined, {
        ...auth,
        "If-None-Match": upcoming.etag ?? "",
      })
    ).status === 304,
  );
  const runDetail = await call(
    "GET",
    `${BASE}/runs/${String(upRuns[0]!.id)}`,
    undefined,
    auth,
  );
  check(
    "Lauf: Vorgabe mit ETag in Anführungszeichen = tag der Liste",
    runDetail.status === 200 &&
      runDetail.etag === `"${String(upRuns[0]!.tag)}"` &&
      Array.isArray((runDetail.body?.p as Json | undefined)?.s),
  );
  check(
    "Lauf: 304 mit If-None-Match",
    (
      await call("GET", `${BASE}/runs/${String(upRuns[0]!.id)}`, undefined, {
        ...auth,
        "If-None-Match": runDetail.etag ?? "",
      })
    ).status === 304,
  );
  check(
    "Lauf: unbekannt 404, upcoming ist keine Id",
    (await call("GET", `${BASE}/runs/nope`, undefined, auth)).status === 404,
  );
  check(
    "Läufe: ohne Token 401",
    (await call("GET", `${BASE}/runs/upcoming`)).status === 401,
  );
  const sessionUuid = randomUUID();
  const workout = {
    request_id: "r-self-test",
    session_uuid: sessionUuid,
    exercises: [{ exercise_id: "ex_1", sets: [] }],
  };
  const pending = await call(
    "PUT",
    `${BASE}/workouts/${sessionUuid}/health`,
    {},
    auth,
  );
  check(
    "Messwerte vor Training 409 WORKOUT_PENDING",
    pending.status === 409 &&
      (pending.body?.error as Json)?.code === "WORKOUT_PENDING",
  );
  const first = await call("POST", `${BASE}/workouts`, workout, auth);
  const again = await call("POST", `${BASE}/workouts`, workout, auth);
  check(
    "Upload und Wiederholung",
    first.body?.replayed === false &&
      again.body?.replayed === true &&
      again.body?.workout_id === first.body?.workout_id,
  );
  check(
    "andere Daten gleiche request_id 409",
    (
      await call(
        "POST",
        `${BASE}/workouts`,
        { ...workout, exercises: [{ skip: true }] },
        auth,
      )
    ).status === 409,
  );
  check(
    "Messwerte nach Training",
    (
      await call(
        "PUT",
        `${BASE}/workouts/${sessionUuid}/health`,
        { calories_kcal: null },
        auth,
      )
    ).status === 200,
  );
  check(
    "415 ohne JSON",
    (
      await fetch(`${base}${BASE}/workouts`, {
        method: "POST",
        headers: auth,
        body: "x",
      })
    ).status === 415,
  );
  check(
    "413 über 64 KB",
    (await call("POST", `${BASE}/workouts`, { pad: "x".repeat(70000) }, auth))
      .status === 413,
  );
  // Finished runs (RUN-018): the server's schema, replay, duplicates, consent.
  const runBody = (uuid: string, extra: Json = {}): Json => ({
    request_id: `gr_${uuid}`,
    session_uuid: uuid,
    workout_date_local: "2026-11-10",
    utc_offset_min: 60,
    started_at_utc: "2026-11-10T06:00:00Z",
    ended_at_utc: "2026-11-10T06:30:00Z",
    environment: "outdoor",
    run_type: "base",
    timer_s: 1800,
    elapsed_s: 1800,
    distance_m: 4300,
    distance_source: "gps",
    splits: [30, 60, 90],
    pauses: 0,
    segments: [
      { i: 0, rep: null, kind: 1, st: 2, t: 1800, dm: 4300, tz: null },
    ],
    ...extra,
  });
  const runHr = {
    avg: 140,
    max: 150,
    zone_s: [0, 0, 1800, 0, 0],
    zones: [100, 120, 140, 160, 180, 200],
    zones_sport: "running",
  };
  const uuidA = randomUUID();
  const runA = await call(
    "POST",
    `${BASE}/runs`,
    runBody(uuidA, { hr: runHr, rpe: 5 }),
    auth,
  );
  check(
    "Lauf: neu 201 mit workout_id, nicht wiederholt, Puls behalten",
    runA.status === 201 &&
      /^wo_/.test(String(runA.body?.workout_id)) &&
      runA.body?.replayed === false &&
      runA.body?.hr_discarded === false,
  );
  const runAgain = await call(
    "POST",
    `${BASE}/runs`,
    runBody(uuidA, { hr: runHr, rpe: 5 }),
    auth,
  );
  check(
    "Lauf: gleiche Anfrage 200 replayed, gleiche workout_id",
    runAgain.status === 200 &&
      runAgain.body?.replayed === true &&
      runAgain.body?.workout_id === runA.body?.workout_id,
  );
  const runOther = await call(
    "POST",
    `${BASE}/runs`,
    runBody(uuidA, { rpe: 6 }),
    auth,
  );
  check(
    "Lauf: gleiche request_id, anderer Inhalt 409 DUPLICATE_OPERATION",
    runOther.status === 409 &&
      (runOther.body?.error as Json)?.code === "DUPLICATE_OPERATION",
  );
  const runTwin = await call(
    "POST",
    `${BASE}/runs`,
    { ...runBody(uuidA), request_id: "gr_other" },
    auth,
  );
  check(
    "Lauf: dieselbe session_uuid unter neuer request_id 409 DUPLICATE_WORKOUT",
    runTwin.status === 409 &&
      (runTwin.body?.error as Json)?.code === "DUPLICATE_WORKOUT",
  );
  const runBad = await call(
    "POST",
    `${BASE}/runs`,
    runBody(randomUUID(), { lat: 1.5 }),
    auth,
  );
  check(
    "Lauf: unbekanntes Feld (Koordinate) 422",
    runBad.status === 422 &&
      (runBad.body?.error as Json)?.code === "VALIDATION_ERROR",
  );
  const runLong = await call(
    "POST",
    `${BASE}/runs`,
    runBody(randomUUID(), { splits: new Array(60).fill(10) }),
    auth,
  );
  check("Lauf: mehr Zwischenzeiten als Strecke 422", runLong.status === 422);
  await call("POST", "/__mock/health-consent", { on: false });
  const uuidB = randomUUID();
  const runB = await call(
    "POST",
    `${BASE}/runs`,
    runBody(uuidB, { hr: runHr }),
    auth,
  );
  check(
    "Lauf: Puls ohne Einwilligung verworfen (hr_discarded)",
    runB.status === 201 &&
      runB.body?.hr_discarded === true &&
      !("hr" in (state.runUploads.get(`gr_${uuidB}`)?.stored ?? {})),
  );
  const uuidC = randomUUID();
  const runC = await call("POST", `${BASE}/runs`, runBody(uuidC), auth);
  check(
    "Lauf: ohne Puls und ohne Einwilligung nichts verworfen",
    runC.status === 201 && runC.body?.hr_discarded === false,
  );
  await call("POST", "/__mock/health-consent", { on: true });
  check(
    "Lauf: Log zaehlt die Wiederholung",
    ((await call("GET", "/__mock/log")).body?.runs as Json)?.[`gr_${uuidA}`] ===
      3,
  );
  check(
    "Lauf: PATCH …/rpe gibt es nicht (die Uhr kann es nicht)",
    (
      await call(
        "PATCH",
        `${BASE}/runs/${uuidA}/rpe`,
        { request_id: "x", rpe: 5 },
        auth,
      )
    ).status >= 400,
  );

  await call("POST", "/__mock/fault", {
    fault: "STORAGE_UNAVAILABLE",
    count: 1,
  });
  const faulted = await call("GET", `${BASE}/plan`, undefined, auth);
  check(
    "Fehlerschalter 503 einmal",
    faulted.status === 503 && (faulted.body?.error as Json)?.retryable === true,
  );
  check(
    "danach wieder normal",
    (await call("GET", `${BASE}/plan`, undefined, auth)).status === 200,
  );
  await call("POST", "/__mock/fault", { fault: "large:8192", count: 1 });
  const large = await fetch(`${base}${BASE}/plan`, { headers: auth });
  check("große Antwort 8 KB", (await large.text()).length === 8192);
  check(
    "Log zählt request_id",
    ((await call("GET", "/__mock/log")).body?.workouts as Json)?.[
      "r-self-test"
    ] === 3,
  );
  check("Log ohne Token", !JSON.stringify(state.log).includes(token));
  await call("POST", "/__mock/fault", {
    fault: "plan:8192",
    count: 1,
    route: "GET /plan/sessions/:session_id",
  });
  const gate = await call(
    "GET",
    `${BASE}/plan/sessions/${encodeURIComponent(String(days[0]!.id))}`,
    undefined,
    auth,
  );
  check(
    "8KiB echter verschachtelter Plan",
    gate.status === 200 &&
      Buffer.byteLength(JSON.stringify(gate.body), "utf8") === 8192 &&
      Array.isArray(gate.body?.cat) &&
      Array.isArray(gate.body?.items) &&
      !("pad" in gate.body!),
  );

  for (const header of ["Cf-Connecting-Ip", "X-Forwarded-For", "Forwarded"]) {
    for (const [method, path, body] of [
      ["GET", "/__mock/log", undefined],
      ["POST", "/__mock/fault", { fault: "hang" }],
      ["POST", "/__mock/reset", {}],
    ] as const) {
      check(
        `Steuerpfad ${path} via ${header} gesperrt`,
        (await call(method, path, body, { [header]: "203.0.113.10" }))
          .status === 404,
      );
    }
  }
  check(
    "abgewiesene Steueraufrufe aendern keinen Zustand",
    state.token === token &&
      state.fault === null &&
      state.workouts.has("r-self-test"),
  );

  server.close();
  for (const [name, ok] of checks)
    console.log(`${ok ? "ok  " : "FEHLER"} ${name}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(
    failed
      ? `${failed} von ${checks.length} fehlgeschlagen`
      : `Mock-Server: ${checks.length} Prüfungen bestanden`,
  );
  process.exit(failed ? 1 : 0);
}

/**
 * End-to-end check of RUN-018: the requests the watch built in the simulator (the unit test printed them as
 * `RUNPAYLOAD <name> <json>`) go to the mock server as the watch would send them; the server's schema accepts them,
 * a repeat is the same run, and without the consent no heart rate value is there to be dropped.
 */
async function runE2e(port: number, fixturesDir: string, file: string) {
  const { server, state } = startMockServer({
    port,
    host: "127.0.0.1",
    fixturesDir,
    quiet: true,
  });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${port}`;
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(base + path, {
      method,
      headers:
        body === undefined
          ? headers
          : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text ? (JSON.parse(text) as Json) : null,
    };
  };
  const checks: [string, boolean][] = [];
  const check = (name: string, ok: boolean) => checks.push([name, ok]);
  const start = await call("POST", `${BASE}/pair/start`, {
    device_label: "Forerunner 255",
    part_number: "006-B3992-00",
    app_version: "0.1.0",
  });
  await call("POST", `${BASE}/pair/token`, {
    device_code: start.body?.device_code,
  });
  const poll = await call("POST", `${BASE}/pair/token`, {
    device_code: start.body?.device_code,
  });
  const auth = {
    Authorization: `Bearer ${String(poll.body?.access_token ?? "")}`,
  };

  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.includes("RUNPAYLOAD "));
  const payloads = new Map<string, Json>();
  for (const line of lines) {
    const match = /RUNPAYLOAD (\S+) (\{.*\})\s*$/.exec(line);
    if (match)
      payloads.set(
        match[1]!,
        JSON.parse(match[2]!.replace(/\\"/g, '"')) as Json,
      );
  }
  for (const name of [
    "grundlage-mit-hr",
    "intervalle-mit-hr",
    "laufband-ohne-hr",
  ])
    check(`${name}: vom Simulator ausgegeben`, payloads.has(name));
  for (const [name, payload] of payloads) {
    const withHr = name.endsWith("-mit-hr");
    check(
      `${name}: Pulswerte ${withHr ? "mit" : "ohne"} Einwilligung`,
      withHr
        ? payload.hr != null
        : payload.hr === undefined && !JSON.stringify(payload).includes('"hr"'),
    );
    check(
      `${name}: keine Koordinaten`,
      !/"(lat|lon|position|coord)/i.test(JSON.stringify(payload)),
    );
    const first = await call("POST", `${BASE}/runs`, payload, auth);
    check(
      `${name}: Server nimmt den Lauf an (201)`,
      first.status === 201 &&
        first.body?.replayed === false &&
        first.body?.hr_discarded === false,
    );
    if (first.status !== 201) console.log(JSON.stringify(first.body));
    const again = await call("POST", `${BASE}/runs`, payload, auth);
    check(
      `${name}: Wiederholung ist derselbe Lauf (200, replayed)`,
      again.status === 200 &&
        again.body?.replayed === true &&
        again.body?.workout_id === first.body?.workout_id,
    );
    check(
      `${name}: ein Lauf gespeichert`,
      state.runUploads.get(String(payload.request_id))?.count === 2 &&
        state.runSessions.get(String(payload.session_uuid)) ===
          payload.request_id,
    );
  }
  // A server without the consent: the watch's run without heart rate values loses nothing.
  await call("POST", "/__mock/health-consent", { on: false });
  const treadmill = payloads.get("laufband-ohne-hr");
  if (treadmill) {
    const fresh = {
      ...treadmill,
      request_id: `gr_${randomUUID()}`,
      session_uuid: randomUUID(),
    };
    const r = await call("POST", `${BASE}/runs`, fresh, auth);
    check(
      "laufband-ohne-hr: ohne Einwilligung nichts verworfen",
      r.status === 201 && r.body?.hr_discarded === false,
    );
  }
  server.close();
  for (const [name, ok] of checks)
    console.log(`${ok ? "ok  " : "FEHLER"} ${name}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(
    failed
      ? `${failed} von ${checks.length} fehlgeschlagen`
      : `E2E Lauf: ${checks.length} Prüfungen bestanden`,
  );
  process.exit(failed ? 1 : 0);
}

const port = Number(process.env.MOCK_PORT ?? 8812);
const fixturesDir = resolve(
  process.env.WATCH_FIXTURES_DIR ?? join(repoRoot, "tests/fixtures/watch"),
);
if (process.argv.includes("--self-test")) {
  await selfTest(port, fixturesDir);
} else if (process.argv.includes("--run-e2e")) {
  await runE2e(
    port,
    fixturesDir,
    process.argv[process.argv.indexOf("--run-e2e") + 1]!,
  );
} else {
  const host = process.env.MOCK_HOST ?? "127.0.0.1";
  const { server } = startMockServer({
    port,
    host,
    fixturesDir,
    fault: process.env.MOCK_FAULT,
  });
  server.once("listening", () =>
    console.log(
      `Arnold-Mock auf http://${host}:${port}${BASE} (Fixtures: ${fixturesDir})`,
    ),
  );
}
