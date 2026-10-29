import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it("recovers across two actual Node processes after storage committed and the first process exits before ledger acknowledgement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arnold-restart-"));
  try {
    const modulePath = (name: string) =>
      JSON.stringify(resolve(`src/server/workout/${name}.ts`));
    const worker = join(dir, "restart-worker.mts"),
      ledger = join(dir, "ledger.json"),
      data = join(dir, "data.json");
    await writeFile(
      worker,
      `
      import { readFile, writeFile } from "node:fs/promises";
      import { FileOperationLedger, InMemoryArnoldWriteRepository, InMemoryAuditLog, InProcessWriteCoordinator, FixtureAuthorizationGuard } from ${modulePath("infrastructure")};
      import { WorkoutLoggingService } from ${modulePath("service")};
      import { workoutFixtureDataset } from ${modulePath("fixture")};
      const first=process.argv[2]==="first";
      const memory=new InMemoryArnoldWriteRepository(first ? workoutFixtureDataset() : JSON.parse(await readFile(${JSON.stringify(data)},"utf8")));
      const disk=new FileOperationLedger(${JSON.stringify(ledger)});
      const journal={durability:"local",get:(...args)=>disk.get(...args),pending:(tracker)=>disk.pending(tracker),save:async entry=>{
        if(first && entry.state==="committed") process.exit(0);
        await disk.save(entry);
      }};
      const repository={kind:"fixture",read:()=>memory.read(),apply:async changes=>{await memory.apply(changes);await writeFile(${JSON.stringify(data)},JSON.stringify(await memory.read()),{flush:true});}};
      const service=new WorkoutLoggingService({mode:"fixture",trackerId:"arnold-fixture-tracker",repository,ledger:journal,audit:new InMemoryAuditLog(),coordinator:new InProcessWriteCoordinator(),authorization:new FixtureAuthorizationGuard("arnold-fixture-tracker"),invalidate(){}});
      const response=await service.startWorkout({request_id:"process-restart",workout_date_local:"2026-10-20",timezone:"Europe/Berlin",session_name:"Synthetic restart"});
      process.stdout.write(JSON.stringify({response,count:(await memory.read()).workouts.length}));
    `,
    );
    const run = promisify(execFile);
    await run(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        worker,
        "first",
      ],
      { cwd: process.cwd() },
    );
    const pending = JSON.parse(await readFile(ledger, "utf8"));
    expect(pending[0].state).toBe("dispatching");
    const restarted = await run(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        worker,
        "second",
      ],
      { cwd: process.cwd() },
    );
    const result = JSON.parse(restarted.stdout);
    expect(result.response.ok).toBe(true);
    expect(result.response.replayed).toBe(true);
    expect(result.count).toBe(1);
    expect(JSON.parse(await readFile(ledger, "utf8"))[0].state).toBe(
      "committed",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
