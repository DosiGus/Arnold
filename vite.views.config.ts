import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The card views (Skybridge web runtime + Apps SDK UI) and the local test
 * host. Each is one self-contained HTML file: JS and CSS inlined, no external
 * assets, so a card runs under an empty CSP. One build per page
 * (`VIEW=onboarding|dashboard|host`).
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
