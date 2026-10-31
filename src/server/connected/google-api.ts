import type { AuthenticatedArnoldContext } from "../auth/identity.js";
import type { FetchLike } from "../auth/jwks.js";
import type { GoogleConnectionService } from "../google/connection-service.js";
import type {
  ArnoldSheetsWriteTransport,
  SheetsWriteRequest,
} from "../arnold-sheets-write-adapter.js";
import {
  ARNOLD_TABLES,
  ARNOLD_TABLE_HEADERS,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import { WriteError } from "../workout/infrastructure.js";

export type TrackerFile = {
  id: string;
  /** As Google reports it; the user may have renamed the file. */
  name?: string;
  mimeType: string;
  trashed?: boolean;
  ownedByMe?: boolean;
  appProperties?: Record<string, string>;
};
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const sheetMime = "application/vnd.google-apps.spreadsheet";

/** Only fixed Google endpoints; no upstream response body is copied into errors. */
export class GoogleTrackerApi {
  constructor(
    private connections: GoogleConnectionService,
    private context: AuthenticatedArnoldContext,
    private fetchImpl: FetchLike = fetch,
  ) {}
  async request<T>(url: URL, method = "GET", body?: unknown): Promise<T> {
    return this.dispatch<T>(url, method, body, true);
  }
  private async dispatch<T>(
    url: URL,
    method: string,
    body: unknown,
    refreshOnUnauthorized: boolean,
  ): Promise<T> {
    const token = await this.connections.accessTokenFor(this.context);
    const response = await this.fetchImpl(url.href, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 && refreshOnUnauthorized) {
      this.connections.invalidateAccessToken(this.context);
      return this.dispatch(url, method, body, false);
    }
    if (!response.ok)
      throw Object.assign(new Error("Google-Anfrage fehlgeschlagen."), {
        status: response.status,
      });
    return (await response.json()) as T;
  }
  async find(trackerId: string): Promise<TrackerFile[]> {
    // trackerId is generated server-side, but quote it defensively for Drive's query grammar.
    const escaped = trackerId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const url = new URL(DRIVE);
    url.searchParams.set(
      "q",
      `trashed = false and appProperties has { key='arnold_tracker' and value='${escaped}' }`,
    );
    url.searchParams.set(
      "fields",
      "files(id,mimeType,trashed,ownedByMe,appProperties),nextPageToken",
    );
    url.searchParams.set("pageSize", "100");
    const result = await this.request<{
      files: TrackerFile[];
      nextPageToken?: string;
    }>(url);
    if (result.nextPageToken)
      throw new WriteError(
        "COMMIT_STATUS_UNKNOWN",
        "Tracker-Zuordnung ist nicht eindeutig.",
      );
    return result.files;
  }
  create(trackerId: string): Promise<TrackerFile> {
    const url = new URL(DRIVE);
    url.searchParams.set("fields", "id,mimeType,ownedByMe,appProperties");
    return this.request(url, "POST", {
      name: "Arnold – Mein Training",
      mimeType: sheetMime,
      appProperties: { arnold_tracker: trackerId },
    });
  }
  /** Checks the file belongs to this tracker and returns it as Google sees it. */
  async verifyFile(
    spreadsheetId: string,
    trackerId: string,
  ): Promise<TrackerFile> {
    const url = new URL(`${DRIVE}/${encodeURIComponent(spreadsheetId)}`);
    url.searchParams.set(
      "fields",
      "id,name,mimeType,trashed,ownedByMe,appProperties",
    );
    const file = await this.request<TrackerFile>(url);
    if (
      file.id !== spreadsheetId ||
      file.mimeType !== sheetMime ||
      file.trashed ||
      !file.ownedByMe ||
      file.appProperties?.arnold_tracker !== trackerId
    )
      throw new WriteError(
        "PERMISSION_DENIED",
        "Diese Datei gehört nicht zur eigenen Arnold-Einrichtung.",
      );
    return file;
  }
  sheets(spreadsheetId: string): ArnoldSheetsWriteTransport {
    return {
      get: <T>(path: string, params: Readonly<Record<string, string>>) => {
        if (path !== spreadsheetId)
          throw new WriteError("PERMISSION_DENIED", "Fremde Datei.");
        const url = new URL(`${SHEETS}/${encodeURIComponent(spreadsheetId)}`);
        for (const [key, value] of Object.entries(params))
          url.searchParams.set(key, value);
        return this.request<T>(url);
      },
      batchUpdate: async (
        id: string,
        requests: readonly SheetsWriteRequest[],
      ) => {
        if (id !== spreadsheetId)
          throw new WriteError("PERMISSION_DENIED", "Fremde Datei.");
        await this.request(
          new URL(`${SHEETS}/${encodeURIComponent(id)}:batchUpdate`),
          "POST",
          { requests },
        );
      },
    };
  }
  async initialize(spreadsheetId: string, data: ArnoldDataset) {
    const metadata = await this.request<{
      sheets: { properties: { sheetId: number } }[];
    }>(
      new URL(
        `${SHEETS}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.sheetId`,
      ),
    );
    // This is used only for a newly allocated, not-yet-ready tracker. Stable sheet
    // IDs and one atomic batch make a timed-out initialization reconcilable.
    const requests: unknown[] = metadata.sheets.map(({ properties }) => ({
      deleteSheet: { sheetId: properties.sheetId },
    }));
    const rowsByTable = {
      CONFIG: data.configEntries,
      EXERCISES: data.exercises,
      PLANS: data.plans,
      PLAN_ITEMS: data.planItems,
      WORKOUTS: data.workouts,
      SETS: data.sets,
    };
    // Add first: Sheets requires at least one tab throughout the batch.
    const newSheets = ARNOLD_TABLES.map((table, index) => ({
      addSheet: {
        properties: {
          sheetId: 100 + index,
          title: `arnold_init_${index}`,
          gridProperties: {
            rowCount: Math.max(1000, rowsByTable[table].length + 1),
            columnCount: 32,
          },
        },
      },
    }));
    const oldIds = new Set(
      metadata.sheets.map(({ properties }) => properties.sheetId),
    );
    if (
      newSheets.some(({ addSheet }) => oldIds.has(addSheet.properties.sheetId))
    )
      throw new WriteError(
        "COMMIT_STATUS_UNKNOWN",
        "Initialisierung muss über den gespeicherten Tracker geprüft werden.",
      );
    requests.unshift(...newSheets);
    ARNOLD_TABLES.forEach((table, index) => {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: 100 + index, title: table },
          fields: "title",
        },
      });
      const headers = ARNOLD_TABLE_HEADERS[table];
      const values = [
        headers,
        ...rowsByTable[table].map((row) =>
          headers.map(
            (key) => (row as unknown as Record<string, unknown>)[key],
          ),
        ),
      ];
      requests.push({
        updateCells: {
          start: { sheetId: 100 + index, rowIndex: 0, columnIndex: 0 },
          fields: "userEnteredValue",
          rows: values.map((row) => ({
            values: row.map((value) =>
              value === null
                ? {}
                : {
                    userEnteredValue:
                      typeof value === "number"
                        ? { numberValue: value }
                        : { stringValue: String(value) },
                  },
            ),
          })),
        },
      });
    });
    await this.request(
      new URL(`${SHEETS}/${encodeURIComponent(spreadsheetId)}:batchUpdate`),
      "POST",
      { requests },
    );
  }
}
