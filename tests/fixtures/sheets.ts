import type { SheetRows } from "../../src/server/sheet-parser";
import type {
  SheetsConfig,
  SheetsTransport,
} from "../../src/server/google-sheets-storage";
// Entirely synthetic values; mirrors only the authorized tab's column structure.
export const config: SheetsConfig = {
  spreadsheetId: "synthetic-spreadsheet-123",
  sheetId: 123,
  sheetTitle: "Trainingslog",
  headerRow: 4,
  maxRows: 20004,
};
export const sample = (): SheetRows => ({
  ...config,
  spreadsheetTitle: "Test-Tracker",
  fetchedAt: "2026-10-24T12:00:00.000Z",
  inputRows: [
    [
      "Datum",
      "Einheit",
      "Übung",
      "Satz",
      "Wdh.",
      "Gewicht / Zusatz (kg)",
      "RPE",
    ],
    ["01.10.2026", "Push", "Testdrücken", 1, 10, 20, 8],
    ["01.10.2026", "Push", "Testdrücken", 2, 8, 22.5, "8,5"],
    ["2026-10-02", "Pull", "Testklimmzug", 1, 5, 10, ""],
  ],
  computedRows: [
    ["Typ", "Effektive Last (kg)", "Satz-ID", "Duplikat", "Zeile ok"],
    ["Gewicht", 20, "a", "", "ok"],
    ["Gewicht", 22.5, "b", "", "ok"],
    ["Eigengewicht", 80, "c", "", "ok"],
  ],
});
export class FakeSheets implements SheetsTransport {
  calls: { path: string; params: Record<string, string> }[] = [];
  rows = sample();
  metadata = {
    spreadsheetId: config.spreadsheetId,
    properties: { title: "Test-Tracker" },
    sheets: [
      {
        properties: {
          sheetId: config.sheetId,
          title: config.sheetTitle,
          gridProperties: { rowCount: 20004, columnCount: 26 },
        },
      },
    ],
  };
  async get<T>(path: string, params: Record<string, string>): Promise<T> {
    this.calls.push({ path, params });
    if (!path.includes("/values/")) return structuredClone(this.metadata) as T;
    return {
      values: structuredClone(
        decodeURIComponent(path).includes("!A")
          ? this.rows.inputRows
          : this.rows.computedRows,
      ),
    } as T;
  }
}
