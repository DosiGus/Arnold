import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";

const directory = new URL("../src/analytics/", import.meta.url);
const files = readdirSync(directory)
  .filter((name) => name.endsWith(".ts"))
  .sort();
const sourceOf = (name: string) =>
  readFileSync(new URL(name, directory), "utf8");
const importsOf = (source: string) =>
  [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

/** Guards the architectural boundary the engine is built on. */
describe("analytics engine boundaries", () => {
  test("every module of the layer is present", () => {
    expect(files).toEqual([
      "activity.ts",
      "alternatives.ts",
      "dashboard.ts",
      "eligibility.ts",
      "goals.ts",
      "health-daily.ts",
      "home.ts",
      "index.ts",
      "load.ts",
      "period.ts",
      "plans.ts",
      "progress.ts",
      "progression.ts",
      "quality.ts",
      "recap.ts",
      "recording.ts",
      "records.ts",
      "scores.ts",
      "session-duration.ts",
      "start-load.ts",
      "trends.ts",
      "types.ts",
      "validation.ts",
      "volume.ts",
    ]);
  });

  test("the layer imports nothing but Zod and the validated raw schema", () => {
    const external = new Set<string>();
    for (const name of files)
      for (const specifier of importsOf(sourceOf(name)))
        if (!specifier.startsWith("./")) external.add(specifier);
    expect([...external].sort()).toEqual([
      "../shared/arnold-schema-v1.js",
      "zod",
    ]);
  });

  test("no module reads a wall clock", () => {
    for (const name of files)
      expect(sourceOf(name), `${name} must stay deterministic`).not.toMatch(
        /new Date\(\)|Date\.now\(/,
      );
  });

  test("the demo calculations and storage stay untouched by the new layer", () => {
    for (const name of files)
      for (const specifier of importsOf(sourceOf(name)))
        expect(specifier).not.toMatch(
          /calculations|schemas|storage|google|mcp|http|express|react|recharts|node:fs/i,
        );
  });
});
