import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import {
  ARNOLD_TABLES,
  ARNOLD_TABLE_HEADERS,
  type ArnoldDataset,
  type ArnoldTable,
} from "../shared/arnold-schema-v1.js";
import {
  ArnoldDataError,
  arnoldColumnLetter,
  parseArnoldTables,
  type ArnoldSheetCell,
} from "./arnold-sheet-parser.js";

import { parseArnoldGrid } from "./arnold-grid-parser.js";

/** This interface deliberately has no append, update, reset, delete or generic request method. */
export interface ArnoldSheetsReadTransport {
  get<T>(path: string, params: Readonly<Record<string, string>>): Promise<T>;
}
export interface ArnoldSheetsReadOptions {
  readonly spreadsheetId: string;
  readonly keyFile?: string;
  readonly expectedTrackerId?: string;
  readonly expectedFileRole?: "MASTER_TEMPLATE" | "USER_TRACKER";
  readonly maxRowsPerTable?: number;
  readonly maxColumnsPerTable?: number;
}
export class ArnoldSheetsReadError extends Error {
  constructor(
    readonly code:
      | "AUTH"
      | "PERMISSION"
      | "NOT_FOUND"
      | "RATE_LIMIT"
      | "UNAVAILABLE"
      | "API",
    readonly status?: number,
  ) {
    const messages = {
      AUTH: "Google-Anmeldung fehlt oder ist abgelaufen.",
      PERMISSION:
        "Google-Sheets-Leseberechtigung fehlt oder die Sheets API ist nicht aktiviert.",
      NOT_FOUND: "Konfigurierte Arnold-Datei oder Tabelle nicht gefunden.",
      RATE_LIMIT: "Google-Sheets-Leselimit erreicht; später erneut versuchen.",
      UNAVAILABLE: "Google Sheets ist vorübergehend nicht verfügbar.",
      API: "Google Sheets konnte nicht gelesen werden; Anmeldung und Netzwerk prüfen.",
    };
    super(messages[code]);
    this.name = "ArnoldSheetsReadError";
  }
}
function apiError(error: unknown): ArnoldSheetsReadError {
  if (error instanceof ArnoldSheetsReadError) return error;
  const candidate = error as {
    response?: { status?: unknown };
    status?: unknown;
  } | null;
  const raw = candidate?.response?.status ?? candidate?.status;
  const status =
    typeof raw === "number" && Number.isInteger(raw) && raw >= 100 && raw <= 599
      ? raw
      : undefined;
  return new ArnoldSheetsReadError(
    status === 401
      ? "AUTH"
      : status === 403
        ? "PERMISSION"
        : status === 404
          ? "NOT_FOUND"
          : status === 429
            ? "RATE_LIMIT"
            : status !== undefined && status >= 500
              ? "UNAVAILABLE"
              : "API",
    status,
  );
}
class GoogleArnoldReadTransport implements ArnoldSheetsReadTransport {
  private readonly auth: GoogleAuth;
  constructor(keyFile?: string) {
    this.auth = new GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }
  async get<T>(
    path: string,
    params: Readonly<Record<string, string>>,
  ): Promise<T> {
    try {
      const client = await this.auth.getClient();
      const url = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${path}`,
      );
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
      return (
        await client.request<T>({
          url: url.href,
          method: "GET",
          timeout: 15000,
        })
      ).data;
    } catch (error) {
      throw apiError(error);
    }
  }
}
const metadataSchema = z.object({
  spreadsheetId: z.string(),
  sheets: z.array(
    z.object({
      properties: z.object({
        sheetId: z.number().int().nonnegative(),
        title: z.string(),
        index: z.number().int().nonnegative(),
        gridProperties: z.object({
          rowCount: z.number().int().positive(),
          columnCount: z.number().int().positive(),
        }),
      }),
      merges: z.array(z.unknown()).optional(),
    }),
  ),
});
const optionsSchema = z.strictObject({
  spreadsheetId: z.string().regex(/^[a-zA-Z0-9_-]{10,200}$/),
  keyFile: z.string().min(1).optional(),
  expectedTrackerId: z.string().min(1).optional(),
  expectedFileRole: z.enum(["MASTER_TEMPLATE", "USER_TRACKER"]).optional(),
  maxRowsPerTable: z.number().int().min(1).max(100000).default(10000),
  maxColumnsPerTable: z.number().int().min(23).max(64).default(64),
});

/** Separate data-access API; does not implement the legacy demo StorageAdapter or publish MCP tools. */
export class ArnoldSheetsReadAdapter {
  readonly readOnly = true as const;
  private readonly options: z.infer<typeof optionsSchema>;
  private readonly transport: ArnoldSheetsReadTransport;
  private pending?: Promise<ArnoldDataset>;
  constructor(
    options: ArnoldSheetsReadOptions,
    transport?: ArnoldSheetsReadTransport,
  ) {
    const validated = optionsSchema.safeParse(options);
    if (!validated.success)
      throw new ArnoldDataError([
        {
          code: "OPTIONS",
          message:
            "Ungültige Arnold-Lesekonfiguration: Datei-ID, erwartete Identität oder Lesegrenzen prüfen.",
        },
      ]);
    this.options = Object.freeze(validated.data);
    this.transport =
      transport ?? new GoogleArnoldReadTransport(this.options.keyFile);
  }
  private async get<T>(
    path: string,
    params: Readonly<Record<string, string>>,
  ): Promise<T> {
    try {
      return await this.transport.get<T>(path, params);
    } catch (error) {
      throw apiError(error);
    }
  }
  private async read(): Promise<ArnoldDataset> {
    const { spreadsheetId, maxRowsPerTable, maxColumnsPerTable } = this.options;
    const response = await this.get<unknown>(spreadsheetId, {
      includeGridData: "false",
      fields:
        "spreadsheetId,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),merges)",
    });
    const meta = metadataSchema.safeParse(response);
    if (!meta.success)
      throw new ArnoldDataError([
        {
          code: "METADATA",
          message: "Google Sheets lieferte ungültige Tabellen-Metadaten.",
        },
      ]);
    const sheets = [...meta.data.sheets].sort(
      (a, b) => a.properties.index - b.properties.index,
    );
    if (
      meta.data.spreadsheetId !== spreadsheetId ||
      sheets.length !== ARNOLD_TABLES.length ||
      ARNOLD_TABLES.some(
        (name, i) =>
          sheets[i]?.properties.title !== name ||
          sheets[i]?.properties.index !== i,
      ) ||
      new Set(sheets.map((s) => s.properties.sheetId)).size !== sheets.length
    )
      throw new ArnoldDataError([
        {
          code: "TABLES",
          message:
            "Datei-ID oder die sechs erwarteten Tabellen in ihrer Reihenfolge stimmen nicht überein.",
        },
      ]);
    for (let i = 0; i < sheets.length; i++) {
      const { rowCount, columnCount } = sheets[i].properties.gridProperties;
      if (
        rowCount > maxRowsPerTable ||
        columnCount > maxColumnsPerTable ||
        rowCount * columnCount > 1000000 ||
        columnCount < ARNOLD_TABLE_HEADERS[ARNOLD_TABLES[i]].length
      )
        throw new ArnoldDataError([
          {
            code: "BOUNDS",
            table: ARNOLD_TABLES[i],
            message:
              "Tabellengröße liegt außerhalb der konfigurierten Lesegrenzen oder bietet zu wenig Spalten; kein stilles Abschneiden.",
          },
        ]);
      if (sheets[i].merges?.length)
        throw new ArnoldDataError([
          {
            code: "MERGES",
            table: ARNOLD_TABLES[i],
            message: "Verbundene Zellen sind im Rohdatenschema nicht zulässig.",
          },
        ]);
    }
    const entries = await Promise.all(
      sheets.map(async (sheet, i) => {
        const table = ARNOLD_TABLES[i];
        const { rowCount, columnCount } = sheet.properties.gridProperties;
        const range = `'${table}'!A1:${arnoldColumnLetter(columnCount - 1)}${rowCount}`;
        // Read literals and formula provenance in the same response; do not use
        // evaluated/formatted values or a second, potentially racing formula read.
        const result = await this.get<unknown>(spreadsheetId, {
          ranges: range,
          includeGridData: "true",
          fields:
            "spreadsheetId,sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue))))",
        });
        const rows = parseArnoldGrid(result, {
          spreadsheetId,
          sheetId: sheet.properties.sheetId,
          table,
          rowCount,
          columnCount,
        });
        return [table, rows] as const;
      }),
    );
    const tables: Record<ArnoldTable, ArnoldSheetCell[][]> = {
      CONFIG: [],
      EXERCISES: [],
      PLANS: [],
      PLAN_ITEMS: [],
      WORKOUTS: [],
      SETS: [],
    };
    for (const [table, rows] of entries) tables[table] = rows;
    const dataset = parseArnoldTables(tables);
    if (
      (this.options.expectedTrackerId !== undefined &&
        dataset.config.tracker_id !== this.options.expectedTrackerId) ||
      (this.options.expectedFileRole !== undefined &&
        dataset.config.file_role !== this.options.expectedFileRole)
    )
      throw new ArnoldDataError([
        {
          code: "IDENTITY",
          table: "CONFIG",
          message:
            "Tracker-ID oder Dateityp stimmt nicht mit der erwarteten Konfiguration überein.",
        },
      ]);
    return dataset;
  }
  getDataset(): Promise<ArnoldDataset> {
    // One in-flight read is shared; there is no fixture fallback or persistent snapshot cache.
    if (!this.pending)
      this.pending = this.read().finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}
