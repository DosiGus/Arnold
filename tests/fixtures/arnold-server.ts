import { createFixtureLogging } from "../../src/server/workout/fixture";
/**
 * Fixture servers for the Arnold v2 browser tests.
 *
 * Three ports, three states, so a Playwright test can simply visit the one it
 * needs instead of mutating a shared server. Every one of them is backed by a
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
