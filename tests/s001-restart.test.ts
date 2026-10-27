import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it.each(["plan", "workout"])(
  "recovers a %s batch across two actual processes with one journal and durable deduplicated audit",
  async (domain) => {
    const dir = await mkdtemp(join(tmpdir(), "arnold-s001-restart-"));
    try {
      const worker = join(dir, "worker.mts");
      const file = (name: string) => JSON.stringify(join(dir, name));
      const module = (path: string) => JSON.stringify(resolve(path));
      await writeFile(
        worker,
        `
import { readFile, writeFile } from "node:fs/promises";
import { FileOperationLedger, InMemoryArnoldWriteRepository, InProcessWriteCoordinator, FixtureAuthorizationGuard, canonical } from ${module("src/server/workout/infrastructure.ts")};
import { planFixtureDataset } from ${module("src/server/plan/fixture.ts")};
import { TrainingPlanService } from ${module("src/server/plan/service.ts")};
import { WorkoutLoggingService } from ${module("src/server/workout/service.ts")};
const first=process.argv[2]==="first";
const memory=new InMemoryArnoldWriteRepository(first ? planFixtureDataset("empty") : JSON.parse(await readFile(${file("data.json")},"utf8")));
const disk=new FileOperationLedger(${file("ledger.json")});
const journal={durability:"local",get:(...a)=>disk.get(...a),pending:(...a)=>disk.pending(...a),save:async e=>{if(first && e.state==="committed")process.exit(0);await disk.save(e);}};
let events=[];
try{events=JSON.parse(await readFile(${file("audit.json")},"utf8"));}catch{}
const audit={append:async incoming=>{const map=new Map(events.map(e=>[canonical([e.operation_id,e.entity_id,e.event_type]),e]));for(const e of incoming)map.set(canonical([e.operation_id,e.entity_id,e.event_type]),e);events=[...map.values()];await writeFile(${file("audit.json")},JSON.stringify(events),{flush:true});}};
const repository={kind:"fixture",read:()=>memory.read(),apply:async c=>{await memory.apply(c);await writeFile(${file("data.json")},JSON.stringify(await memory.read()),{flush:true});}};
const shared={mode:"fixture",trackerId:(await memory.read()).config.tracker_id,repository,ledger:journal,audit,coordinator:new InProcessWriteCoordinator(),authorization:new FixtureAuthorizationGuard((await memory.read()).config.tracker_id),invalidate(){}};
const plans=new TrainingPlanService({...shared,read:()=>memory.read()});
const workouts=new WorkoutLoggingService(shared);
const plan=id=>plans.execute("create_training_plan",{request_id:id,name:"Restart plan",sessions:[{session_name:"Restart",exercises:[{exercise_id:"plan-fx-bench",target_sets:3}]}]});
const workout=id=>workouts.startWorkout({request_id:id,workout_date_local:"2026-10-27",timezone:"Europe/Berlin",session_name:"Restart free"});
const response=await (${JSON.stringify(domain)}==="plan"?plan:workout)("original");
const replayAuditCount=events.length;
const next=await (${JSON.stringify(domain)}==="plan"?workout:plan)("independent");
const data=await memory.read();
process.stdout.write(JSON.stringify({response,next,replayAuditCount,plans:data.plans.length,workouts:data.workouts.length}));
`,
      );
      const run = promisify(execFile);
      const args = [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        worker,
      ];
      await run(process.execPath, [...args, "first"], { cwd: process.cwd() });
      const saved = JSON.parse(
        await readFile(join(dir, "ledger.json"), "utf8"),
      );
      expect(saved).toHaveLength(1);
      expect(saved[0].state).toBe("dispatching");
      const firstAudit = JSON.parse(
        await readFile(join(dir, "audit.json"), "utf8"),
      );
      const second = await run(process.execPath, [...args, "second"], {
        cwd: process.cwd(),
      });
      const result = JSON.parse(second.stdout);
      expect(result.response.ok).toBe(true);
      expect(result.response.replayed).toBe(true);
      expect(result.replayAuditCount).toBe(firstAudit.length);
      expect(result.next.ok).toBe(true);
      expect(result.plans).toBe(1);
      expect(result.workouts).toBe(1);
      const journal = JSON.parse(
        await readFile(join(dir, "ledger.json"), "utf8"),
      );
      expect(journal).toHaveLength(2);
      expect(
        journal.every((e: { state: string }) => e.state === "committed"),
      ).toBe(true);
      const audit = JSON.parse(await readFile(join(dir, "audit.json"), "utf8"));
      expect(
        new Set(
          audit.map(
            (e: {
              operation_id: string;
              entity_id: string;
              event_type: string;
            }) => JSON.stringify([e.operation_id, e.entity_id, e.event_type]),
          ),
        ).size,
      ).toBe(audit.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
