import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  LogInputSchema,
  SnapshotSchema,
  type Exercise,
  type LogInput,
  type Snapshot,
  type TrainingSet,
  type Workout,
} from "../shared/schemas.js";
import { createFixture } from "./fixture.js";

export interface StorageAdapter {
  readonly mode: "demo" | "google_sheets";
  getSnapshot(): Promise<Snapshot>;
  getWorkouts(): Promise<Workout[]>;
  getSets(): Promise<TrainingSet[]>;
  getExercises(): Promise<Exercise[]>;
  saveSet(
    input: LogInput,
  ): Promise<{ set: TrainingSet; duplicate: boolean; snapshot: Snapshot }>;
  resetDemoData(): Promise<Snapshot>;
}

/** Single-process adapter: serializes transactions and atomically replaces the JSON file. */
export class JsonStorageAdapter implements StorageAdapter {
  readonly mode = "demo" as const;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  private transaction<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async read(): Promise<Snapshot> {
    try {
      return SnapshotSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const initial = createFixture();
      await this.write(initial);
      return initial;
    }
  }
  private async write(snapshot: Snapshot) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot, null, 2), {
      mode: 0o600,
    });
    await rename(temporary, this.file);
  }
  getSnapshot() {
    return this.transaction(() => this.read());
  }
  async getWorkouts() {
    return (await this.getSnapshot()).workouts;
  }
  async getSets() {
    return (await this.getSnapshot()).sets;
  }
  async getExercises() {
    return (await this.getSnapshot()).exercises;
  }
  saveSet(raw: LogInput) {
    return this.transaction(async () => {
      const input = LogInputSchema.parse(raw);
      const snapshot = await this.read();
      const exercise = snapshot.exercises.find(
        (e) => e.id === input.exerciseId,
      );
      if (!exercise) throw new Error("Unbekannte Übung.");
      const fingerprint = JSON.stringify([
        input.date,
        input.exerciseId,
        input.kg,
        input.reps,
        input.rpe ?? null,
      ]);
      const previous = Object.hasOwn(snapshot.requests, input.requestId)
        ? snapshot.requests[input.requestId]
        : undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error(
            "Dieser Idempotenzschlüssel wurde bereits mit anderen Eingaben verwendet.",
          );
        const set = snapshot.sets.find((s) => s.id === previous.setId);
        if (!set)
          throw new Error(
            "Inkonsistenter Demo-Speicher: Satz zur Anfrage fehlt.",
          );
        return { set, duplicate: true, snapshot };
      }
      const workoutId = `${input.date}-${exercise.split.toLowerCase()}`;
      if (!snapshot.workouts.some((w) => w.id === workoutId))
        snapshot.workouts.push({
          id: workoutId,
          date: input.date,
          split: exercise.split,
        });
      const set: TrainingSet = {
        id: randomUUID(),
        workoutId,
        exerciseId: exercise.id,
        kg: input.kg,
        reps: input.reps,
        ...(input.rpe === undefined ? {} : { rpe: input.rpe }),
        setNumber:
          1 +
          Math.max(
            0,
            ...snapshot.sets
              .filter(
                (s) =>
                  s.workoutId === workoutId && s.exerciseId === exercise.id,
              )
              .map((s) => s.setNumber),
          ),
      };
      snapshot.sets.push(set);
      Object.defineProperty(snapshot.requests, input.requestId, {
        value: { fingerprint, setId: set.id },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      await this.write(snapshot);
      return { set, duplicate: false, snapshot };
    });
  }
  resetDemoData() {
    return this.transaction(async () => {
      const snapshot = createFixture();
      await this.write(snapshot);
      return snapshot;
    });
  }
}
