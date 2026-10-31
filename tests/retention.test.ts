/**
 * B8: journals, write snapshots and audit events are deleted after the
 * retention period, and nothing a running retry needs is removed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_RETENTION_DAYS,
  pruneUserDirectory,
  retentionCutoff,
  retentionDaysFrom,
  scheduleRetention,
} from "../src/server/connected/retention";
import {
  FileOperationLedger,
  FixtureAuthorizationGuard,
  InMemoryArnoldWriteRepository,
  InMemoryAuditLog,
  InProcessWriteCoordinator,
  type EntityChange,
} from "../src/server/workout/infrastructure";
import { WorkoutLoggingService } from "../src/server/workout/service";
import { planFixtureDataset } from "../src/server/plan/fixture";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-12-01T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const directories: string[] = [];
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "arnold-retention-"));
  directories.push(dir);
  return dir;
};
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe("retention period", () => {
  it("defaults to 30 days and fails closed on invalid values", () => {
    expect(retentionDaysFrom({})).toBe(DEFAULT_RETENTION_DAYS);
    expect(DEFAULT_RETENTION_DAYS).toBe(30);
    expect(retentionDaysFrom({ ARNOLD_JOURNAL_RETENTION_DAYS: "7" })).toBe(7);
    for (const value of ["0", "-1", "1.5", "abc", "99999", " 30"])
      expect(() =>
        retentionDaysFrom({ ARNOLD_JOURNAL_RETENTION_DAYS: value }),
      ).toThrow(/ARNOLD_JOURNAL_RETENTION_DAYS/);
  });
});

describe("pruning one user directory", () => {
  const entry = (
    requestId: string,
    state: string,
    recordedAt: number | null,
    auditAt: number[] = [],
  ) => ({
    trackerId: "trk",
    requestId,
    fingerprint: "f",
    actor: "a",
    state,
    changes: [],
    audit: auditAt.map((at) => ({ at: iso(at), operation_id: requestId })),
    result: {},
    ...(recordedAt === null ? {} : { recorded_at: iso(recordedAt) }),
  });

  async function fixture(phase: string) {
    const dir = await tempDir();
    await writeFile(
      join(dir, "operations.json"),
      JSON.stringify([
        entry("old-committed", "committed", NOW - 31 * DAY),
        entry("new-committed", "committed", NOW - 29 * DAY),
        entry("old-prepared", "prepared", NOW - 90 * DAY),
        entry("old-dispatching", "dispatching", NOW - 90 * DAY),
        entry("legacy-old", "committed", null, [NOW - 40 * DAY]),
        entry("legacy-new", "committed", null, [NOW - 2 * DAY]),
      ]),
    );
    await writeFile(
      join(dir, "audit.json"),
      JSON.stringify([
        { at: iso(NOW - 31 * DAY), operation_id: "old" },
        { at: iso(NOW - 1 * DAY), operation_id: "new" },
      ]),
    );
    await writeFile(join(dir, "tracker.json"), JSON.stringify({ phase }));
    for (const name of ["provisioning.json", "draft.json"]) {
      await writeFile(join(dir, name), "{}");
      const old = new Date(NOW - 31 * DAY);
      await utimes(join(dir, name), old, old);
    }
    return dir;
  }
  const ids = async (dir: string) =>
    (
      JSON.parse(await readFile(join(dir, "operations.json"), "utf8")) as {
        requestId: string;
      }[]
    ).map((e) => e.requestId);

  it("removes committed journal entries and audit events past the cutoff", async () => {
    const dir = await fixture("ready");
    const result = await pruneUserDirectory(dir, retentionCutoff(30, NOW));
    expect(await ids(dir)).toEqual([
      "new-committed",
      "old-prepared",
      "old-dispatching",
      "legacy-new",
    ]);
    const audit = JSON.parse(await readFile(join(dir, "audit.json"), "utf8"));
    expect(audit.map((e: { operation_id: string }) => e.operation_id)).toEqual([
      "new",
    ]);
    expect(result).toEqual({ journal: 2, audit: 1, snapshots: 2 });
    await expect(
      readFile(join(dir, "provisioning.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps setup snapshots while the tracker is not ready", async () => {
    const dir = await fixture("initializing");
    const result = await pruneUserDirectory(dir, retentionCutoff(30, NOW));
    expect(result.snapshots).toBe(0);
    expect(await readFile(join(dir, "provisioning.json"), "utf8")).toBe("{}");
  });

  it("keeps everything inside the period", async () => {
    const dir = await fixture("ready");
    const result = await pruneUserDirectory(dir, retentionCutoff(365, NOW));
    expect(result).toEqual({ journal: 0, audit: 0, snapshots: 0 });
    expect(await ids(dir)).toHaveLength(6);
  });

  it("tolerates an empty directory", async () => {
    const dir = await tempDir();
    expect(await pruneUserDirectory(dir, NOW)).toEqual({
      journal: 0,
      audit: 0,
      snapshots: 0,
    });
  });
});

describe("a running retry survives pruning", () => {
  it("reconciles an unclear write after 40 days, while finished ones are gone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const dir = await tempDir();
    const dataset = planFixtureDataset();
    const memory = new InMemoryArnoldWriteRepository(dataset);
    let timeout = false;
    let lost: readonly EntityChange[] = [];
    const service = new WorkoutLoggingService({
      mode: "fixture",
      trackerId: dataset.config.tracker_id,
      repository: {
        kind: "fixture",
        read: () => memory.read(),
        apply: async (changes) => {
          if (timeout) {
            lost = changes;
            throw new Error("timeout");
          }
          await memory.apply(changes);
        },
      },
      ledger: new FileOperationLedger(join(dir, "operations.json")),
      audit: new InMemoryAuditLog(),
      coordinator: new InProcessWriteCoordinator(),
      authorization: new FixtureAuthorizationGuard(dataset.config.tracker_id),
      clock: () => new Date(),
      invalidate() {},
    });
    const start = (request_id: string) =>
      service.startWorkout({
        request_id,
        workout_date_local: "2026-11-30",
        timezone: "Europe/Berlin",
        session_name: "Retention",
      });

    expect((await start("finished")).ok).toBe(true);
    timeout = true;
    const unclear = await start("unclear");
    expect(unclear.error?.code).toBe("COMMIT_STATUS_UNKNOWN");

    vi.setSystemTime(NOW + 40 * DAY);
    const result = await pruneUserDirectory(
      dir,
      retentionCutoff(30, Date.now()),
    );
    expect(result.journal).toBe(1);
    const left = JSON.parse(
      await readFile(join(dir, "operations.json"), "utf8"),
    );
    expect(left.map((e: { requestId: string }) => e.requestId)).toEqual([
      "unclear",
    ]);

    // The storage committed late; the same request_id is reconciled once.
    await memory.apply(lost);
    timeout = false;
    const recovered = await start("unclear");
    expect(recovered.ok).toBe(true);
    expect(recovered.replayed).toBe(true);
    expect(
      (await memory.read()).workouts.filter(
        (w) => w.session_name_snapshot === "Retention",
      ),
    ).toHaveLength(2);
  });
});

describe("schedule", () => {
  it("runs at start and then once a day", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const job = scheduleRetention(run);
    await job.ready;
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    job.stop();
    await vi.advanceTimersByTimeAsync(3 * DAY);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps running after a failed pass", async () => {
    vi.useFakeTimers();
    const run = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValue(undefined);
    const job = scheduleRetention(run);
    await job.ready;
    await vi.advanceTimersByTimeAsync(DAY);
    expect(run).toHaveBeenCalledTimes(2);
    job.stop();
  });
});
