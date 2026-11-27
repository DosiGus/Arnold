import { ArnoldExerciseSchema } from "../src/shared/arnold-schema-v1.js";
import { expect, it } from "vitest";
import { similarExercises } from "../src/analytics/alternatives.js";
import {
  exercise,
  dataset,
  plan,
  planItem,
} from "./fixtures/arnold-analytics.js";
import { nextSession } from "../src/analytics/home.js";
import {
  prepareAnalytics,
  buildHomeAnalytics,
} from "../src/analytics/index.js";
it("offers the same movement family first, then the same muscle", () => {
  const catalog = [
    exercise({
      exercise_id: "base",
      family_key: "press",
      primary_muscle: " chest ",
    }),
    exercise({ exercise_id: "z", family_key: "press", name_de: "Zug" }),
    exercise({
      exercise_id: "a",
      family_key: "other",
      primary_muscle: "CHEST",
      name_de: "Andere",
    }),
    exercise({
      exercise_id: "retired",
      family_key: "press",
      status: "retired",
    }),
  ];
  expect(
    similarExercises(
      catalog.map((v) => ArnoldExerciseSchema.parse(v)),
      "base",
    ).map((e) => e.exercise_id),
  ).toEqual(["z", "a"]);
  expect(
    similarExercises(
      catalog.map((v) => ArnoldExerciseSchema.parse(v)),
      "missing",
    ),
  ).toEqual([]);
  expect(catalog.map((e) => e.exercise_id)).toEqual([
    "base",
    "z",
    "a",
    "retired",
  ]);
});
it("exports the exact next-session rule used by the home screen", () => {
  const data = dataset({ plans: [plan()], planItems: [planItem()] });
  expect(nextSession(prepareAnalytics(data))).toEqual(
    buildHomeAnalytics(data).next_session,
  );
  expect(
    nextSession(prepareAnalytics(dataset({ plans: [], planItems: [] }))),
  ).toBeNull();
});
