import { GoogleAuth } from "google-auth-library";
import type { LogInput, Snapshot } from "../shared/schemas.js";
import type { StorageAdapter } from "./storage.js";
import { parseTrainingSheet } from "./sheet-parser.js";

export interface SheetsConfig {
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  headerRow: number;
  maxRows: number;
  keyFile?: string;
}
export interface SheetsTransport {
  get<T>(path: string, params: Record<string, string>): Promise<T>;
}
export class GoogleSheetsTransport implements SheetsTransport {
  private readonly auth: GoogleAuth;
  constructor(keyFile?: string) {
    this.auth = new GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }
  async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${path}`,
    );
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    try {
      const client = await this.auth.getClient();
      return (
        await client.request<T>({
          url: url.href,
          method: "GET",
          timeout: 15000,
        })
      ).data;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      if (status === 401 || status === 403)
        throw new Error(
          "Google-Sheets-Lesezugriff fehlt oder ist abgelaufen. Google-Berechtigung und aktivierte Sheets API prüfen.",
        );
      if (status === 404)
        throw new Error(
          "Die konfigurierte Tracker-Datei oder der freigegebene Tab wurde nicht gefunden.",
        );
      if (status === 429)
        throw new Error(
          "Google-Sheets-Leselimit erreicht. Bitte später erneut aktualisieren.",
        );
      // Auth-library errors can contain request headers and credential details.
      throw new Error(
        "Google Sheets konnte nicht gelesen werden. Lokale Google-Anmeldedatei, Netzwerk und API-Einrichtung prüfen.",
      );
    }
  }
}
interface Metadata {
  spreadsheetId: string;
  properties: { title: string };
  sheets: {
    properties: {
      sheetId: number;
      title: string;
      gridProperties: { rowCount: number; columnCount: number };
    };
  }[];
}
interface Values {
  values?: (string | number | boolean | null)[][];
}

export class GoogleSheetsStorageAdapter implements StorageAdapter {
  readonly mode = "google_sheets" as const;
  private pending?: Promise<Snapshot>;
  constructor(
    readonly config: SheetsConfig,
    private readonly transport: SheetsTransport = new GoogleSheetsTransport(
      config.keyFile,
    ),
  ) {
    if (!/^[a-zA-Z0-9_-]{10,200}$/.test(config.spreadsheetId))
      throw new Error("Ungültige Spreadsheet-ID.");
    if (!Number.isInteger(config.sheetId) || config.sheetId < 0)
      throw new Error("Ungültige Tab-ID.");
    if (!config.sheetTitle || config.sheetTitle.length > 100)
      throw new Error("Ungültiger Tab-Name.");
    if (
      !Number.isInteger(config.headerRow) ||
      config.headerRow < 1 ||
      !Number.isInteger(config.maxRows) ||
      config.maxRows <= config.headerRow ||
      config.maxRows > 100000
    )
      throw new Error("Ungültige Zeilengrenzen.");
  }
  private async read(): Promise<Snapshot> {
    const { spreadsheetId, sheetTitle, sheetId, headerRow, maxRows } =
      this.config;
    const tab = `'${sheetTitle.replaceAll("'", "''")}'`;
    const metadata = await this.transport.get<Metadata>(spreadsheetId, {
      ranges: `${tab}!A${headerRow}:G${headerRow}`,
      includeGridData: "false",
      fields:
        "spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
    });
    const sheet = metadata.sheets.find(
      (s) => s.properties.sheetId === sheetId,
    )?.properties;
    if (
      metadata.spreadsheetId !== spreadsheetId ||
      !sheet ||
      sheet.title !== sheetTitle
    )
      throw new Error(
        "Tracker-Datei oder Tab-ID stimmt nicht mit der freigegebenen Konfiguration überein.",
      );
    if (sheet.gridProperties.columnCount < 19)
      throw new Error(
        "Trainingslog hat nicht die erwarteten berechneten Spalten O:S.",
      );
    if (sheet.gridProperties.rowCount > maxRows)
      throw new Error(
        "Die Tabelle ist über die freigegebene Zeilengrenze gewachsen. Lesegrenze gezielt erhöhen, bevor Daten abgeschnitten werden.",
      );
    const end = Math.min(maxRows, sheet.gridProperties.rowCount);
    const input = await this.transport.get<Values>(
      `${spreadsheetId}/values/${encodeURIComponent(`${tab}!A${headerRow}:G${end}`)}`,
      {
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "SERIAL_NUMBER",
      },
    );
    const inputRows = input.values ?? [];
    const computedEnd = Math.min(
      end,
      headerRow + Math.max(0, inputRows.length - 1),
    );
    const computed = await this.transport.get<Values>(
      `${spreadsheetId}/values/${encodeURIComponent(`${tab}!O${headerRow}:S${computedEnd}`)}`,
      {
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "SERIAL_NUMBER",
      },
    );
    return parseTrainingSheet({
      inputRows,
      computedRows: computed.values ?? [],
      headerRow,
      spreadsheetId,
      sheetId,
      spreadsheetTitle: metadata.properties.title,
      sheetTitle,
      fetchedAt: new Date().toISOString(),
    });
  }
  getSnapshot(): Promise<Snapshot> {
    // Coalesce concurrent reads without keeping stale data between refreshes.
    if (!this.pending)
      this.pending = this.read().finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  async getWorkouts() {
    return (await this.getSnapshot()).workouts;
  }
  async getSets() {
    return (await this.getSnapshot()).sets;
  }
  async getExercises() {
    return (await this.getSnapshot()).exercises;
  }
  async saveSet(_input: LogInput): Promise<never> {
    throw new Error(
      "Google-Sheets-Modus ist lesend. Training weiter über das bestehende GPT-Logging in derselben Datei eintragen.",
    );
  }
  async resetDemoData(): Promise<never> {
    throw new Error(
      "Echte Google-Sheets-Trainingsdaten können nicht über den Demo-Reset gelöscht werden.",
    );
  }
}
