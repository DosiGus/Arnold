import { describe, expect, test } from "vitest";
import {
  analyzeSetLoad,
  comparabilityOf,
  setBucket,
} from "../src/analytics/load";
import { ArnoldSetSchema } from "../src/shared/arnold-schema-v1";
import { set } from "./fixtures/arnold-analytics";

const analyse = (overrides: Record<string, unknown>) =>
  analyzeSetLoad(ArnoldSetSchema.parse(set(overrides)), "2026-01-05");

describe("load and repetition conventions", () => {
  test("A barbell set uses the total load as recorded", () => {
    const result = analyse({ load_kg: 70, load_basis: "total", reps: 10 });
    expect(result.load_per_rep_kg).toBe(70);
    expect(result.total_reps).toBe(10);
    expect(result.nominal_volume_kg).toBe(700);
    expect(result.channel).toBe("free_weight");
    expect(result.volume_status).toBe("valid");
    expect(result.volume_reasons).toEqual([]);
  });

  test("B two dumbbells moved together count both implements", () => {
    const result = analyse({
      load_kg: 20,
      load_basis: "per_implement",
      implement_count: 2,
      reps: 10,
    });
    expect(result.implements_per_rep).toBe(2);
    expect(result.load_per_rep_kg).toBe(40);
    expect(result.nominal_volume_kg).toBe(400);
  });

  test("C a unilateral row is one record per side", () => {
    const right = analyse({
      load_kg: 20,
      load_basis: "per_implement",
      implement_count: 1,
      execution_mode: "unilateral",
      side: "right",
      reps: 10,
    });
    const left = analyse({
      set_id: "s-2",
      load_kg: 20,
      load_basis: "per_implement",
      implement_count: 1,
      execution_mode: "unilateral",
      side: "left",
      reps: 10,
    });
    expect(right.sides_trained).toBe(1);
    expect(right.nominal_volume_kg).toBe(200);
    expect(left.nominal_volume_kg).toBe(200);
    expect(right.nominal_volume_kg! + left.nominal_volume_kg!).toBe(400);
    expect(right.comparability.key).not.toBe(left.comparability.key);
  });

  test("D alternating work moves one implement per repetition", () => {
    const total = analyse({
      load_kg: 12,
      load_basis: "per_implement",
      implement_count: 2,
      execution_mode: "alternating",
      side: "alternating",
      reps: 10,
      reps_basis: "total",
    });
    expect(total.implements_per_rep).toBe(1);
    expect(total.total_reps).toBe(10);
    expect(total.nominal_volume_kg).toBe(120);

    const perSide = analyse({
      load_kg: 12,
      load_basis: "per_implement",
      implement_count: 2,
      execution_mode: "alternating",
      side: "alternating",
      reps: 10,
      reps_basis: "per_side",
    });
    expect(perSide.sides_trained).toBe(2);
    expect(perSide.total_reps).toBe(20);
    expect(perSide.nominal_volume_kg).toBe(240);
  });

  test("E machine volume is computed but kept in its own channel", () => {
    const result = analyse({
      load_kg: 60,
      load_basis: "machine_display",
      reps: 10,
    });
    expect(result.nominal_volume_kg).toBe(600);
    expect(result.channel).toBe("machine_display");
    expect(result.load_reference).toBe("machine_display");
    expect(result.volume_reasons).toContain(
      "machine_load_not_free_weight_comparable",
    );
  });

  test("F added load reports the extra load only, never a total", () => {
    const result = analyse({ load_kg: 10, load_basis: "added", reps: 8 });
    expect(result.nominal_volume_kg).toBe(80);
    expect(result.channel).toBe("added_external");
    expect(result.volume_status).toBe("partial");
    expect(result.volume_reasons).toContain("added_load_total_unavailable");
    expect(result.one_rm_kg).toBeNull();
    expect(result.one_rm_reasons).toContain("load_basis_not_one_rm_comparable");
  });

  test("bodyweight work without a body mass yields no volume, not zero", () => {
    const result = analyse({
      load_kg: null,
      load_basis: "bodyweight_only",
      reps: 12,
    });
    expect(result.nominal_volume_kg).toBeNull();
    expect(result.volume_status).toBe("not_available");
    expect(result.volume_reasons).toContain(
      "bodyweight_total_load_unavailable",
    );
    expect(result.comparable_load_kg).toBeNull();
  });

  test("a recorded zero bodyweight load stays unknown rather than zero volume", () => {
    const result = analyse({
      load_kg: 0,
      load_basis: "bodyweight_only",
      reps: 5,
    });
    expect(result.nominal_volume_kg).toBeNull();
    expect(result.volume_status).toBe("not_available");
  });

  test("assistance load is not a volume contribution", () => {
    const result = analyse({ load_kg: 25, load_basis: "assistance", reps: 8 });
    expect(result.nominal_volume_kg).toBeNull();
    expect(result.volume_reasons).toContain(
      "assistance_load_not_volume_comparable",
    );
    expect(result.comparable_load_kg).toBeNull();
  });

  test("per-side repetitions on a simultaneous bilateral set are rejected", () => {
    const result = analyse({ reps_basis: "per_side" });
    expect(result.volume_status).toBe("invalid");
    expect(result.nominal_volume_kg).toBeNull();
    expect(result.volume_reasons).toEqual([
      "reps_basis_ambiguous_for_execution_mode",
    ]);
    expect(result.one_rm_status).toBe("invalid");
  });

  test("zero repetitions are a documented attempt with zero volume", () => {
    const result = analyse({ reps: 0 });
    expect(result.total_reps).toBe(0);
    expect(result.nominal_volume_kg).toBe(0);
    expect(result.volume_reasons).toContain("reps_zero");
    expect(result.one_rm_kg).toBeNull();
    expect(result.one_rm_reasons).toContain("reps_out_of_epley_range");
  });

  test("an extreme load that overflows is reported as invalid, never as Infinity", () => {
    const result = analyse({ load_kg: Number.MAX_VALUE, reps: 10 });
    expect(result.nominal_volume_kg).toBeNull();
    expect(result.volume_status).toBe("invalid");
    expect(result.volume_reasons).toContain("volume_not_finite");
  });

  test("set type decides which bucket a set belongs to", () => {
    expect(setBucket("warmup")).toBe("warmup");
    expect(setBucket("working")).toBe("working");
    expect(setBucket("drop")).toBe("supplemental");
    expect(setBucket("failure")).toBe("supplemental");
    expect(setBucket("other")).toBe("supplemental");
  });

  test("comparability pins the execution, and side only where it differs", () => {
    const unilateral = comparabilityOf(
      ArnoldSetSchema.parse(
        set({ execution_mode: "unilateral", side: "left" }),
      ),
    );
    expect(unilateral.side).toBe("left");
    expect(comparabilityOf(ArnoldSetSchema.parse(set())).side).toBeNull();
    // JSON encoding, so an id containing the separator cannot collide.
    expect(comparabilityOf(ArnoldSetSchema.parse(set())).key).toBe(
      '["ex-bar-press","total","bilateral_simultaneous",1,null]',
    );
  });

  test("the set input is never mutated", () => {
    const raw = ArnoldSetSchema.parse(set());
    const before = JSON.stringify(raw);
    analyzeSetLoad(raw, "2026-01-05");
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("estimated one-rep maximum", () => {
  test("a single repetition is the load itself", () => {
    expect(analyse({ reps: 1, load_kg: 100 }).one_rm_kg).toBe(100);
  });

  test("eight repetitions follow Epley", () => {
    const result = analyse({ reps: 8, load_kg: 90 });
    expect(result.one_rm_kg).toBe(114);
    expect(result.one_rm_status).toBe("valid");
  });

  test("more than ten repetitions are outside the supported range", () => {
    const result = analyse({ reps: 11, load_kg: 90 });
    expect(result.one_rm_kg).toBeNull();
    expect(result.one_rm_status).toBe("not_available");
    expect(result.one_rm_reasons).toContain("reps_out_of_epley_range");
  });

  test("a per-implement estimate stays a per-implement value", () => {
    const result = analyse({
      load_kg: 30,
      load_basis: "per_implement",
      implement_count: 2,
      reps: 6,
    });
    expect(result.one_rm_kg).toBe(36);
    expect(result.load_reference).toBe("per_implement");
    expect(result.one_rm_reasons).toContain("value_is_per_implement");
  });

  test("a machine estimate is labelled as device specific", () => {
    const result = analyse({
      load_kg: 60,
      load_basis: "machine_display",
      reps: 5,
    });
    expect(result.one_rm_kg).toBe(70);
    expect(result.one_rm_reasons).toContain("value_is_machine_specific");
  });

  test("alternating repetitions recorded as a total give no estimate", () => {
    const result = analyse({
      execution_mode: "alternating",
      side: "alternating",
      reps: 9,
      reps_basis: "total",
    });
    expect(result.one_rm_kg).toBeNull();
    expect(result.one_rm_reasons).toContain("reps_per_side_ambiguous");
  });

  test("warm-up and drop sets never produce an estimate", () => {
    expect(analyse({ set_type: "warmup", reps: 5 }).one_rm_reasons).toContain(
      "set_type_not_working",
    );
    expect(analyse({ set_type: "drop", reps: 5 }).one_rm_kg).toBeNull();
  });

  test("a bodyweight set has no effective load to estimate from", () => {
    const result = analyse({
      load_kg: null,
      load_basis: "bodyweight_only",
      reps: 6,
    });
    expect(result.one_rm_kg).toBeNull();
    expect(result.one_rm_reasons).toContain(
      "bodyweight_total_load_unavailable",
    );
  });
});
