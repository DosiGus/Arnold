import { skybridge } from "@skybridge/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [skybridge(), react(), tailwindcss()],
  server: { forwardConsole: { unhandledErrors: true, logLevels: ["error"] } },
});
