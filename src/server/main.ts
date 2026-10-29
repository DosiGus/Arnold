import { createConfiguredHttpApp } from "./bootstrap.js";
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT muss zwischen 1 und 65535 liegen.");
const server = (await createConfiguredHttpApp({ host })).listen(
  port,
  host,
  () => {
    console.log(
      `Arnold · ${process.env.STORAGE_MODE === "arnold_connected" ? "Google Sheets (persönlich, authentifiziert, Einzelserver-Entwicklung)" : process.env.STORAGE_MODE === "google_sheets" || process.env.STORAGE_MODE === "arnold_sheets" ? "Google Sheets (lesend, privat)" : "synthetische Demo"}\nPreview: http://localhost:${port}/preview\nMCP Apps Test-Host: http://localhost:${port}/host\nMCP: http://localhost:${port}/mcp`,
    );
  },
);
const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
