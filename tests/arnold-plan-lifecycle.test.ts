import { describe, expect, it } from "vitest";
import { ArnoldPlanVersionSchema } from "../src/shared/arnold-schema-v1";
import { ArnoldDatasetSchema } from "../src/shared/arnold-schema-v1";
import { setField, stamp, v1Data } from "./fixtures/arnold-v1";
const plan = () => ArnoldDatasetSchema.parse(v1Data()).plans[1];
const earlier = "2026-09-30T12:00:00Z";
describe("QA F1: plan lifecycle", () => {
  it.each([
    ["draft", null, null],
    ["active", stamp, null],
    ["archived", earlier, stamp],
    ["archived", stamp, stamp],
  ] as const)(
    "accepts %s with activation=%s and retirement=%s",
    (status, activated, retired) => {
      expect(
        ArnoldPlanVersionSchema.safeParse({
          ...plan(),
          status,
          activated_at_utc: activated,
          retired_at_utc: retired,
        }).success,
      ).toBe(true);
    },
  );
  it.each([
    ["active", null, null, "activated_at_utc"],
    ["active", stamp, stamp, "retired_at_utc"],
    ["active", null, stamp, "activated_at_utc"],
    ["draft", stamp, null, "activated_at_utc"],
    ["draft", null, stamp, "retired_at_utc"],
    ["draft", stamp, stamp, "activated_at_utc"],
    ["archived", null, null, "activated_at_utc"],
    ["archived", stamp, null, "retired_at_utc"],
    ["archived", null, stamp, "activated_at_utc"],
    ["archived", stamp, earlier, "retired_at_utc"],
    ["active", "not-a-date", null, "activated_at_utc"],
    ["active", "2026-10-01T14:00:00+02:00", null, "activated_at_utc"],
  ] as const)(
    "rejects %s with activation=%s and retirement=%s",
    (status, activated, retired, column) => {
      const result = ArnoldPlanVersionSchema.safeParse({
        ...plan(),
        status,
        activated_at_utc: activated,
        retired_at_utc: retired,
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(
          result.error.issues.some((issue) => issue.path[0] === column),
        ).toBe(true);
    },
  );
  it("reports an invalid active plan at its dataset path", () => {
    const data = v1Data();
    setField(data, "plans", 1, "activated_at_utc", null);
    const result = ArnoldDatasetSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "plans",
        1,
        "activated_at_utc",
      ]);
  });
});
