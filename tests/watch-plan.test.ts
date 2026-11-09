/**
 * GAR-B2-04: the plan for the watch in parts (07 D-22). The builders are
 * checked against proposeSession on synthetic data with real UUID lengths and
 * German names; the routes against a real watch token on the test Postgres.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
  type ArnoldExercise,
  type ArnoldLoadBasis,
} from "../src/shared/arnold-schema-v1.js";
import { formatLoad } from "../src/shared/arnold-format.js";
import { WATCH_PLAN_BUDGET_BYTES } from "../src/shared/watch-contract.js";
import { demoHistoryDataset } from "../src/server/plan/demo-history.js";
import { proposeActivePlan } from "../src/server/workout/proposal.js";
import { weightStep } from "../src/analytics/progression.js";
import { estimateSessionMinutes } from "../src/analytics/session-duration.js";
import { nextSession } from "../src/analytics/home.js";
import { prepareAnalyticsInput } from "../src/analytics/eligibility.js";
import {
  DEFAULT_REST_S,
  buildDirectory,
  buildRecent,
  buildSession,
  etagOf,
  planRoutes,
} from "../src/server/watch/plan.js";
import { LOAD_SUFFIX } from "../src/server/watch/i18n.js";
import { mountWatchApi } from "../src/server/watch/router.js";
import type { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import {
  hashWatchToken,
  newWatchToken,
} from "../src/server/auth/watch-token.js";
import { PostgresIdentityRepository } from "../src/server/db/identity.js";
import { appDatabase, newAccount } from "./fixtures/arnold-db.js";

const TODAY = "2026-11-09";
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
const ts = "2026-01-01T00:00:00Z";
const technical = {
  created_at_utc: ts,
  updated_at_utc: ts,
  row_revision: 1,
};

/** Decodes [count, reps, load_g, side?] back into single sets. */
function decode(runs: readonly unknown[][]) {
  return runs.flatMap(([count, reps, load, side]) =>
    Array.from({ length: count as number }, () => ({
      reps,
      load_kg: load === null ? null : (load as number) / 1000,
      side: (side as string | undefined) ?? "both",
    })),
  );
}

interface Shape {
  days: number;
  perDay: number;
  alternatives: number;
  /** Five different working sets last time, without a rep range. */
  varied: boolean;
  text?: string;
}

/** A complete, valid dataset with UUID ids and German names. */
function syntheticDataset(shape: Shape): ArnoldDataset {
  const base = demoHistoryDataset(TODAY);
  const plan = `plv_${randomUUID()}`;
  const exercises: ArnoldExercise[] = [];
  const planItems: ArnoldDataset["planItems"][number][] = [];
  const workouts: ArnoldDataset["workouts"][number][] = [];
  const sets: ArnoldDataset["sets"][number][] = [];
  const names = [
    "Kurzhantel-Schrägbankdrücken",
    "Überzüge am Kabelzug",
    "Rumänisches Kreuzheben",
    "Bulgarische Kniebeuge",
    "Seitheben am Kabelzug",
    "Klimmzüge mit Zusatzgewicht",
    "Rudern am Kabelzug (eng)",
    "Beinbeuger sitzend",
  ];
  const exercise = (name: string, muscle: string, family: string) => {
    const row: ArnoldExercise = {
      exercise_id: `exc_${randomUUID()}`,
      name_de: name,
      name_en: null,
      family_key: family,
      variant_key: randomUUID().slice(0, 8),
      equipment: "Kurzhantel",
      primary_muscle: muscle,
      default_load_basis: "total",
      default_execution_mode: "bilateral_simultaneous",
      default_implement_count: 1,
      status: "active",
      ...technical,
    };
    exercises.push(row);
    return row;
  };
  const history = (exerciseId: string, name: string, workoutId: string) => {
    const values = shape.varied
      ? [
          [8, 60],
          [8, 62.5],
          [7, 60],
          [6, 57.5],
          [6, 55],
        ]
      : [
          [8, 60],
          [8, 60],
          [8, 60],
          [8, 60],
        ];
    values.forEach(([reps, load], i) =>
      sets.push({
        set_id: `set_${randomUUID()}`,
        workout_id: workoutId,
        exercise_id: exerciseId,
        plan_item_id: null,
        exercise_name_snapshot: name,
        exercise_order: 1,
        set_number: i + 1,
        set_type: "working",
        reps: reps!,
        reps_basis: "total",
        load_kg: load!,
        load_basis: "total",
        implement_count: 1,
        execution_mode: "bilateral_simultaneous",
        side: "both",
        rpe: null,
        rir: null,
        notes: null,
        status: "active",
        source: "chat",
        ...technical,
      }),
    );
  };
  const workoutId = `wko_${randomUUID()}`;
  workouts.push({
    workout_id: workoutId,
    workout_date_local: "2026-11-02",
    timezone: "Europe/Berlin",
    started_at_utc: null,
    ended_at_utc: null,
    plan_version_id: null,
    session_id: null,
    session_name_snapshot: "Vorher",
    status: "completed",
    source: "chat",
    notes: null,
    ...technical,
  });
  for (let day = 0; day < shape.days; day++) {
    const session = `s_${randomUUID()}`;
    for (let n = 0; n < shape.perDay; n++) {
      const muscle = `Muskel ${day}-${n}`,
        family = `familie-${day}-${n}`;
      const main = exercise(names[n % names.length]!, muscle, family);
      history(main.exercise_id, main.name_de, workoutId);
      for (let a = 0; a < shape.alternatives; a++) {
        const alt = exercise(
          `${names[(n + a + 1) % names.length]!}`,
          muscle,
          family,
        );
        if (shape.varied) history(alt.exercise_id, alt.name_de, workoutId);
      }
      planItems.push({
        plan_item_id: `pli_${randomUUID()}`,
        plan_version_id: plan,
        session_id: session,
        session_order: day + 1,
        session_name: `Oberkörper Ä${day + 1}`,
        exercise_id: main.exercise_id,
        exercise_order: n + 1,
        target_sets: shape.varied ? 5 : 4,
        rep_min: shape.varied ? null : 6,
        rep_max: shape.varied ? null : 10,
        target_load_kg: null,
        target_load_basis: null,
        target_execution_mode: null,
        target_implement_count: null,
        rest_seconds: n === 0 ? null : 90,
        notes: shape.text ?? null,
        status: "active",
        row_revision: 1,
      });
    }
  }
  return ArnoldDatasetSchema.parse({
    ...base,
    exercises,
    plans: [
      {
        ...base.plans.find((p) => p.status === "active")!,
        plan_version_id: plan,
        plan_family_id: `plf_${randomUUID()}`,
        version_no: 1,
      },
    ],
    planItems,
    workouts,
    sets,
    goals: [],
    bodyWeights: [],
  });
}

describe("watch plan builders (GAR-B2-04)", () => {
  it("delivers each day exactly as proposeSession proposes it", () => {
    const data = demoHistoryDataset(TODAY);
    const proposals = proposeActivePlan(data);
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      const day = buildSession(data, proposal.session_id, "de");
      expect(day.items.map((i) => i.id)).toEqual(
        proposal.exercises.map((e) => e.plan_item_id),
      );
      day.items.forEach((item, i) => {
        const expected = proposal.exercises[i]!;
        const entry = day.cat[item.c]!;
        const planItem = data.planItems.find(
          (p) => p.plan_item_id === item.id,
        )!;
        expect(entry.id).toBe(expected.exercise_id);
        expect(decode(entry.s as unknown[][])).toEqual(
          expected.sets.map((s) => ({
            reps: expected.missing.includes("reps") ? null : s.reps,
            load_kg: s.load_kg,
            side: s.side,
          })),
        );
        const exercise = data.exercises.find(
          (e) => e.exercise_id === expected.exercise_id,
        )!;
        expect(entry.g).toBe(
          Math.round(
            weightStep(exercise.equipment, expected.conventions.load_basis) *
              1000,
          ),
        );
        expect(item.r).toBe(planItem.rest_seconds ?? DEFAULT_REST_S);
        expect((item.a ?? []).length).toBeLessThanOrEqual(3);
        for (const run of entry.s) expect(run[3]).not.toBe("both");
      });
    }
  });

  it("keeps unknown values unknown, never 0, and the rest default at 120 s", () => {
    const data = structuredClone(demoHistoryDataset(TODAY)) as ArnoldDataset;
    const item = data.planItems.find(
      (i) =>
        data.plans.find((p) => p.status === "active")!.plan_version_id ===
        i.plan_version_id,
    )!;
    // A new exercise without history and without a target weight.
    const fresh: ArnoldExercise = {
      ...data.exercises.find((e) => e.exercise_id === item.exercise_id)!,
      exercise_id: "watch-fresh-exercise",
      name_de: "Neue Übung",
      family_key: "neu",
      primary_muscle: "Unterarme",
    };
    const added = {
      ...item,
      plan_item_id: "watch-fresh-item",
      exercise_id: fresh.exercise_id,
      exercise_order: 99,
      target_load_kg: null,
      rest_seconds: null,
    };
    const day = buildSession(
      ArnoldDatasetSchema.parse({
        ...data,
        exercises: [...data.exercises, fresh],
        planItems: [...data.planItems, added],
      }),
      item.session_id,
      "de",
    );
    const entry = day.items.find((i) => i.id === added.plan_item_id)!;
    expect(entry.x).toEqual(["load"]);
    expect(entry.r).toBe(120);
    expect(day.cat[entry.c]!.s.every((run) => run[2] === null)).toBe(true);
  });

  it("names the next day like the start screen and carries each day's ETag", () => {
    const data = demoHistoryDataset(TODAY);
    const directory = buildDirectory(data, "de");
    const next = nextSession(
      prepareAnalyticsInput(data, {
        from: null,
        to: null,
        exercise_ids: null,
        plan_version_ids: null,
        session_ids: null,
        workout_ids: null,
        set_types: null,
        workout_statuses: null,
      }),
    );
    expect(directory.next).toBe(next!.session_id);
    for (const day of directory.days) {
      expect(day.tag).toBe(etagOf(buildSession(data, day.id, "de")));
      const proposal = proposeActivePlan(data).find(
        (p) => p.session_id === day.id,
      )!;
      expect(day.m).toBe(
        estimateSessionMinutes(
          proposal.exercises.map((e) => ({
            sets: e.missing.includes("sets") ? null : e.sets.length,
            rest_seconds:
              data.planItems.find((i) => i.plan_item_id === e.plan_item_id)
                ?.rest_seconds ?? null,
          })),
        ),
      );
      expect(day.m).toBeGreaterThan(0);
    }
  });

  it("speaks German and English and words loads like arnold-format", () => {
    for (const basis of [
      "total",
      "per_implement",
      "machine_display",
      "added",
      "assistance",
    ] as ArnoldLoadBasis[])
      expect(formatLoad({ load_kg: 10, load_basis: basis })).toBe(
        `10 kg${LOAD_SUFFIX.de[basis] ? ` ${LOAD_SUFFIX.de[basis]}` : ""}`,
      );
    const data = demoHistoryDataset(TODAY);
    const id = buildDirectory(data, "de").next;
    const de = JSON.stringify(buildSession(data, id, "de"));
    const en = JSON.stringify(buildSession(data, id, "en"));
    expect(de).toContain("Letztes Mal");
    expect(en).toContain("Last time");
    expect(en).not.toContain("Letztes Mal");
  });

  it("stays within the D-22 budgets with real UUID lengths and umlauts", () => {
    const week = syntheticDataset({
      days: 7,
      perDay: 6,
      alternatives: 1,
      varied: false,
    });
    const directory = buildDirectory(week, "de");
    expect(directory.days).toHaveLength(7);
    const typical = buildSession(week, directory.days[0]!.id, "de");
    const extremeData = syntheticDataset({
      days: 1,
      perDay: 8,
      alternatives: 3,
      varied: true,
      text: "Schulterblätter zusammen, Ellbogen 45°, langsam ablassen!!",
    });
    const extreme = buildSession(
      extremeData,
      buildDirectory(extremeData, "de").next,
      "de",
    );
    expect(extreme.items.every((i) => i.a?.length === 3)).toBe(true);
    expect(extreme.cat[0]!.s).toHaveLength(5);
    const recent = buildRecent(extremeData, "de");
    expect(recent.cat).toHaveLength(10);
    const sizes = {
      directory: bytes(directory),
      typical: bytes(typical),
      extreme: bytes(extreme),
      recent: bytes(recent),
    };
    console.info("watch plan sizes (bytes)", sizes);
    expect(sizes.directory).toBeLessThanOrEqual(
      WATCH_PLAN_BUDGET_BYTES.directory,
    );
    expect(sizes.typical).toBeLessThanOrEqual(WATCH_PLAN_BUDGET_BYTES.typical);
    expect(sizes.extreme).toBeLessThanOrEqual(WATCH_PLAN_BUDGET_BYTES.extreme);
    expect(sizes.recent).toBeLessThanOrEqual(WATCH_PLAN_BUDGET_BYTES.recent);
  });
});

describe("watch plan routes (GAR-B2-04)", () => {
  const db = appDatabase();
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
            s.closeAllConnections();
          }),
      ),
    );
  });
  afterAll(() => db.close());
  const sha = (v: string) => createHash("sha256").update(v).digest();

  /**
   * The real token check against Postgres, with the user's data replaced by
   * a fixed dataset and a fixed setup state.
   */
  async function serve(dataset: ArnoldDataset | null, setupRequired = false) {
    const account = await newAccount(db);
    const identities = new PostgresIdentityRepository(db);
    const auth = {
      assertActive: async () => {},
    };
    const runtime = {
      options: { db, auth, identities },
      forUser: async () => ({
        onboarding: { setupRequired: async () => setupRequired },
        store: { read: async () => dataset ?? demoHistoryDataset(TODAY) },
      }),
      exclusive: <T>(_c: unknown, action: () => Promise<T>) => action(),
    } as unknown as DatabaseArnoldRuntime;
    const device = sha(randomUUID()),
      code = sha(randomUUID()),
      token = newWatchToken();
    await db.query("select * from arnold.start_watch_pairing($1,$2,$3,600)", [
      device,
      code,
      "Forerunner 255",
    ]);
    await db.asUser(account.userId, (c) =>
      c.query("select * from arnold.approve_watch_pairing($1,$2)", [
        code,
        "Europe/Berlin",
      ]),
    );
    await db.query("select * from arnold.redeem_watch_pairing($1,$2,$3)", [
      device,
      hashWatchToken(token),
      `wdv_${randomUUID()}`,
    ]);
    const app = express();
    app.use(express.json());
    mountWatchApi(app, { runtime, routes: planRoutes(runtime) });
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/watch/v1`;
    const get = (path: string, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${token}`, ...headers },
      });
    return { base, get };
  }

  it("serves directory, day and recent with ETag and 304", async () => {
    const { get } = await serve(null);
    const directory = await get("/plan", { "accept-language": "de-DE,de" });
    expect(directory.status).toBe(200);
    const tag = directory.headers.get("etag")!;
    const body = await directory.json();
    expect(tag).toBe(etagOf(body));
    expect(
      (
        await get("/plan", {
          "accept-language": "de-DE,de",
          "if-none-match": tag,
        })
      ).status,
    ).toBe(304);
    // Another language is another body, so the old tag does not match.
    expect((await get("/plan", { "if-none-match": tag })).status).toBe(200);
    const day = await get(`/plan/sessions/${body.next}`, {
      "accept-language": "de",
    });
    expect(day.status).toBe(200);
    expect(day.headers.get("etag")).toBe(
      body.days.find((d: { id: string }) => d.id === body.next).tag,
    );
    const again = await get(`/plan/sessions/${body.next}`, {
      "accept-language": "de",
      "if-none-match": day.headers.get("etag")!,
    });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const recent = await get("/plan/recent");
    expect(recent.status).toBe(200);
    expect((await recent.json()).cat.length).toBeLessThanOrEqual(10);
    expect((await get("/plan/sessions/unknown-day")).status).toBe(404);
  });

  it("answers SETUP_REQUIRED and NO_ACTIVE_PLAN in the watch error shape", async () => {
    const setup = await serve(null, true);
    const refused = await setup.get("/plan", { "accept-language": "de" });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatchObject({
      code: "SETUP_REQUIRED",
      message: "Schließe zuerst die Einrichtung in ChatGPT ab.",
    });
    const demo = demoHistoryDataset(TODAY);
    const noPlan = await serve(
      ArnoldDatasetSchema.parse({
        ...demo,
        plans: demo.plans.map((p) => ({
          ...p,
          status: "archived" as const,
          retired_at_utc: p.retired_at_utc ?? "2026-11-01T00:00:00Z",
        })),
      }),
    );
    const response = await noPlan.get("/plan/sessions/x");
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NO_ACTIVE_PLAN");
  });

  it("refuses a request without watch token", async () => {
    const { base } = await serve(null);
    expect((await fetch(`${base}/plan`)).status).toBe(401);
  });
});
