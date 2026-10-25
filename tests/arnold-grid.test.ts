import { describe, expect, it } from "vitest";
import { parseArnoldGrid } from "../src/server/arnold-grid-parser";
import {
  ArnoldDataError,
  parseArnoldTables,
} from "../src/server/arnold-sheet-parser";
import { ArnoldSheetsReadAdapter } from "../src/server/arnold-sheets-read-adapter";
import {
  FakeArnoldSheets,
  fixtureFileId,
  setCell,
  V1_HEADERS,
  type FixtureTable,
} from "./fixtures/arnold-v1";
const context = {
  spreadsheetId: fixtureFileId,
  sheetId: 105,
  table: "SETS" as const,
  rowCount: 1000,
  columnCount: 26,
};
const grid = (values: unknown[]) => ({
  spreadsheetId: fixtureFileId,
  sheets: [
    {
      properties: { sheetId: 105, title: "SETS" },
      data: [{ rowData: [{ values }] }],
    },
  ],
});
describe("QA F2: Google userEnteredValue provenance", () => {
  it("distinguishes identical literal and formula strings by their Google cell type", () => {
    const expression = "=SUM(1,2)";
    expect(
      parseArnoldGrid(
        grid([
          { userEnteredValue: { stringValue: expression } },
          { userEnteredValue: { formulaValue: expression } },
        ]),
        context,
      ),
    ).toEqual([[expression, { formulaValue: expression }]]);
  });
  it("preserves zero, false, empty/missing cells and omits no physical positions", () => {
    expect(
      parseArnoldGrid(
        grid([
          { userEnteredValue: { numberValue: 0 } },
          { userEnteredValue: { boolValue: false } },
          {},
          { userEnteredValue: {} },
          { userEnteredValue: { stringValue: "" } },
        ]),
        context,
      ),
    ).toEqual([[0, false, null, null, ""]]);
    const data = {
      spreadsheetId: fixtureFileId,
      sheets: [
        {
          properties: { sheetId: 105, title: "SETS" },
          data: [
            {
              startRow: 2,
              startColumn: 1,
              rowData: [
                { values: [{ userEnteredValue: { stringValue: "=literal" } }] },
              ],
            },
          ],
        },
      ],
    };
    expect(parseArnoldGrid(data, context)).toEqual([
      [],
      [],
      [null, "=literal"],
    ]);
  });
  it.each([
    ["CONFIG", "description"],
    ["EXERCISES", "name_de"],
    ["PLANS", "name"],
    ["PLAN_ITEMS", "notes"],
    ["WORKOUTS", "notes"],
    ["SETS", "notes"],
  ] as const)(
    "round-trips literal leading equals through the adapter in %s.%s",
    async (table, column) => {
      const fake = new FakeArnoldSheets();
      setCell(fake.tables, table, 0, column, "=SUM(1,2)");
      const data = await new ArnoldSheetsReadAdapter(
        { spreadsheetId: fixtureFileId },
        fake,
      ).getDataset();
      const records = {
        CONFIG: data.configEntries,
        EXERCISES: data.exercises,
        PLANS: data.plans,
        PLAN_ITEMS: data.planItems,
        WORKOUTS: data.workouts,
        SETS: data.sets,
      };
      expect(
        (records[table][0] as unknown as Record<string, unknown>)[column],
      ).toBe("=SUM(1,2)");
    },
  );
  it.each([
    ["CONFIG", "description"],
    ["EXERCISES", "name_de"],
    ["PLANS", "name"],
    ["PLAN_ITEMS", "notes"],
    ["WORKOUTS", "notes"],
    ["SETS", "notes"],
    ["SETS", "load_kg"],
  ] as const)(
    "rejects genuine formulas in %s.%s including optional free text",
    async (table, column) => {
      const fake = new FakeArnoldSheets();
      setCell(fake.tables, table, 0, column, { formulaValue: '=""' });
      const error = await new ArnoldSheetsReadAdapter(
        { spreadsheetId: fixtureFileId },
        fake,
      )
        .getDataset()
        .catch((e) => e);
      expect(error).toBeInstanceOf(ArnoldDataError);
      expect(error.issues).toContainEqual(
        expect.objectContaining({ code: "FORMULA", table, row: 2, column }),
      );
    },
  );
  it("ignores evaluated/formatted formula results and still blocks the source formula", () => {
    const fake = new FakeArnoldSheets(),
      response = fake.grid("SETS");
    const cells = response.sheets[0].data[0].rowData[1].values;
    const column = (V1_HEADERS.SETS as readonly string[]).indexOf("notes");
    Object.assign(cells[column], {
      userEnteredValue: { formulaValue: '="harmless"' },
      effectiveValue: { stringValue: "harmless" },
      formattedValue: "harmless",
    });
    const rows = parseArnoldGrid(response, context);
    expect(rows[1][column]).toEqual({ formulaValue: '="harmless"' });
    expect(() => parseArnoldTables({ ...fake.tables, SETS: rows })).toThrow(
      "Formeln",
    );
  });
  it.each([
    { stringValue: "=literal", formulaValue: "=1" },
    { numberValue: 1, stringValue: "1" },
    { errorValue: { type: "ERROR", message: "SECRET_TEST_VALUE" } },
    { unexpectedValue: "SECRET_TEST_VALUE" },
  ])(
    "rejects malformed/ambiguous ExtendedValue without including raw values",
    (value) => {
      expect(() =>
        parseArnoldGrid(grid([{ userEnteredValue: value }]), context),
      ).toThrow("typisierte Zellwerte");
      try {
        parseArnoldGrid(grid([{ userEnteredValue: value }]), context);
      } catch (error) {
        expect(String(error)).not.toContain("SECRET_TEST_VALUE");
      }
    },
  );
  it.each([
    "spreadsheet",
    "sheet_id",
    "title",
    "duplicate_target",
    "other_sheet_data",
  ])("rejects grid identity drift: %s", (kind) => {
    const fake = new FakeArnoldSheets(),
      response = fake.grid("SETS");
    if (kind === "spreadsheet")
      response.spreadsheetId = "different-spreadsheet";
    if (kind === "sheet_id") response.sheets[0].properties.sheetId = 999;
    if (kind === "title") response.sheets[0].properties.title = "WORKOUTS";
    if (kind === "duplicate_target")
      response.sheets.push(structuredClone(response.sheets[0]));
    if (kind === "other_sheet_data") {
      const other = structuredClone(response.sheets[0]);
      other.properties.sheetId = 999;
      response.sheets.push(other);
    }
    expect(() => parseArnoldGrid(response, context)).toThrow(
      "angeforderten Datei",
    );
  });
  it.each(["rows", "columns", "row_offset", "column_offset"])(
    "rejects typed grid bounds violation: %s",
    (kind) => {
      const response = {
        spreadsheetId: fixtureFileId,
        sheets: [
          {
            properties: { sheetId: 105, title: "SETS" },
            data: [
              {
                startRow: 0,
                startColumn: 0,
                rowData: [
                  { values: [{ userEnteredValue: { stringValue: "text" } }] },
                ],
              },
            ],
          },
        ],
      };
      const block = response.sheets[0].data[0];
      if (kind === "rows") {
        block.startRow = 1000;
      }
      if (kind === "columns") {
        block.startColumn = 26;
      }
      if (kind === "row_offset") {
        block.startRow = 1001;
        block.rowData = [];
      }
      if (kind === "column_offset") {
        block.startColumn = 27;
        block.rowData = [];
      }
      expect(() => parseArnoldGrid(response, context)).toThrow("überschreitet");
    },
  );
  it("never falls back to untyped values API data", () => {
    expect(() => parseArnoldGrid({ values: [["=unproven"]] }, context)).toThrow(
      "typisierte Zellwerte",
    );
  });
});
