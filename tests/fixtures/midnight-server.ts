import "./fake-clock";
import { createFixturePlanning } from "../../src/server/plan/fixture";
import { demoHistoryDataset } from "../../src/server/plan/demo-history";
import { createHttpApp } from "../../src/server/http";
import { berlinToday } from "./berlin-today";

/**
 * The start screen with invented history on a clock that stands shortly before
 * or after midnight UTC (`E2E_NOW`, see fake-clock.ts), when the UTC day and
 * the Berlin day differ. Port from `MIDNIGHT_PORT`. DATE-001.
 */
const port = Number(process.env.MIDNIGHT_PORT);
if (!port) throw new Error("MIDNIGHT_PORT fehlt.");
createHttpApp({
  allowedHosts: ["127.0.0.1", "localhost"],
  allowedOrigins: [],
  workoutRuntime: createFixturePlanning(demoHistoryDataset(berlinToday())),
}).listen(port, "127.0.0.1");
