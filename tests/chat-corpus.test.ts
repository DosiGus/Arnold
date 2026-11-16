/**
 * B13: the server side of the chat test corpus (docs/beta/ABNAHME.md, C8).
 *
 * Whether ChatGPT asks back is checked by hand with the corpus. What can be
 * enforced is enforced here: no workout in the future (W3), no 1000 kg
 * without an explicit yes (W2), "yesterday" is the local calendar day (M5),
 * and the descriptions carry the rules the corpus expects.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import {
  FixtureAuthorizationGuard,
  InMemoryArnoldStore,
} from "../src/server/workout/infrastructure";
import { WorkoutLoggingService } from "../src/server/workout/service";
import { planFixtureDataset } from "../src/server/plan/fixture";
import { createHttpApp } from "../src/server/http";
import { ARNOLD_INSTRUCTIONS } from "../src/server/mcp-arnold";
import { UNUSUAL_SET_LIMITS } from "../src/shared/workout-contract";

// 00:30 in Berlin on 1 November, still 31 October in UTC.
const NOW = "2026-10-31T23:30:00Z";

function service() {
  const dataset = planFixtureDataset();
  const memory = new InMemoryArnoldStore(dataset);
  return {
    memory,
    logging: new WorkoutLoggingService({
      mode: "fixture",
      trackerId: dataset.config.tracker_id,
      store: memory,
      authorization: new FixtureAuthorizationGuard(dataset.config.tracker_id),
      clock: () => new Date(NOW),
    }),
  };
}
const start = (date: string, request_id = `start-${date}`) => ({
  request_id,
  workout_date_local: date,
  timezone: "Europe/Berlin",
  session_name: "Korpus",
});
const set = (load_kg: number, reps = 5) => ({
  exercise_id: "plan-fx-bench",
  set_type: "working",
  reps,
  reps_basis: "total",
  load_kg,
  load_basis: "total",
  implement_count: 1,
  execution_mode: "bilateral_simultaneous",
  side: "both",
});

describe("W3 and M5: calendar dates", () => {
  it("refuses a workout tomorrow and stores nothing", async () => {
    const { memory, logging } = service();
    const before = await memory.read();
    const refused = await logging.startWorkout(start("2026-11-02"));
    expect(refused.error).toMatchObject({
      code: "DATE_IN_FUTURE",
      recovery: "none",
    });
    expect(refused.error!.message).toContain("2026-11-01");
    expect(await memory.read()).toEqual(before);
  });

  it("uses the user's local day, also shortly after midnight", async () => {
    const { logging } = service();
    // Already 1 November in Berlin, although UTC still says 31 October.
    expect((await logging.startWorkout(start("2026-11-01"))).ok).toBe(true);
    // "Gestern" is 31 October.
    const yesterday = await logging.startWorkout(start("2026-10-31"));
    expect(yesterday.ok).toBe(true);
    expect(yesterday.result!.workout!.workout_date_local).toBe("2026-10-31");
  });
});

describe("W2: unusual values need an explicit yes", () => {
  it("refuses 1000 kg without confirmation, then stores it once confirmed", async () => {
    const { memory, logging } = service();
    const workout = (await logging.startWorkout(start("2026-11-01"))).result!
      .workout!;
    const input = {
      request_id: "squat-1000",
      workout_id: workout.workout_id,
      sets: [set(1000)],
    };
    const refused = await logging.logWorkoutSets(input);
    expect(refused.error).toMatchObject({
      code: "CONFIRMATION_REQUIRED",
      recovery: "none",
      retryable: false,
    });
    expect(refused.error!.message).toContain("confirm_unusual_values");
    expect(
      (await memory.read()).sets.filter((s) => s.load_kg === 1000),
    ).toHaveLength(0);

    const confirmed = await logging.logWorkoutSets({
      ...input,
      confirm_unusual_values: true,
    });
    expect(confirmed.ok, confirmed.error?.message).toBe(true);
  });

  it("logs ordinary values directly and guards corrections too", async () => {
    const { logging } = service();
    const workout = (await logging.startWorkout(start("2026-11-01"))).result!
      .workout!;
    const logged = await logging.logWorkoutSets({
      request_id: "bench-100",
      workout_id: workout.workout_id,
      sets: [set(100, 8)],
    });
    expect(logged.ok).toBe(true);
    const stored = logged.result!.sets[0];
    const tooMany = await logging.updateSet({
      request_id: "fix-reps",
      set_id: stored.set_id,
      expected_row_revision: stored.row_revision,
      changes: { reps: UNUSUAL_SET_LIMITS.reps + 1 },
    });
    expect(tooMany.error?.code).toBe("CONFIRMATION_REQUIRED");
    const fixed = await logging.updateSet({
      request_id: "fix-reps-ok",
      set_id: stored.set_id,
      expected_row_revision: stored.row_revision,
      changes: { reps: 10 },
    });
    expect(fixed.ok).toBe(true);
  });
});

describe("descriptions follow the corpus", () => {
  let http: Server;
  let client: Client;
  beforeAll(async () => {
    http = createHttpApp({ env: {} }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => http.once("listening", resolve));
    client = new Client({ name: "corpus", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(
          `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
        ),
      ),
    );
  });
  afterAll(async () => {
    await client?.close();
    await new Promise<void>((resolve) => {
      http?.close(() => resolve());
      http?.closeAllConnections();
    });
  });
  const description = async (name: string) =>
    (await client.listTools()).tools.find((tool) => tool.name === name)!
      .description!;

  it("tells ChatGPT to ask instead of guessing", async () => {
    for (const phrase of [
      "Nachfragen statt raten",
      "Keine Sätze, Gewichte oder Übungen erfinden",
      "„gestern“ ist der gestrige lokale Tag",
      "RPE 8 entspricht etwa RIR 1–2",
      "zwei Einheiten an einem Tag zählen als ein Tag",
    ])
      expect(ARNOLD_INSTRUCTIONS).toContain(phrase);
  });

  it("puts the rules at the tools they belong to", async () => {
    expect(await description("log_workout_sets")).toContain(
      "zuerst nachfragen",
    );
    expect(await description("log_workout_sets")).toContain(
      "confirm_unusual_values",
    );
    expect(await description("update_set")).toContain(
      "nicht verwerfen und neu anlegen",
    );
    expect(await description("start_workout")).toContain("DATE_IN_FUTURE");
    expect(await description("void_set")).toContain("welcher gemeint ist");
    expect(await description("activate_training_plan")).toContain(
      "welcher aktiviert werden soll",
    );
    expect(await description("show_arnold_dashboard")).toContain(
      "start_workout erst",
    );
  });
});

describe("UX-003: the start view and the buttons", () => {
  it("opens the start view for a bare '@Arnold' and names the four buttons", () => {
    expect(ARNOLD_INSTRUCTIONS).toContain("„@Arnold“");
    expect(ARNOLD_INSTRUCTIONS).toContain("immer die Startansicht zeigen");
    for (const sentence of [
      "Zeig mir mein nächstes Training.",
      "Ich möchte meinen Plan ändern.",
      "Ich habe eine Ausnahme, zum Beispiel Urlaub.",
      "Ich möchte ein Ziel anpassen.",
    ])
      expect(ARNOLD_INSTRUCTIONS).toContain(`„${sentence}“`);
  });
});
