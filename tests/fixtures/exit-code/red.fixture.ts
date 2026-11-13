import { expect, it } from "vitest";

// Fails on purpose. Not named *.test.ts, so the normal suite never runs it.
it("fails on purpose", () => {
  expect(1).toBe(2);
});
