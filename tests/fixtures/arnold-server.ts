import { createFixtureLogging } from "../../src/server/workout/fixture";
import {
  createFixturePlanning,
  planFixtureDataset,
} from "../../src/server/plan/fixture";
import { createFixtureOnboarding } from "../../src/server/onboarding/fixture";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
/**
 * Fixture servers for the Arnold v2 browser tests.
 *
 * One port per state, so a Playwright test can simply visit the one it needs
 * instead of mutating a shared server. Every one of them is backed by a
 * synthetic in-memory dataset: no Google call is made and no real training data
 * is read or written.
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
      message: "Google Sheets ist vorübergehend nicht verfügbar.",
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

/**
 * Task 006 onboarding, on an empty synthetic tracker.
 *
 * The session journal is a file so the resumption test can restart a browser
 * context and still find the setup. It lives under test-results and holds only
 * synthetic answers plus a token *hash*.
 */
const onboardingStore = resolve("test-results/e2e-onboarding-sessions.json");
const onboardingStoreB = resolve("test-results/e2e-onboarding-sessions-b.json");
// Each run starts from an empty journal, so a leftover session from a previous
// run cannot make a test pass or fail for the wrong reason.
for (const path of [onboardingStore, onboardingStoreB])
  rmSync(path, { force: true });

createHttpApp({
  ...common,
  workoutRuntime: createFixtureOnboarding({ storeFile: onboardingStore }),
}).listen(8800, "127.0.0.1");

/** A second, independent onboarding tracker, so two tests cannot collide. */
createHttpApp({
  ...common,
  workoutRuntime: createFixtureOnboarding({ storeFile: onboardingStoreB }),
}).listen(8801, "127.0.0.1");

/** A short-lived setup, for the expiry and restart states. */
createHttpApp({
  ...common,
  workoutRuntime: createFixtureOnboarding({ sessionTtlMs: 1500 }),
}).listen(8802, "127.0.0.1");
