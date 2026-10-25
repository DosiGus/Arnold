import { describe, expect, it } from "vitest";
import { parseArnoldTables } from "../src/server/arnold-sheet-parser";
import { v1Tables, setCell, V1_HEADERS } from "./fixtures/arnold-v1";
describe("QA F2: typed literal text", () => {
  it.each([
    ["CONFIG", "description"],
    ["EXERCISES", "name_de"],
    ["EXERCISES", "name_en"],
    ["PLANS", "name"],
    ["PLAN_ITEMS", "notes"],
    ["WORKOUTS", "notes"],
    ["SETS", "notes"],
  ] as const)("preserves leading equals in literal %s.%s", (table, column) => {
    const tables = v1Tables(),
      literal = "=SUM(1, 2) is literal text, not a formula";
    setCell(tables, table, 0, column, literal);
    const data = parseArnoldTables(tables);
    const records = {
      CONFIG: data.configEntries,
      EXERCISES: data.exercises,
      PLANS: data.plans,
      PLAN_ITEMS: data.planItems,
      WORKOUTS: data.workouts,
      SETS: data.sets,
    };
    expect(
      (records[table][0] as unknown as Record<string, unknown>)[column],
    ).toBe(literal);
    expect(
      tables[table][1][
        (V1_HEADERS[table] as readonly string[]).indexOf(column)
      ],
    ).toBe(literal);
  });
});
