import { defineConfig } from "vitest/config";
export default defineConfig({
  // `.test.tsx` carries the React rendering tests, which assert that a real MCP
  // tool result reaches the interface with the right numbers and labels.
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    testTimeout: 15000,
  },
});
