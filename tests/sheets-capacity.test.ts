/**
 * B2: a write never produces a sheet Arnold can no longer read.
 *
 * Ported from the S001 stabilization branch (boundaries test) and adapted to
 * main: the refusal is SHEET_CAPACITY_EXCEEDED, happens before any request is
 * sent, and leaves the file readable.
 */
import { describe, expect, it } from "vitest";
import { ArnoldSheetsWriteAdapter } from "../src/server/arnold-sheets-write-adapter";
import { ArnoldSheetsReadAdapter } from "../src/server/arnold-sheets-read-adapter";
import { FakeArnoldWriteSheets } from "./fixtures/arnold-write-sheets";
import { fixtureFileId, V1_HEADERS } from "./fixtures/arnold-v1";
import type { ArnoldDataset } from "../src/shared/arnold-schema-v1";
import {
  type EntityChange,
  canonical,
} from "../src/server/workout/infrastructure";
import { ARNOLD_SHEETS_LIMITS } from "../src/shared/sheets-limits";
import { recoveryFor } from "../src/shared/write-recovery";

const LIMIT = ARNOLD_SHEETS_LIMITS.rows;
const names = {
  exercises: "EXERCISES",
  workouts: "WORKOUTS",
  sets: "SETS",
} as const;
function appendChange(
  table: keyof typeof names,
  data: ArnoldDataset,
  suffix = "new",
): EntityChange {
  if (table === "exercises")
    return {
      table,
      before: null,
      after: { ...data.exercises[0], exercise_id: suffix },
    };
  if (table === "workouts")
    return {
      table,
      before: null,
      after: { ...data.workouts[0], workout_id: suffix },
    };
  return {
    table,
    before: null,
    after: {
      ...data.sets[0],
      set_id: suffix,
      set_number: suffix === "new" ? 20_001 : 20_002,
    },
  };
}
async function boundary(
  table: keyof typeof names,
  occupiedRows: number,
  gap = false,
) {
  const fake = new FakeArnoldWriteSheets();
  const tab = names[table];
  const rows = fake.tables[tab];
  const template = [...rows[1]];
  while (rows.length < occupiedRows) {
    const copy = [...template];
    copy[0] = `cap-${tab}-${rows.length}`;
    if (tab === "SETS")
      copy[V1_HEADERS.SETS.indexOf("set_number")] = rows.length + 100;
    rows.push(copy);
  }
  if (gap) rows[Math.floor(occupiedRows / 2)] = [];
  const properties = fake.metadata.sheets.find(
    (s) => s.properties.title === tab,
  )!.properties;
  properties.gridProperties.rowCount = occupiedRows;
  const data = await new ArnoldSheetsReadAdapter(
    { spreadsheetId: fixtureFileId },
    fake,
  ).getDataset();
  const adapter = new ArnoldSheetsWriteAdapter(
    {
      spreadsheetId: fixtureFileId,
      dedicatedTestSpreadsheetId: fixtureFileId,
      allowTestSheetWrites: true,
      privateConnection: true,
      trackerId: data.config.tracker_id,
      authorizeWrite: async () => ({
        subject: "synthetic-capacity",
        trackerId: data.config.tracker_id,
        permissions: ["write"],
        verified: true,
        kind: "authenticated",
      }),
    },
    fake,
  );
  return { adapter, fake, data, tab };
}

for (const table of ["exercises", "workouts", "sets"] as const)
  describe(`${table}: physical Sheets capacity`, () => {
    it.each([LIMIT - 2, LIMIT - 1])(
      "accepts one append at %i occupied rows, including the header",
      async (occupied) => {
        const { adapter, fake, data, tab } = await boundary(table, occupied);
        await adapter.apply([appendChange(table, data)]);
        expect(fake.batches).toHaveLength(1);
        expect(
          fake.metadata.sheets.find((s) => s.properties.title === tab)!
            .properties.gridProperties.rowCount,
        ).toBe(occupied + 1);
        expect((await adapter.read())[table]).toHaveLength(
          data[table].length + 1,
        );
      },
    );
    it("rejects one row over the limit without dispatch, retaining a readable dataset", async () => {
      const { adapter, fake, data } = await boundary(table, LIMIT);
      await expect(
        adapter.apply([appendChange(table, data)]),
      ).rejects.toMatchObject({ code: "SHEET_CAPACITY_EXCEEDED" });
      expect(fake.batches).toHaveLength(0);
      expect(await adapter.read()).toEqual(data);
    });
    it("includes internal blank rows and the full multi-row batch in preflight", async () => {
      const { adapter, fake, data } = await boundary(table, LIMIT - 1, true);
      const before = canonical(fake.tables);
      await expect(
        adapter.apply([
          appendChange(table, data),
          appendChange(table, data, "second"),
        ]),
      ).rejects.toMatchObject({ code: "SHEET_CAPACITY_EXCEEDED" });
      expect(fake.batches).toHaveLength(0);
      expect(canonical(fake.tables)).toBe(before);
      expect(await adapter.read()).toEqual(data);
    });
  });

it("does not partly update another table when one append overflows", async () => {
  const { adapter, fake, data } = await boundary("exercises", LIMIT);
  const workout = data.workouts[0];
  await expect(
    adapter.apply([
      {
        table: "workouts",
        before: workout,
        after: {
          ...workout,
          notes: "Never dispatched",
          row_revision: workout.row_revision + 1,
        },
      },
      appendChange("exercises", data),
    ]),
  ).rejects.toBeDefined();
  expect(fake.batches).toHaveLength(0);
  expect(await adapter.read()).toEqual(data);
});
it("uses spare grid rows and ignores trailing empty cell rows while preserving internal gaps", async () => {
  const { adapter, fake, data } = await boundary("exercises", LIMIT - 1, true);
  fake.tables.EXERCISES.push([]);
  fake.metadata.sheets.find(
    (s) => s.properties.title === "EXERCISES",
  )!.properties.gridProperties.rowCount = LIMIT;
  await adapter.apply([appendChange("exercises", data)]);
  expect(fake.tables.EXERCISES).toHaveLength(LIMIT);
  expect((await adapter.read()).exercises).toHaveLength(
    data.exercises.length + 1,
  );
});

it("explains the refusal and points to support", async () => {
  const { adapter, data } = await boundary("sets", LIMIT);
  const error = await adapter
    .apply([appendChange("sets", data)])
    .catch((e: unknown) => e);
  expect(error).toMatchObject({
    code: "SHEET_CAPACITY_EXCEEDED",
    retryable: false,
  });
  expect((error as Error).message).toContain("Es wurde nichts geschrieben");
  expect((error as { details: string[] }).details).toContain(
    `max_rows=${LIMIT}`,
  );
  expect(recoveryFor("SHEET_CAPACITY_EXCEEDED", false)).toBe("contact_support");
});
