import { describe, expect, it } from "vitest";
import { planChangeRows } from "../src/shared/plan-change-rows";
import {
  PLAN_CHANGE_KINDS,
  type PlanChange,
} from "../src/shared/plan-contract";

const change = (
  kind: PlanChange["kind"],
  parts: Partial<PlanChange> = {},
): PlanChange => ({
  kind,
  session_id: null,
  session_name: null,
  plan_item_id: null,
  exercise_id: null,
  exercise_name: null,
  field: null,
  before: null,
  after: null,
  label: "technisch",
  ...parts,
});

describe("planChangeRows", () => {
  it("shows a moved training day as position old → new", () => {
    const [row] = planChangeRows([
      change("session_reordered", {
        session_name: "Pull",
        field: "session_order",
        before: "2",
        after: "1",
      }),
    ]);
    expect(row).toMatchObject({
      label: "Pull verschoben",
      before: "Position 2",
      after: "Position 1",
    });
  });

  it("shows a swapped exercise under its training day", () => {
    const [row] = planChangeRows([
      change("exercise_replaced", {
        session_name: "Push",
        exercise_name: "Schrägbankdrücken",
        before: "Bankdrücken",
        after: "Schrägbankdrücken",
      }),
    ]);
    expect(row).toMatchObject({
      label: "Push",
      before: "Bankdrücken",
      after: "Schrägbankdrücken",
    });
  });

  it("names added and removed things with a plain counterpart", () => {
    const rows = planChangeRows([
      change("exercise_added", { session_name: "Push", after: "Dips" }),
      change("exercise_removed", { session_name: "Push", before: "Flys" }),
      change("session_added", { after: "Arme" }),
      change("session_removed", { before: "Beine" }),
    ]);
    expect(rows.map((r) => [r.before, r.after])).toEqual([
      ["nicht dabei", "Dips"],
      ["Flys", "entfällt"],
      ["nicht dabei", "Arme"],
      ["Beine", "entfällt"],
    ]);
  });

  it("labels a target change with day, exercise and a readable field", () => {
    const [row] = planChangeRows([
      change("targets_changed", {
        session_name: "Push",
        exercise_name: "Bankdrücken",
        field: "target_sets",
        before: "3",
        after: "4",
      }),
    ]);
    expect(row).toMatchObject({
      label: "Push · Bankdrücken · Sätze",
      before: "3",
      after: "4",
    });
  });

  it("says 'nicht gesetzt' for a missing side, never null", () => {
    const [row] = planChangeRows([
      change("targets_changed", {
        session_name: "Push",
        exercise_name: "Bankdrücken",
        field: "target_load_kg",
        before: null,
        after: "60 kg",
      }),
    ]);
    expect(row.before).toBe("nicht gesetzt");
  });

  it("maps every change kind to exactly one row with unique keys", () => {
    const rows = planChangeRows(PLAN_CHANGE_KINDS.map((kind) => change(kind)));
    expect(rows).toHaveLength(PLAN_CHANGE_KINDS.length);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.label).not.toBe("");
      expect(`${row.before}${row.after}`).not.toMatch(/null|undefined/);
    }
  });

  it("gives an empty comparison no rows", () => {
    expect(planChangeRows([])).toEqual([]);
  });
});
