import { expect, it } from "vitest";
import { ArnoldSheetsDataSource } from "../src/server/arnold-source";
import { FakeArnoldSheets, fixtureFileId, setCell } from "./fixtures/arnold-v1";
it("does not publish or cache an old in-flight read after a confirmed write invalidates it", async () => {
  const fake = new FakeArnoldSheets();
  let release!: () => void,
    started!: () => void,
    first = true;
  const waiting = new Promise<void>((resolve) => {
      release = resolve;
    }),
    reading = new Promise<void>((resolve) => {
      started = resolve;
    });
  const original = fake.get.bind(fake);
  fake.get = async <T>(
    path: string,
    params: Readonly<Record<string, string>>,
  ): Promise<T> => {
    const result = await original<T>(path, params);
    if (first && params.ranges?.startsWith("'SETS'!")) {
      first = false;
      started();
      await waiting;
    }
    return result;
  };
  const source = new ArnoldSheetsDataSource({
    spreadsheetId: fixtureFileId,
    transport: fake,
    cacheTtlMs: 100000,
  });
  const pending = source.load();
  await reading;
  setCell(fake.tables, "SETS", 0, "load_kg", 35);
  source.invalidate();
  const concurrent = source.load();
  release();
  expect((await pending).dataset.sets[0].load_kg).toBe(35);
  expect((await concurrent).dataset.sets[0].load_kg).toBe(35);
  const calls = fake.calls.length;
  expect((await source.load()).dataset.sets[0].load_kg).toBe(35);
  expect(fake.calls).toHaveLength(calls);
});
