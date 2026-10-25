import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonStorageAdapter } from "../src/server/storage";

let directory: string;
let file: string;
let storage: JsonStorageAdapter;
const input = {
  requestId: "storage-request-1",
  date: "2026-10-24",
  exerciseId: "bench-press",
  kg: 60,
  reps: 10,
  rpe: 8,
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fitness-storage-"));
  file = join(directory, "demo.json");
  storage = new JsonStorageAdapter(file);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe("transactional JSON demo storage", () => {
  it("persists a new workout and set across adapter recreation", async () => {
    const saved = await storage.saveSet(input);
    expect(saved.duplicate).toBe(false);
    expect(saved.set.setNumber).toBe(1);
    const reopened = new JsonStorageAdapter(file);
    expect(await reopened.getSets()).toHaveLength(109);
    expect(await reopened.getWorkouts()).toHaveLength(13);
    expect((await reopened.saveSet(input)).set.id).toBe(saved.set.id);
    expect(await reopened.getExercises()).toHaveLength(9);
  });
  it("deduplicates concurrent retries and rejects conflicting key reuse", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => storage.saveSet(input)),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.set.id)).size).toBe(1);
    expect(await storage.getSets()).toHaveLength(109);
    await expect(storage.saveSet({ ...input, kg: 70 })).rejects.toThrow(
      "Idempotenzschlüssel",
    );
  });
  it("keeps intentional identical sets with different keys and assigns increasing numbers", async () => {
    const results = await Promise.all([
      storage.saveSet(input),
      storage.saveSet({ ...input, requestId: "storage-request-2" }),
    ]);
    expect(results.map((r) => r.set.setNumber)).toEqual([1, 2]);
    expect(new Set(results.map((r) => r.set.id)).size).toBe(2);
    expect(await storage.getWorkouts()).toHaveLength(13);
  });
  it("appends to an existing fixture workout without creating another session", async () => {
    const saved = await storage.saveSet({ ...input, date: "2026-10-19" });
    expect(saved.set.setNumber).toBe(4);
    expect(saved.snapshot.workouts).toHaveLength(12);
  });
  it("validates calendar dates, exercise IDs, kg, reps and RPE", async () => {
    for (const patch of [
      { date: "2026-02-30" },
      { exerciseId: "unknown" },
      { kg: -1 },
      { reps: 1.5 },
      { reps: 0 },
      { rpe: 11 },
    ]) {
      await expect(storage.saveSet({ ...input, ...patch })).rejects.toThrow();
    }
    expect(await storage.getSets()).toHaveLength(108);
  });
  it("resets additions and retry keys to the original fixture", async () => {
    await storage.saveSet(input);
    const reset = await storage.resetDemoData();
    expect(reset.workouts).toHaveLength(12);
    expect(reset.sets).toHaveLength(108);
    expect(reset.requests).toEqual({});
    expect((await storage.saveSet(input)).duplicate).toBe(false);
  });
  it("surfaces corrupted storage instead of overwriting it", async () => {
    await writeFile(file, "{broken");
    await expect(storage.getSnapshot()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{broken");
  });
});
