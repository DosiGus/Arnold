import { describe, expect, it } from "vitest";
import { parseTrainingSheet, sheetDate } from "../src/server/sheet-parser";
import { GoogleSheetsStorageAdapter } from "../src/server/google-sheets-storage";
import {
  createStorage,
  requirePrivateBinding,
} from "../src/server/storage-config";
import { buildDashboard } from "../src/shared/calculations";
import { config, FakeSheets, sample } from "./fixtures/sheets";

describe("authorized Trainingslog parser", () => {
  it("uses effective load, German numbers and dates, stable IDs, and real-source provenance", () => {
    const rows = sample();
    const parsed = parseTrainingSheet(rows);
    expect(parsed.sets.map((s) => s.kg)).toEqual([20, 22.5, 80]);
    expect(parsed.sets[1].rpe).toBe(8.5);
    expect(parsed.sets[2].rpe).toBeUndefined();
    expect(parsed.workouts.map((w) => w.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
    ]);
    expect(parseTrainingSheet(rows).sets.map((s) => s.id)).toEqual(
      parsed.sets.map((s) => s.id),
    );
    expect(buildDashboard(parsed)).toMatchObject({
      synthetic: false,
      source: "google_sheets",
      totals: { workouts: 2, sets: 3, volume: 780 },
      connection: { readOnly: true, rowCount: 3, skippedRows: 0 },
    });
    expect(sheetDate(46023)).toBe("2026-01-01");
    expect(sheetDate(46023.75)).toBe("2026-01-01");
    expect(() => sheetDate("31.02.2026")).toThrow();
  });
  it("rejects changed columns and never guesses a new mapping", () => {
    const rows = sample();
    rows.inputRows[0][5] = "Other";
    expect(() => parseTrainingSheet(rows)).toThrow("Spaltenstruktur");
  });
  it("excludes duplicates, incomplete rows, malformed values and missing bodyweight load", () => {
    const rows = sample();
    rows.inputRows.push(
      ...Array.from({ length: 5 }, () => [...rows.inputRows[1]]),
    );
    rows.computedRows.push(
      ["Gewicht", 20, "a", "", "ok"],
      ["Gewicht", 20, "d", "duplicate", "ok"],
      ["Gewicht", 20, "e", "", ""],
      ["Eigengewicht", "", "f", "", "ok"],
      ["Gewicht", 20, "g", "", "ok"],
    );
    rows.inputRows.at(-1)![2] = "private-test-name";
    rows.inputRows.at(-1)![4] = 9999;
    const parsed = parseTrainingSheet(rows);
    expect(parsed.sets).toHaveLength(3);
    expect(parsed.connection?.skippedRows).toBe(5);
    expect(JSON.stringify(parsed.connection?.warnings)).not.toContain(
      "private-test-name",
    );
  });
});
describe("Google Sheets read-only adapter", () => {
  it("requests only the configured file/tab A:G and O:S, coalesces concurrent reads, refreshes afterward", async () => {
    const fake = new FakeSheets();
    const storage = new GoogleSheetsStorageAdapter(config, fake);
    const [a, b] = await Promise.all([
      storage.getSnapshot(),
      storage.getSnapshot(),
    ]);
    expect(a).toBe(b);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls.map((c) => decodeURIComponent(c.path))).toEqual([
      config.spreadsheetId,
      `${config.spreadsheetId}/values/'Trainingslog'!A4:G20004`,
      `${config.spreadsheetId}/values/'Trainingslog'!O4:S7`,
    ]);
    expect(fake.calls[0].params.ranges).toBe("'Trainingslog'!A4:G4");
    fake.rows.inputRows[1][4] = 11;
    expect((await storage.getSnapshot()).sets[0].reps).toBe(11);
    expect(fake.calls).toHaveLength(6);
    await expect(storage.resetDemoData()).rejects.toThrow("nicht");
    await expect(
      storage.saveSet({
        requestId: "test-demo-123",
        date: "2026-10-01",
        exerciseId: "any",
        kg: 20,
        reps: 10,
      }),
    ).rejects.toThrow("lesend");
  });
  it("fails closed on wrong ID, renamed tab, column loss or growth beyond the configured range", async () => {
    for (const mutation of [
      (f: FakeSheets) => {
        f.metadata.spreadsheetId = "different-file";
      },
      (f: FakeSheets) => {
        f.metadata.sheets[0].properties.title = "Health";
      },
      (f: FakeSheets) => {
        f.metadata.sheets[0].properties.gridProperties.columnCount = 10;
      },
      (f: FakeSheets) => {
        f.metadata.sheets[0].properties.gridProperties.rowCount = 20005;
      },
    ]) {
      const f = new FakeSheets();
      mutation(f);
      await expect(
        new GoogleSheetsStorageAdapter(config, f).getSnapshot(),
      ).rejects.toThrow();
      expect(f.calls).toHaveLength(1);
    }
  });
  it("refuses real data with the public demo profile and public host/origin configuration", () => {
    expect(() =>
      createStorage(process.cwd(), { STORAGE_MODE: "google_sheets" }),
    ).toThrow("private");
    const storage = new GoogleSheetsStorageAdapter(config, new FakeSheets());
    expect(() =>
      requirePrivateBinding(storage, "0.0.0.0", ["localhost"], []),
    ).toThrow();
    expect(() =>
      requirePrivateBinding(storage, "127.0.0.1", ["example.com"], []),
    ).toThrow();
    expect(() =>
      requirePrivateBinding(
        storage,
        "127.0.0.1",
        ["localhost"],
        ["https://chatgpt.com"],
      ),
    ).toThrow();
    expect(() =>
      requirePrivateBinding(storage, "127.0.0.1", ["localhost"], []),
    ).not.toThrow();
  });
});
