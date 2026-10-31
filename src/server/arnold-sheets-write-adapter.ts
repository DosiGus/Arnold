import {
  googleReauthWriteError,
  isGoogleReauthRequired,
} from "./google/reauth.js";
import { GoogleAuth } from "google-auth-library";
import {
  ARNOLD_TABLE_HEADERS,
  type ArnoldDataset,
  type ArnoldTable,
} from "../shared/arnold-schema-v1.js";
import {
  ArnoldSheetsReadAdapter,
  ArnoldSheetsReadError,
  type ArnoldSheetsReadTransport,
} from "./arnold-sheets-read-adapter.js";
import { parseArnoldGrid } from "./arnold-grid-parser.js";
import {
  ArnoldDataError,
  type ArnoldSheetCell,
} from "./arnold-sheet-parser.js";
import {
  WriteError,
  changedDataset,
  fingerprint,
  entityId,
  type ArnoldWriteRepository,
  type EntityChange,
  type Actor,
} from "./workout/infrastructure.js";

export const ARNOLD_MASTER_SPREADSHEET_ID =
  "1KMhPGrJSTZYRY5zKpVF3-Zc0tRdCZBV5zez46cJBzcc";
export type TextCell = {
  userEnteredValue?: { stringValue: string } | { numberValue: number };
};
export type SheetsWriteRequest =
  | {
      appendCells: {
        sheetId: number;
        rows: { values: TextCell[] }[];
        fields: "userEnteredValue";
      };
    }
  | {
      updateCells: {
        range: {
          sheetId: number;
          startRowIndex: number;
          endRowIndex: number;
          startColumnIndex: 0;
          endColumnIndex: number;
        };
        rows: { values: TextCell[] }[];
        fields: "userEnteredValue";
      };
    };
export interface ArnoldSheetsWriteTransport extends ArnoldSheetsReadTransport {
  batchUpdate(
    spreadsheetId: string,
    requests: readonly SheetsWriteRequest[],
  ): Promise<void>;
}
/** Explicit service-account transport for a dedicated test workbook; never created from an MCP payload. */
export class GoogleTestSheetsWriteTransport implements ArnoldSheetsWriteTransport {
  private auth: GoogleAuth;
  constructor(keyFile: string) {
    this.auth = new GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  async get<T>(
    path: string,
    params: Readonly<Record<string, string>>,
  ): Promise<T> {
    const client = await this.auth.getClient();
    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(path)}`,
    );
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    return (
      await client.request<T>({
        method: "GET",
        url: url.href,
        timeout: 15000,
        retry: false,
      })
    ).data;
  }
  async batchUpdate(
    spreadsheetId: string,
    requests: readonly SheetsWriteRequest[],
  ) {
    const client = await this.auth.getClient();
    await client.request({
      method: "POST",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      data: { requests },
      timeout: 15000,
      retry: false,
    });
  }
}
export interface TestSheetWriteOptions {
  spreadsheetId: string;
  dedicatedTestSpreadsheetId: string;
  allowTestSheetWrites: boolean;
  trackerId: string;
  privateConnection: boolean;
  authorizeWrite: () => Promise<Actor>;
  sleep?: (ms: number) => Promise<void>;
}
/** Created only by the authenticated per-user runtime after provisioning. */
export interface PersonalSheetWriteOptions {
  mode: "connected";
  spreadsheetId: string;
  trackerId: string;
  authorizeWrite: () => Promise<Actor>;
  sleep?: (ms: number) => Promise<void>;
}
type Metadata = {
  spreadsheetId: string;
  sheets: {
    properties: {
      sheetId: number;
      title: ArnoldTable;
      gridProperties: { rowCount: number; columnCount: number };
    };
  }[];
};
const statusOf = (error: unknown) => {
  const e = error as { response?: { status?: number }; status?: number } | null;
  return e?.response?.status ?? e?.status;
};
function apiFailure(error: unknown, writing: boolean): WriteError {
  if (error instanceof WriteError) return error;
  // The grant is refreshed before a request is sent: nothing was written.
  if (isGoogleReauthRequired(error)) return googleReauthWriteError();
  if (error instanceof ArnoldDataError)
    return new WriteError(
      "SCHEMA_MISMATCH",
      "Die sechs Tabellen, Header oder Rohdaten passen nicht zu Schema v1.",
    );
  const status = statusOf(error);
  if (
    status === 401 ||
    (error instanceof ArnoldSheetsReadError && error.code === "AUTH")
  )
    return new WriteError(
      "AUTH_REQUIRED",
      "Google-Anmeldung fehlt oder ist abgelaufen.",
    );
  if (
    status === 403 ||
    (error instanceof ArnoldSheetsReadError && error.code === "PERMISSION")
  )
    return new WriteError("PERMISSION_DENIED", "Google-Berechtigung fehlt.");
  if (
    status === 404 ||
    (error instanceof ArnoldSheetsReadError && error.code === "NOT_FOUND")
  )
    return new WriteError("STORAGE_UNAVAILABLE", "Testdatei nicht gefunden.");
  if (
    status === 429 ||
    (error instanceof ArnoldSheetsReadError && error.code === "RATE_LIMIT")
  )
    return new WriteError(
      "STORAGE_UNAVAILABLE",
      "Google-Schreibquote erreicht. Später mit derselben Operations-ID versuchen.",
      true,
    );
  if (status === 400)
    return new WriteError(
      "SCHEMA_MISMATCH",
      "Google hat das gesamte Batch wegen ungültiger Struktur abgelehnt.",
    );
  return new WriteError(
    writing ? "COMMIT_STATUS_UNKNOWN" : "STORAGE_UNAVAILABLE",
    writing
      ? "Google-Schreibstatus unklar; zuerst anhand stabiler IDs prüfen."
      : "Google Sheets nicht erreichbar.",
    true,
  );
}
/** Test sheets permit three domain tables; connected trackers additionally permit plan lifecycle writes. CONFIG is never writable here. */
export class ArnoldSheetsWriteAdapter implements ArnoldWriteRepository {
  readonly kind: "test_sheet" | "connected";
  private reader: ArnoldSheetsReadAdapter;
  private metadata?: Metadata;
  private grids = new Map<ArnoldTable, unknown>();
  private baseline?: string;
  private allowedNext?: string;
  private quarantined = false;
  constructor(
    private options: TestSheetWriteOptions | PersonalSheetWriteOptions,
    private transport: ArnoldSheetsWriteTransport,
  ) {
    this.kind = "mode" in options ? options.mode : "test_sheet";
    if (options.spreadsheetId === ARNOLD_MASTER_SPREADSHEET_ID)
      throw new WriteError(
        "TEMPLATE_WRITE_FORBIDDEN",
        "Die Arnold-Masterdatei ist gesperrt.",
      );
    if (
      (!("mode" in options) &&
        (!options.allowTestSheetWrites ||
          !options.privateConnection ||
          !options.dedicatedTestSpreadsheetId ||
          options.spreadsheetId !== options.dedicatedTestSpreadsheetId)) ||
      typeof options.authorizeWrite !== "function" ||
      !options.trackerId ||
      options.trackerId === "TEMPLATE_UNASSIGNED"
    )
      throw new WriteError(
        "PERMISSION_DENIED",
        "Dedizierte Testdatei und geprüfte private Autorisierung erforderlich.",
      );
    this.reader = new ArnoldSheetsReadAdapter(
      { spreadsheetId: options.spreadsheetId },
      {
        get: async <T>(
          path: string,
          params: Readonly<Record<string, string>>,
        ): Promise<T> => {
          let response!: T;
          for (let attempt = 0; ; attempt++) {
            try {
              response = await transport.get<T>(path, params);
              break;
            } catch (error) {
              if (
                attempt >= 2 ||
                !(statusOf(error) === 429 || (statusOf(error) ?? 0) >= 500)
              )
                throw error;
              await this.backoff(attempt);
            }
          }
          if (!params.ranges) this.metadata = response as Metadata;
          else
            this.grids.set(
              /^'([A-Z_]+)'!/.exec(params.ranges)![1] as ArnoldTable,
              response,
            );
          return response;
        },
      },
    );
  }
  private backoff(attempt: number) {
    return (
      this.options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    )(100 * 2 ** attempt + Math.floor(Math.random() * 50));
  }
  async read(): Promise<ArnoldDataset> {
    try {
      if (this.quarantined)
        throw new WriteError(
          "COMMIT_STATUS_UNKNOWN",
          "Externe Änderung erkannt; Tracker bis zur manuellen Klärung gesperrt.",
        );
      const data = await this.reader.getDataset();
      if (data.config.file_role === "MASTER_TEMPLATE")
        throw new WriteError(
          "TEMPLATE_WRITE_FORBIDDEN",
          "Master-Vorlage darf nicht beschrieben werden.",
        );
      if (data.config.tracker_id !== this.options.trackerId)
        throw new WriteError("PERMISSION_DENIED", "Fremde Tracker-ID.");
      const hash = fingerprint(data);
      if (
        this.baseline &&
        hash !== this.baseline &&
        hash !== this.allowedNext
      ) {
        this.quarantined = true;
        throw new WriteError(
          "COMMIT_STATUS_UNKNOWN",
          "Unerwartete direkte Tabellenänderung erkannt.",
        );
      }
      this.baseline = hash;
      return data;
    } catch (error) {
      throw apiFailure(error, false);
    }
  }
  private rows(table: ArnoldTable): ArnoldSheetCell[][] {
    const properties = this.metadata!.sheets.find(
      (s) => s.properties.title === table,
    )!.properties;
    return parseArnoldGrid(this.grids.get(table), {
      spreadsheetId: this.options.spreadsheetId,
      table,
      sheetId: properties.sheetId,
      ...properties.gridProperties,
    });
  }
  async apply(changes: readonly EntityChange[]): Promise<void> {
    // A configuration flag is not authentication. Require a checked principal
    // from the trusted backend on each dispatch, in addition to the service guard.
    let actor: Actor;
    try {
      actor = await this.options.authorizeWrite();
    } catch (error) {
      throw error instanceof WriteError
        ? error
        : new WriteError(
            "AUTH_REQUIRED",
            "Geprüfter schreibender Akteur fehlt.",
          );
    }
    if (!actor?.verified || !actor.subject || actor.kind !== "authenticated")
      throw new WriteError(
        "AUTH_REQUIRED",
        "Geprüfter schreibender Akteur fehlt.",
      );
    if (
      actor.trackerId !== this.options.trackerId ||
      !actor.permissions.includes("write")
    )
      throw new WriteError(
        "PERMISSION_DENIED",
        "Akteur darf diesen Test-Tracker nicht beschreiben.",
      );
    const before = await this.read(); // Revalidates CONFIG, all six headers, metadata, revisions and IDs.
    const after = changedDataset(before, changes);
    this.allowedNext = fingerprint(after);
    // The dedicated test-sheet profile keeps its original three-table surface.
    // Only an authenticated connected runtime adds PLANS and PLAN_ITEMS.
    const names: Partial<Record<EntityChange["table"], ArnoldTable>> = {
      workouts: "WORKOUTS",
      sets: "SETS",
      exercises: "EXERCISES",
      ...(this.kind === "connected"
        ? { plans: "PLANS" as const, planItems: "PLAN_ITEMS" as const }
        : {}),
    };
    const requests: SheetsWriteRequest[] = [];
    const appends = new Map<ArnoldTable, { values: TextCell[] }[]>();
    for (const change of changes) {
      const table = names[change.table];
      if (!table)
        throw new WriteError(
          "PERMISSION_DENIED",
          "Tabelle nicht beschreibbar.",
        );
      const headers = ARNOLD_TABLE_HEADERS[table];
      const values = headers.map((key) => {
        const value = (change.after as unknown as Record<string, unknown>)[key];
        // ExtendedValue.stringValue preserves leading '=', '+', '-', '@' as literal text.
        return value === null
          ? {}
          : {
              userEnteredValue:
                typeof value === "number"
                  ? { numberValue: value }
                  : { stringValue: String(value) },
            };
      });
      const sheetId = this.metadata!.sheets.find(
        (s) => s.properties.title === table,
      )!.properties.sheetId;
      if (change.before) {
        // Resolve the current physical row from the stable ID on EVERY update.
        const rows = this.rows(table);
        const matches = rows.flatMap((r, index) =>
          index > 0 && r[0] === entityId(change.before!) ? [index] : [],
        );
        if (matches.length !== 1)
          throw new WriteError(
            "REVISION_CONFLICT",
            "Zeilenidentität ist nicht eindeutig.",
          );
        requests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: matches[0],
              endRowIndex: matches[0] + 1,
              startColumnIndex: 0,
              endColumnIndex: headers.length,
            },
            rows: [{ values }],
            fields: "userEnteredValue",
          },
        });
      } else {
        const rows = appends.get(table) ?? [];
        rows.push({ values });
        appends.set(table, rows);
      }
    }
    const limits = this.reader.limits;
    for (const [table, rows] of appends) {
      const properties = this.metadata!.sheets.find(
        (s) => s.properties.title === table,
      )!.properties;
      // appendCells writes after the last row holding data, counting internal
      // gaps; spare grid rows below it are reused before the grid grows.
      const usedRows = this.rows(table).reduce(
        (last, row, index) =>
          row.some((cell) => cell !== null && cell !== undefined && cell !== "")
            ? index + 1
            : last,
        0,
      );
      const resultingRows = Math.max(
        properties.gridProperties.rowCount,
        usedRows + rows.length,
      );
      if (
        resultingRows > limits.rows ||
        resultingRows * properties.gridProperties.columnCount > limits.cells
      )
        throw new WriteError(
          "SHEET_CAPACITY_EXCEEDED",
          "Deine Trainingstabelle ist voll: Arnold könnte sie nach diesem Speichern nicht mehr lesen. Es wurde nichts geschrieben. Bitte wende dich an den Support.",
          false,
          [table, `resulting_rows=${resultingRows}`, `max_rows=${limits.rows}`],
        );
      requests.push({
        appendCells: {
          sheetId: properties.sheetId,
          rows,
          fields: "userEnteredValue",
        },
      });
    }
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await this.transport.batchUpdate(
            this.options.spreadsheetId,
            requests,
          );
          break;
        } catch (error) {
          // Only a definite HTTP 429 rejection is retried. A timeout/5xx may have committed.
          if (statusOf(error) !== 429 || attempt >= 2) throw error;
          await this.backoff(attempt);
        }
      }
    } catch (error) {
      throw apiFailure(error, true);
    }
    let observed: ArnoldDataset;
    try {
      observed = await this.read();
    } catch {
      // The batch was accepted; only its readback failed (for example an
      // expired grant). The outcome is unknown, never "not written".
      throw new WriteError(
        "COMMIT_STATUS_UNKNOWN",
        "Google hat gespeichert, die Kontrolle steht noch aus. Mit derselben request_id erneut prüfen.",
        true,
      );
    }
    if (fingerprint(observed) !== this.allowedNext)
      throw new WriteError(
        "COMMIT_STATUS_UNKNOWN",
        "Readback stimmt nicht mit dem vollständigen Batch überein.",
        true,
      );
    this.allowedNext = undefined;
  }
}
