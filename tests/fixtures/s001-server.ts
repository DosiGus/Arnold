/** Fault injection lives only in this loopback synthetic test server. */
import { createServer } from "node:http";
import { createHttpApp } from "../../src/server/http";
import { createFixturePlanning } from "../../src/server/plan/fixture";
import {
  RejectedWriteError,
  type EntityChange,
} from "../../src/server/workout/infrastructure";
import type { ArnoldDataSource } from "../../src/server/arnold-source";
let fault: {
  type: string;
  code?: "PERMISSION_DENIED" | "AUTH_REQUIRED" | "VALIDATION_ERROR";
} = { type: "none" };
let held: readonly EntityChange[] = [];
function fresh() {
  const r = createFixturePlanning();
  const apply = r.repository.apply.bind(r.repository);
  r.repository.apply = async (changes) => {
    if (fault.type === "reject")
      throw new RejectedWriteError(
        fault.code ?? "PERMISSION_DENIED",
        "Synthetisch eindeutig abgelehnter Batch.",
      );
    if (fault.type === "unknown") {
      held = structuredClone(changes);
      throw Error("Synthetischer Timeout vor sichtbarem Commit");
    }
    await apply(changes);
  };
  return { ...r, settle: () => apply(held) };
}
let runtime = fresh();
const service = new Proxy(runtime.service, {
  get(_target, key) {
    const value = Reflect.get(runtime.service, key);
    return typeof value === "function" ? value.bind(runtime.service) : value;
  },
});
const plans = new Proxy(runtime.plans, {
  get(_target, key) {
    const value = Reflect.get(runtime.plans, key);
    return typeof value === "function" ? value.bind(runtime.plans) : value;
  },
});
const source: ArnoldDataSource = {
  mode: "arnold_sheets",
  label: "S001 · Synthetischer Fehlertest",
  description: "Nur lokale synthetische Testdaten.",
  load: () => runtime.source.load(),
  invalidate: () => runtime.source.invalidate(),
};
const app = createHttpApp({
  allowedHosts: ["127.0.0.1", "localhost"],
  allowedOrigins: [],
  workoutRuntime: { service, plans, source },
});
createServer(async (request, response) => {
  if (!request.url?.startsWith("/__qa/")) {
    app(request, response);
    return;
  }
  try {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && request.url === "/__qa/reset") {
      fault = { type: "none" };
      held = [];
      runtime = fresh();
    } else if (request.method === "POST" && request.url === "/__qa/fault") {
      let body = "";
      for await (const chunk of request) body += chunk;
      fault = JSON.parse(body);
    } else if (request.method === "POST" && request.url === "/__qa/settle") {
      fault = { type: "none" };
      await runtime.settle();
    } else if (request.method !== "GET" || request.url !== "/__qa/state") {
      response.statusCode = 404;
      response.end("{}");
      return;
    }
    response.end(
      JSON.stringify({
        data: await runtime.repository.read(),
        pending: await runtime.ledger.pending(
          (await runtime.repository.read()).config.tracker_id,
        ),
      }),
    );
  } catch {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: "Synthetic fixture control failed" }));
  }
}).listen(8900, "127.0.0.1");
