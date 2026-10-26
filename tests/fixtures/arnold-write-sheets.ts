import { FakeArnoldSheets, type FixtureTable } from "./arnold-v1";
import type { ArnoldSheetCell } from "../../src/server/arnold-sheet-parser";
import type {
  ArnoldSheetsWriteTransport,
  SheetsWriteRequest,
} from "../../src/server/arnold-sheets-write-adapter";
/** Fully synthetic Google boundary; atomic application and injectable response loss. */
export class FakeArnoldWriteSheets
  extends FakeArnoldSheets
  implements ArnoldSheetsWriteTransport
{
  batches: (readonly SheetsWriteRequest[])[] = [];
  reject: number[] = [];
  loseResponse = false;
  partial = false;
  async batchUpdate(_id: string, requests: readonly SheetsWriteRequest[]) {
    this.batches.push(structuredClone(requests));
    const rejected = this.reject.shift();
    if (rejected) throw { response: { status: rejected } };
    const next = structuredClone(this.tables);
    for (const request of requests) {
      const body =
        "appendCells" in request ? request.appendCells : request.updateCells;
      const id = "sheetId" in body ? body.sheetId : body.range.sheetId;
      const table = this.metadata.sheets.find(
        (s) => s.properties.sheetId === id,
      )?.properties.title as FixtureTable;
      if (!table) throw { status: 400 };
      const rows: ArnoldSheetCell[][] = body.rows.map((row) =>
        row.values.map((cell) =>
          !cell.userEnteredValue
            ? null
            : "stringValue" in cell.userEnteredValue
              ? cell.userEnteredValue.stringValue
              : cell.userEnteredValue.numberValue,
        ),
      );
      if ("appendCells" in request) next[table].push(...rows);
      else
        rows.forEach((row, i) => {
          next[table][request.updateCells.range.startRowIndex + i] = row;
        });
    }
    if (this.partial) {
      this.tables.WORKOUTS = next.WORKOUTS;
      throw Error("broken transport partial commit");
    }
    this.tables = next;
    if (this.loseResponse) throw Error("response lost after atomic commit");
  }
}
