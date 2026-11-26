/**
 * Servers for the browser tests of the card views, three per browser project
 * (`SKYBRIDGE_PORT` and the next two). Synthetic in-memory data only.
 */
import { createHttpApp } from "../../src/server/http";
import { newTrackerDataset } from "../../src/server/account/catalog";
import { createFixtureOnboarding } from "../../src/server/onboarding/fixture";
import {
  createFixturePlanning,
  planFixtureDataset,
} from "../../src/server/plan/fixture";

const port = Number(process.env.SKYBRIDGE_PORT ?? 8850);
const common = {
  allowedHosts: ["127.0.0.1", "localhost"],
  allowedOrigins: [] as string[],
};

/** The demo runtime: invented history with runs, goals and watch values. */
createHttpApp({ ...common, env: {} }).listen(port, "127.0.0.1");

/** A new account with the starter catalog, for the setup. */
createHttpApp({
  ...common,
  workoutRuntime: createFixtureOnboarding({
    dataset: newTrackerDataset(planFixtureDataset("empty").config.tracker_id),
  }),
}).listen(port + 1, "127.0.0.1");

/** A plan without history, for the adjustment hint (writes of its own). */
createHttpApp({
  ...common,
  workoutRuntime: createFixturePlanning(),
}).listen(port + 2, "127.0.0.1");
