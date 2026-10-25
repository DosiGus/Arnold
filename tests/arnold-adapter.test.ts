import { describe, expect, it } from "vitest";
import {
  ArnoldSheetsReadAdapter,
  ArnoldSheetsReadError,
} from "../src/server/arnold-sheets-read-adapter";
import { ArnoldDataError } from "../src/server/arnold-sheet-parser";
import {
  FakeArnoldSheets,
  fixtureFileId,
  templateTables,
  setCell,
  setConfig,
} from "./fixtures/arnold-v1";
const adapter = (fake: FakeArnoldSheets) =>
  new ArnoldSheetsReadAdapter({ spreadsheetId: fixtureFileId }, fake);
describe("ArnoldSheetsReadAdapter", () => {
  it("reads all six fixed tabs through GET-only transport and returns a complete normalized dataset", async () => {
    const fake = new FakeArnoldSheets(),
      read = adapter(fake),
      data = await read.getDataset();
    expect(data.sets).toHaveLength(2);
    expect(fake.calls).toHaveLength(7);
    expect(fake.calls[0]).toMatchObject({
      path: fixtureFileId,
      params: { includeGridData: "false" },
    });
    expect(fake.calls.slice(1).map((c) => c.params.ranges)).toEqual(
      ["CONFIG", "EXERCISES", "PLANS", "PLAN_ITEMS", "WORKOUTS", "SETS"].map(
        (t) => `'${t}'!A1:Z1000`,
      ),
    );
    expect(
      fake.calls
        .slice(1)
        .every(
          (c) =>
            c.path === fixtureFileId &&
            c.params.includeGridData === "true" &&
            c.params.fields.includes("userEnteredValue"),
        ),
    ).toBe(true);
    expect(read.readOnly).toBe(true);
    for (const method of [
      "saveSet",
      "append",
      "update",
      "write",
      "delete",
      "resetDemoData",
    ])
      expect(method in read).toBe(false);
  });
  it("accepts a master template with an exercise catalog and completely empty history without adding fixtures", async () => {
    const fake = new FakeArnoldSheets();
    fake.tables = templateTables();
    const data = await adapter(fake).getDataset();
    expect(data.exercises).toHaveLength(2);
    expect(data.plans).toEqual([]);
    expect(data.planItems).toEqual([]);
    expect(data.workouts).toEqual([]);
    expect(data.sets).toEqual([]);
  });
  it("shares an in-flight read, fetches anew afterward and does not mutate previous snapshots", async () => {
    const fake = new FakeArnoldSheets(),
      read = adapter(fake);
    const [first, same] = await Promise.all([
      read.getDataset(),
      read.getDataset(),
    ]);
    expect(first).toBe(same);
    expect(fake.calls).toHaveLength(7);
    setCell(fake.tables, "SETS", 0, "load_kg", 21);
    const second = await read.getDataset();
    expect(second.sets[0].load_kg).toBe(21);
    expect(first.sets[0].load_kg).toBe(20.123456789);
    expect(fake.calls).toHaveLength(14);
  });
  it.each([
    "spreadsheet",
    "missing_tab",
    "extra_tab",
    "renamed_tab",
    "tab_order",
    "duplicate_tab_id",
    "merged",
    "too_many_rows",
    "too_many_columns",
    "too_few_columns",
  ])("rejects metadata mismatch %s before reading values", async (kind) => {
    const f = new FakeArnoldSheets();
    if (kind === "spreadsheet") f.metadata.spreadsheetId = "another-workbook";
    if (kind === "missing_tab") f.metadata.sheets.pop();
    if (kind === "extra_tab")
      f.metadata.sheets.push(structuredClone(f.metadata.sheets[0]));
    if (kind === "renamed_tab") f.metadata.sheets[0].properties.title = "Other";
    if (kind === "tab_order") f.metadata.sheets[0].properties.index = 9;
    if (kind === "duplicate_tab_id")
      f.metadata.sheets[0].properties.sheetId =
        f.metadata.sheets[1].properties.sheetId;
    if (kind === "merged")
      f.metadata.sheets[0].merges.push({ startRowIndex: 0, endRowIndex: 2 });
    if (kind === "too_many_rows")
      f.metadata.sheets[0].properties.gridProperties.rowCount = 10001;
    if (kind === "too_many_columns")
      f.metadata.sheets[0].properties.gridProperties.columnCount = 65;
    if (kind === "too_few_columns")
      f.metadata.sheets[0].properties.gridProperties.columnCount = 2;
    await expect(adapter(f).getDataset()).rejects.toBeInstanceOf(
      ArnoldDataError,
    );
    expect(f.calls).toHaveLength(1);
  });
  it("asserts optional expected tracker identity and file role without treating IDs as authorization", async () => {
    const f = new FakeArnoldSheets();
    await expect(
      new ArnoldSheetsReadAdapter(
        { spreadsheetId: fixtureFileId, expectedTrackerId: "other-tracker" },
        f,
      ).getDataset(),
    ).rejects.toThrow("Tracker-ID");
    await expect(
      new ArnoldSheetsReadAdapter(
        { spreadsheetId: fixtureFileId, expectedFileRole: "MASTER_TEMPLATE" },
        f,
      ).getDataset(),
    ).rejects.toThrow("Dateityp");
    await expect(
      new ArnoldSheetsReadAdapter(
        {
          spreadsheetId: fixtureFileId,
          expectedTrackerId: "synthetic-user-tracker",
          expectedFileRole: "USER_TRACKER",
        },
        f,
      ).getDataset(),
    ).resolves.toHaveProperty("sets");
  });
  it("propagates contextual schema errors instead of falling back to synthetic data", async () => {
    const f = new FakeArnoldSheets();
    setConfig(f.tables, "schema_version", "2.0.0");
    await expect(adapter(f).getDataset()).rejects.toThrow("schema_version");
  });
  it.each([
    [401, "AUTH"],
    [403, "PERMISSION"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMIT"],
    [503, "UNAVAILABLE"],
    [400, "API"],
  ] as const)("sanitizes Google API error %s", async (status, code) => {
    const f = new FakeArnoldSheets();
    f.failure = {
      response: { status },
      message: "SECRET_TEST_TOKEN",
      headers: { Authorization: "SECRET_TEST_TOKEN" },
    };
    const error = await adapter(f)
      .getDataset()
      .catch((e) => e);
    expect(error).toBeInstanceOf(ArnoldSheetsReadError);
    expect(error).toMatchObject({ status, code });
    expect(String(error)).not.toContain("SECRET_TEST_TOKEN");
    expect(error.cause).toBeUndefined();
  });
  it("clears a failed in-flight read so a later retry can succeed", async () => {
    const f = new FakeArnoldSheets(),
      read = adapter(f);
    f.failure = Error("SECRET_TEST_TOKEN");
    await expect(read.getDataset()).rejects.toThrow("Google Sheets");
    f.failure = undefined;
    await expect(read.getDataset()).resolves.toHaveProperty("config");
  });
  it("rejects malformed Google metadata, values, dimensions and oversized responses", async () => {
    for (const kind of ["metadata", "values", "dimension", "oversized"]) {
      const f = new FakeArnoldSheets(),
        get = f.get.bind(f);
      f.get = async <T>(
        path: string,
        params: Readonly<Record<string, string>>,
      ): Promise<T> => {
        if (kind === "metadata") return {} as T;
        if (params.ranges)
          return (
            kind === "values"
              ? {
                  spreadsheetId: fixtureFileId,
                  sheets: [
                    {
                      properties: { sheetId: 100, title: "CONFIG" },
                      data: [
                        {
                          rowData: [
                            {
                              values: [
                                { userEnteredValue: { nested: "invalid" } },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                }
              : kind === "dimension"
                ? { values: [["untyped values are not a raw grid"]] }
                : {
                    spreadsheetId: fixtureFileId,
                    sheets: [
                      {
                        properties: { sheetId: 100, title: "CONFIG" },
                        data: [
                          { rowData: Array.from({ length: 1001 }, () => ({})) },
                        ],
                      },
                    ],
                  }
          ) as T;
        return get<T>(path, params);
      };
      await expect(adapter(f).getDataset()).rejects.toBeInstanceOf(
        ArnoldDataError,
      );
    }
  });
  it("validates options before issuing requests", () => {
    const f = new FakeArnoldSheets();
    for (const options of [
      { spreadsheetId: "bad/path" },
      { spreadsheetId: fixtureFileId, maxRowsPerTable: 0 },
      { spreadsheetId: fixtureFileId, maxColumnsPerTable: 65 },
    ])
      expect(() => new ArnoldSheetsReadAdapter(options, f)).toThrow(
        ArnoldDataError,
      );
    expect(f.calls).toEqual([]);
  });
});
