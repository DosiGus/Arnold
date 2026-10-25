import { isAbsolute, resolve } from "node:path";
import { GoogleSheetsStorageAdapter } from "./google-sheets-storage.js";
import { JsonStorageAdapter, type StorageAdapter } from "./storage.js";

export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
export function createStorage(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): StorageAdapter {
  const mode = env.STORAGE_MODE ?? "demo";
  if (mode === "demo")
    return new JsonStorageAdapter(
      resolve(root, env.DEMO_DATA_FILE ?? "data/demo.json"),
    );
  if (mode !== "google_sheets")
    throw new Error("STORAGE_MODE muss demo oder google_sheets sein.");
  if (env.MCP_ACCESS !== "private")
    throw new Error(
      "Echte Sheets-Daten erfordern MCP_ACCESS=private und eine private MCP-Verbindung. Der öffentliche Demo-Tunnel bleibt ausgeschlossen.",
    );
  const keyFile = env.GOOGLE_APPLICATION_CREDENTIALS;
  return new GoogleSheetsStorageAdapter({
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID ?? "",
    sheetId: Number(env.GOOGLE_SHEET_ID),
    sheetTitle: env.GOOGLE_SHEET_TITLE ?? "Trainingslog",
    headerRow: Number(env.GOOGLE_HEADER_ROW ?? "4"),
    maxRows: Number(env.GOOGLE_MAX_ROWS ?? "20004"),
    keyFile: keyFile
      ? isAbsolute(keyFile)
        ? keyFile
        : resolve(root, keyFile)
      : undefined,
  });
}
export function requirePrivateBinding(
  storage: StorageAdapter,
  host: string,
  allowedHosts: string[],
  allowedOrigins: string[],
) {
  if (storage.mode !== "google_sheets") return;
  if (
    !LOOPBACK_HOSTS.includes(host) ||
    allowedHosts.some((h) => !LOOPBACK_HOSTS.includes(h)) ||
    allowedOrigins.some(
      (origin) => !LOOPBACK_HOSTS.includes(new URL(origin).hostname),
    )
  ) {
    throw new Error(
      "Google-Sheets-Modus darf nur an Loopback gebunden sein und keine öffentlichen Hosts oder Origins freigeben. Einen privaten MCP-Tunnel verwenden.",
    );
  }
}
