// Lint rules for the TypeScript sources. Formatting stays with Prettier;
// ESLint only looks for mistakes the compiler does not catch, above all
// promises that are neither awaited nor handled.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "data/",
      "test-results/",
      "playwright-report/",
      "apps/",
      ".claude/",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "*.config.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      // Async React handlers and timers are fine; the rule still catches a
      // promise used as a condition.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Hook rules only where React runs. Missing effect dependencies are
    // shown as warnings: each one is a judgement call, not a build stopper.
    files: ["src/views/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Test doubles and page stubs may use `any`; leftovers in tests are
    // shown, not fatal.
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
