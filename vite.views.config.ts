import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The new card views (Skybridge web runtime + Apps SDK UI). Each view is one
 * self-contained HTML file: JS and CSS inlined, no external assets, so the
 * card runs under an empty CSP. One build per view (`VIEW=onboarding|dashboard`).
 */
const view = process.env.VIEW ?? "dashboard";
export default defineConfig({
  root: "src/views",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: `../../dist/views/${view}`,
    emptyOutDir: true,
    rolldownOptions: { input: `src/views/${view}.html` },
  },
});
