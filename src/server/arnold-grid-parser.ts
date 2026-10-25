import { z } from "zod";
import type { ArnoldTable } from "../shared/arnold-schema-v1.js";
import {
  ArnoldDataError,
  type ArnoldSheetCell,
} from "./arnold-sheet-parser.js";

// ExtendedValue is a union. A stringValue beginning with '=' is still text;
// a formulaValue is a formula even if its evaluated result is empty or harmless.
const enteredValueSchema = z.union([
  z.strictObject({ stringValue: z.string() }),
  z.strictObject({ numberValue: z.number() }),
  z.strictObject({ boolValue: z.boolean() }),
  z.strictObject({ formulaValue: z.string() }),
  z.strictObject({}),
]);
const gridResponseSchema = z.object({
  spreadsheetId: z.string(),
  sheets: z.array(
    z.object({
      properties: z.object({
        sheetId: z.number().int().nonnegative(),
        title: z.string(),
      }),
      data: z
        .array(
          z.object({
            startRow: z.number().int().nonnegative().optional(),
            startColumn: z.number().int().nonnegative().optional(),
            rowData: z
              .array(
                z.object({
                  values: z
                    .array(
                      z.object({
                        userEnteredValue: enteredValueSchema.optional(),
                      }),
                    )
                    .optional(),
                }),
              )
              .optional(),
          }),
        )
        .max(1)
        .optional(),
    }),
  ),
});
export interface ArnoldGridContext {
  readonly spreadsheetId: string;
  readonly sheetId: number;
  readonly table: ArnoldTable;
  readonly rowCount: number;
  readonly columnCount: number;
}

/** Decode one bounded raw grid response, retaining cell type and physical position. */
export function parseArnoldGrid(
  response: unknown,
  context: ArnoldGridContext,
): ArnoldSheetCell[][] {
  const { spreadsheetId, sheetId, table, rowCount, columnCount } = context;
  const parsed = gridResponseSchema.safeParse(response);
  if (!parsed.success)
    throw new ArnoldDataError([
      {
        code: "VALUES",
        table,
        message: "Google Sheets lieferte ungültige typisierte Zellwerte.",
      },
    ]);
  const targets = parsed.data.sheets.filter(
    (sheet) => sheet.properties.sheetId === sheetId,
  );
  if (
    parsed.data.spreadsheetId !== spreadsheetId ||
    targets.length !== 1 ||
    targets[0].properties.title !== table ||
    parsed.data.sheets.some(
      (sheet) => sheet.properties.sheetId !== sheetId && sheet.data?.length,
    )
  ) {
    throw new ArnoldDataError([
      {
        code: "IDENTITY",
        table,
        message:
          "Grid-Antwort stimmt nicht mit der angeforderten Datei und Tabelle überein.",
      },
    ]);
  }
  const rows: ArnoldSheetCell[][] = [];
  for (const block of targets[0].data ?? []) {
    const startRow = block.startRow ?? 0,
      startColumn = block.startColumn ?? 0;
    const rowData = block.rowData ?? [];
    if (
      startRow > rowCount ||
      startColumn > columnCount ||
      startRow + rowData.length > rowCount ||
      rowData.some(
        (row) => startColumn + (row.values?.length ?? 0) > columnCount,
      )
    ) {
      throw new ArnoldDataError([
        {
          code: "BOUNDS",
          table,
          message:
            "Google-Grid-Antwort überschreitet den angeforderten Bereich.",
        },
      ]);
    }
    while (rows.length < startRow + rowData.length) rows.push([]);
    rowData.forEach((row, i) => {
      const cells = row.values ?? [];
      for (let c = 0; c < startColumn; c++) rows[startRow + i][c] = null;
      cells.forEach((cell, column) => {
        const value = cell.userEnteredValue;
        rows[startRow + i][startColumn + column] = !value
          ? null
          : "formulaValue" in value
            ? { formulaValue: value.formulaValue }
            : "stringValue" in value
              ? value.stringValue
              : "numberValue" in value
                ? value.numberValue
                : "boolValue" in value
                  ? value.boolValue
                  : null;
      });
    });
  }
  return rows;
}
