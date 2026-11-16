import { createFixtureLogging } from "../../src/server/workout/fixture";
import {
  createFixturePlanning,
  planFixtureDataset,
} from "../../src/server/plan/fixture";
import { createFixtureOnboarding } from "../../src/server/onboarding/fixture";
import { demoHistoryDataset } from "../../src/server/plan/demo-history";
import { newTrackerDataset } from "../../src/server/account/catalog";
/**
 * Fixture servers for the Arnold v2 browser tests.
 *
 * One port per state, so a Playwright test can simply visit the one it needs
 * instead of mutating a shared server. Every one of them is backed by a
 * synthetic in-memory dataset: no real training data is read or written.
 */
import { createHttpApp } from "../../src/server/http";
import { StaticArnoldDataSource } from "../../src/server/arnold-source";
import { emptyTrackerDataset, fullDataset } from "./arnold-dashboard";

const common = {
  allowedHosts: ["127.0.0.1", "localhost"],
  allowedOrigins: [] as string[],
};

/** A tracker with several weeks of synthetic history. */
createHttpApp({
  ...common,
  arnoldSource: new StaticArnoldDataSource(fullDataset(), {
    label: "Arnold · Testdatei",
    description:
      "Synthetische Arnold-Testdaten; ausschließlich lesend ausgewertet.",
  }),
}).listen(8792, "127.0.0.1");

/** The first-run case: catalog present, no workouts yet. */
createHttpApp({
  ...common,
  arnoldSource: new StaticArnoldDataSource(emptyTrackerDataset(), {
    label: "Master-Vorlage · Noch keine Workouts",
    description:
      "Die Trainingsdatenbasis ist bereit, es sind noch keine Trainings erfasst.",
  }),
}).listen(8793, "127.0.0.1");

/** An unreachable data source, for the error state. */
createHttpApp({
  ...common,
  arnoldSource: new StaticArnoldDataSource(fullDataset(), {
    label: "Arnold · Testdatei",
    failure: {
      code: "unavailable",
      message: "Die Datenbank ist vorübergehend nicht erreichbar.",
      retryable: true,
    },
  }),
}).listen(8794, "127.0.0.1");

/** Isolated writable synthetic tracker for Task 004 browser coverage. */
createHttpApp({ ...common, workoutRuntime: createFixtureLogging() }).listen(
  8795,
  "127.0.0.1",
);

/** Isolated writable synthetic tracker for Task 005 plan-editor coverage. */
createHttpApp({ ...common, workoutRuntime: createFixturePlanning() }).listen(
  8796,
  "127.0.0.1",
);

/** The first-run case for the plan editor: catalog present, no plan yet. */
createHttpApp({
  ...common,
  workoutRuntime: createFixturePlanning(planFixtureDataset("empty")),
}).listen(8797, "127.0.0.1");

/** Dedicated tracker for the destructive activation flow. */
createHttpApp({ ...common, workoutRuntime: createFixturePlanning() }).listen(
  8798,
  "127.0.0.1",
);

/** Dedicated tracker for the concurrent-edit conflict case. */
createHttpApp({ ...common, workoutRuntime: createFixturePlanning() }).listen(
  8799,
  "127.0.0.1",
);

/** Task 006 onboarding, on an empty synthetic tracker. */
createHttpApp({
  ...common,
  workoutRuntime: createFixtureOnboarding(),
}).listen(8800, "127.0.0.1");

/**
 * Independent onboarding trackers for the plan-edit test, one per browser
 * project: a completed setup activates its plan, and the next run must start
 * without it.
 */
createHttpApp({
  ...common,
  workoutRuntime: createFixtureOnboarding(),
}).listen(8801, "127.0.0.1");
createHttpApp({
  ...common,
  workoutRuntime: createFixtureOnboarding(),
}).listen(8803, "127.0.0.1");

/**
 * The start screen with nine weeks of invented history, goals and body
 * weight; writable, for the goal flows.
 */
createHttpApp({
  ...common,
  workoutRuntime: createFixturePlanning(
    demoHistoryDataset(new Date().toISOString().slice(0, 10)),
  ),
}).listen(8804, "127.0.0.1");

/** The training card's "Dauerhaft im Plan", on a plan of its own. */
createHttpApp({ ...common, workoutRuntime: createFixturePlanning() }).listen(
  8805,
  "127.0.0.1",
);

/** A setup on a new tracker with the starter catalog: start weights. */
createHttpApp({
  ...common,
  workoutRuntime: createFixtureOnboarding({
    dataset: newTrackerDataset(planFixtureDataset("empty").config.tracker_id),
  }),
}).listen(8806, "127.0.0.1");

/** A short-lived setup, for the expiry and restart states. */
createHttpApp({
  ...common,
  workoutRuntime: createFixtureOnboarding({ sessionTtlMs: 1500 }),
}).listen(8802, "127.0.0.1");

/** UX-005, the plan change card: one writable tracker per browser project. */
for (const port of [8830, 8831])
  createHttpApp({ ...common, workoutRuntime: createFixturePlanning() }).listen(
    port,
    "127.0.0.1",
  );
